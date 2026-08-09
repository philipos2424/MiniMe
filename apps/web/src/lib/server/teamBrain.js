/**
 * Team-member brain — natural conversation runner.
 */
import { makeOpenAI } from './openaiClient';
import { MODEL_MINI, EFFORT_BRAIN } from './constants';
import { tg } from './telegramApi';
import { supabase } from './db';
import { sendAsOwnerOrBot } from './sendAs';

const openai = makeOpenAI();
const MAX_ITERS = 3;
const MAX_THREAD_MESSAGES = 40;
const MAX_PROMPT_TURNS = 20;

// ────────────────────────────── Thread history ──────────────────────────────
/** Load the (business, supplier) conversation thread, or a fresh shape. */
async function loadThread(sb, businessId, supplierId) {
  const { data } = await sb.from('team_threads')
    .select('*').eq('business_id', businessId).eq('supplier_id', supplierId).maybeSingle();
  return data || { business_id: businessId, supplier_id: supplierId, task_id: null, messages: [] };
}

/** Append a turn and persist, capped to MAX_THREAD_MESSAGES. */
export async function recordTeamTurn(sb, { businessId, supplierId, taskId, role, text, kind }) {
  const thread = await loadThread(sb, businessId, supplierId);
  const messages = [...(thread.messages || []), {
    role, text: String(text || '').slice(0, 2000), kind: kind || 'text', at: new Date().toISOString(),
  }].slice(-MAX_THREAD_MESSAGES);
  try {
    await sb.from('team_threads').upsert({
      business_id: businessId, supplier_id: supplierId,
      task_id: taskId ?? thread.task_id ?? null,
      messages, last_message_at: new Date().toISOString(),
    }, { onConflict: 'business_id,supplier_id' });
  } catch (e) {
    console.warn('[teamBrain] recordTeamTurn:', e.message);
  }
  return messages;
}

// ────────────────────────────── Tools ──────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'reply_to_member',
      description: 'Send a short, natural text to the team member. This is how you actually talk — like a person texting, not a form. Short lines, first names, no emoji headers, no "Status: X" labels.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_status',
      description: "Update the task's actual status once you've understood what the member communicated (in words, a photo, or a voice note). 'done' = the work is finished (a bare photo of finished work counts). 'blocked' = they need something before they can continue. 'in_progress' = they're on it. 'accepted' = they've agreed to take it on but haven't started.",
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['accepted', 'in_progress', 'blocked', 'done'] },
          note: { type: 'string', description: 'One short line summarizing what they said, in their words where possible.' },
        },
        required: ['status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_deadline',
      description: "Propose a new time to the member when they need one, but ONLY when it still lands within the client's deadline (given in the system prompt). If honoring it would need to slip past the client's deadline, do not use this — call ask_owner instead.",
      parameters: {
        type: 'object',
        properties: { new_iso: { type: 'string' }, reason: { type: 'string' } },
        required: ['new_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_owner',
      description: "Escalate to the owner. Use when: the client's deadline is genuinely at risk, the member is asking about scope/price/money, the member is refusing outright, or the member has gone genuinely silent after real chasing. Do NOT use this for something you can solve yourself (a same-day reschedule that still meets the deadline, a routine question you can answer from the task details).",
      parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_client',
      description: "Send the client a short, honest update — ONLY at real milestones (the member accepted the work, or it's finished). Never mention internal team problems (being blocked, being slow, needing to be chased) to the client — that stays between you and the owner.",
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'not_about_task',
      description: "Call this INSTEAD of anything else when the member's message is clearly not about this task at all — e.g. this person is also a customer of the business and is asking about a product/price/order, not reporting on their work. Do not reply; the message will be handed to the normal customer conversation instead.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'End this turn. Call this after you\'ve replied (or decided no reply is needed).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ────────────────────────────── Tool implementations ──────────────────────────────
function makeTools({ sb, token, business, supplier, task, state, replyChatId, replyToMessageId }) {
  return {
    async reply_to_member({ text }) {
      if (!text) return { ok: false, error: 'empty' };
      // A group-triggered turn replies into the group instead of DMing —
      // always as the bot (never the owner's personal account, which makes
      // no sense in a shared chat), pinned to the message that started this
      // turn so parallel task threads in a busy group don't tangle together.
      const res = await sendAsOwnerOrBot({
        sb, business, chatId: replyChatId || supplier.contact_telegram,
        payload: { text, ...(replyChatId && replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}) },
        prefer: replyChatId ? 'bot' : (supplier.contact_channel || 'auto'),
      });
      await recordTeamTurn(sb, { businessId: business.id, supplierId: supplier.id, taskId: task.id, role: 'us', text, kind: 'text' });
      // Keep assignee_message_id pointed at whatever we just sent, so a reply
      // to THIS message (accept, a status update, a photo) still pins to this
      // task — same reason pingAssignee used to do this before teamBrain existed.
      const sentMessageId = res?.result?.result?.message_id;
      if (res.ok && sentMessageId) {
        await sb.from('agent_tasks').update({ assignee_message_id: sentMessageId }).eq('id', task.id).then(() => {}, () => {});
      }
      state.replied = true;
      return { ok: res.ok, sent_as: res.sent_as };
    },

    async set_status({ status, note }) {
      // agent_tasks.status has no 'done' value — completion goes through
      // completeTask() (delegation.js), which also handles the owner
      // notification, team-group post, and completed_at/proof-photo wiring.
      // Everything else is a direct status write.
      if (status === 'done') {
        const { completeTask } = await import('./delegation');
        await completeTask({ sb, token, business, task, note, actor: supplier.name });
        state.newStatus = 'done';
        state.statusNote = note || null;
        return { ok: true };
      }
      const patch = { status: status === 'accepted' ? 'in_progress' : status };
      const isFirstAccept = status === 'accepted' && !task.accepted_at;
      if (status === 'accepted') patch.accepted_at = new Date().toISOString();
      if (status === 'blocked') patch.blocked_reason = (note || 'blocked').slice(0, 500);
      await sb.from('agent_tasks').update(patch).eq('id', task.id);
      state.newStatus = status;
      state.statusNote = note || null;

      // Milestone: the client hears once someone's actually on it — silent on
      // everything else (blocked, chases stay internal, per the user's choice).
      if (isFirstAccept && task.customer_id) {
        const { notifyCustomer } = await import('./delegation');
        const dueNote = task.due_at ? ` They said it should be ready by ${new Date(task.due_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}.` : '';
        notifyCustomer({
          sb, token, business, task: { ...task, accepted_at: patch.accepted_at },
          rawNote: `${supplier.name} is on "${task.title}".${dueNote}`,
          milestone: 'accepted',
        }).catch(e => console.warn('[teamBrain] accept milestone:', e.message));
      }
      return { ok: true };
    },

    async propose_deadline({ new_iso, reason }) {
      const d = new Date(new_iso);
      if (isNaN(d.getTime())) return { ok: false, error: 'bad_date' };
      // task.due_at is the deadline as it stood when this turn started (the
      // client-facing commitment) — agent_tasks has no separate "client
      // deadline" column, so this is the ceiling a same-day reschedule must
      // respect. Pushing PAST it needs the owner (ask_owner), not a quiet move.
      if (task.due_at && d.getTime() > Date.parse(task.due_at)) {
        return { ok: false, error: 'past_client_deadline — use ask_owner instead' };
      }
      await sb.from('agent_tasks').update({ due_at: d.toISOString() }).eq('id', task.id);
      state.rescheduled = d.toISOString();
      return { ok: true, reason: reason || null };
    },

    async ask_owner({ question }) {
      const chatId = business.owner_private_chat_id || business.owner_telegram_id;
      if (!chatId) return { ok: false, error: 'no_owner_chat' };
      await tg(token, 'sendMessage', {
        chat_id: chatId, parse_mode: 'Markdown',
        text: `🙋 *${supplier.name}* on "${task.title}":\n${question}`,
      });
      state.escalated = true;
      return { ok: true };
    },

    async notify_client({ text }) {
      if (!task.customer_id) return { ok: false, error: 'no_customer' };
      const { notifyCustomer } = await import('./delegation');
      const r = await notifyCustomer({ sb, token, business, task, text });
      state.clientNotified = r.ok;
      return r;
    },

    async not_about_task() {
      state.unrelated = true;
      state.finished = true;
      return { ok: true };
    },

    async finish() {
      state.finished = true;
      return { ok: true };
    },
  };
}

// ────────────────────────────── Owner-voice block ──────────────────────────────
function ownerVoiceBlock(business) {
  const parts = [];
  if (business.tone) parts.push(`Tone: ${business.tone}`);
  if (business.greeting_style) parts.push(`Greeting style: ${business.greeting_style}`);
  if (business.code_switch_style) parts.push(`Language mix: ${business.code_switch_style}`);
  const samples = (business.sample_replies || []).slice(0, 4);
  if (samples.length) parts.push(`Examples of how ${business.owner_name || 'the owner'} actually writes:\n${samples.map(s => `- "${s}"`).join('\n')}`);
  return parts.length ? parts.join('\n') : 'Warm, brief, direct — like texting a colleague, not writing a memo.';
}

function threadToMessages(history) {
  return (history || []).slice(-MAX_PROMPT_TURNS).map(m => ({
    role: m.role === 'us' ? 'assistant' : 'user',
    content: m.kind && m.kind !== 'text' ? `[${m.kind}] ${m.text}` : m.text,
  }));
}

// ────────────────────────────── Main loop ──────────────────────────────
/**
 * Run one turn of the member conversation. `inboundText` is already normalized
 * to text by the caller (voice/photo/document transcribed via transcription.js
 * before this is called — teamBrain itself only reasons over text).
 */
export async function runTeamBrain({ token, business, supplier, task, inboundText, inboundKind, directive, fileNote, replyChatId, replyToMessageId }) {
  const sb = supabase();
  const state = { replied: false, finished: false, newStatus: null, statusNote: null, escalated: false, clientNotified: false, rescheduled: null, unrelated: false };
  const toolImpls = makeTools({ sb, token, business, supplier, task, state, replyChatId, replyToMessageId });

  const thread = await loadThread(sb, business.id, supplier.id);
  const firstContact = !supplier.ai_disclosed_at;

  const dueLine = task.due_at ? `Due: ${new Date(task.due_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No fixed deadline';
  const clientDeadlineLine = task.due_at
    ? `That due time is what the client was told to expect. propose_deadline can only move it EARLIER or to the exact same time — never later. If ${supplier.name} needs more time than that, it means the promise to the client would slip, so it must go to the owner via ask_owner, not be decided quietly.`
    : '';

  const system = [
    `You are texting ${supplier.name}${supplier.role ? ` (${supplier.role})` : ''} on behalf of ${business.owner_name || 'the owner'} of ${business.name}. You ARE having a real conversation — not filling in a form.`,

    `HOW TO WRITE: Short. Use their first name occasionally, not every message. Greetings the way the owner actually greets people. No emoji headers, no "Status:" labels, no markdown bullet cards. Two short natural messages beat one structured block. Match their language — if they write Amharic, reply in Amharic; code-switch the way the owner does.

${ownerVoiceBlock(business)}`,

    `READ IMPLICIT SIGNALS: A bare photo of finished work means done — call set_status('done'). "👍" after being asked to take something on means accepted. "not yet" / "still on it" means in_progress. "parts haven't come" / "waiting on X" means blocked. Only ask a clarifying question when it's genuinely ambiguous — don't interrogate.`,

    `NEGOTIATE LIKE A PERSON: If they push back ("I'm swamped today"), try to solve it yourself first — offer a concrete alternative that still meets the client's deadline, ask what it would take, thank them for flexibility. Vary your wording across messages — never repeat the same nudge verbatim. Use social lubricant ("sorry to keep asking") instead of robotic reminders.

ESCALATE (ask_owner) instead of solving it yourself when: the client's deadline is genuinely at risk, they're asking about scope/price/money, they refuse outright, or they've gone truly silent after you've already tried. ${clientDeadlineLine}`,

    `HONESTY — NON-NEGOTIABLE: If ${supplier.name} asks whether you're a bot/AI, or whether this is really ${business.owner_name || 'the owner'} texting, answer truthfully. You may still speak in the owner's voice day to day (a human assistant texting from the boss's phone does the same) — but never claim to be a human when directly asked.`,

    `${supplier.name} may ALSO be a customer of the business separately from this task. If what they just sent is clearly not about this task — a product question, a price ask, an order, anything customer-shaped — call not_about_task and nothing else. Do not reply to it yourself; it'll be handled by the normal customer conversation.`,

    replyChatId
      ? `THIS REPLY IS VISIBLE TO THE WHOLE TEAM GROUP, not just ${supplier.name} — everyone in the chat will read it. Never state a client's phone number, address, or other contact details here, even if they're in the task description above. Keep client references generic ("the client on this order"). ${supplier.name} was already sent the full brief with those specifics privately when this task was assigned — if they need a reminder, point them back to that DM rather than repeating the specifics in the group.`
      : '',

    firstContact
      ? `This is your FIRST message to ${supplier.name}. A brief, natural self-introduction is appropriate (e.g. mention you're helping ${business.owner_name || 'the owner'} coordinate) — one line, not a disclaimer block.`
      : `You've talked with ${supplier.name} before — no need to reintroduce yourself.`,

    `TASK: "${task.title}"${task.description ? `\n${task.description}` : ''}\n${dueLine}`,

    fileNote || '',

    `Today: ${new Date().toISOString().slice(0, 10)}.`,

    inboundText
      ? `${supplier.name} just sent (${inboundKind || 'text'}): """${inboundText}"""\n\nRespond naturally, update status if warranted, and call finish when done.`
      : directive
        ? `${directive}\n\nWrite it fresh — don't reuse the exact wording of your last message to them if you can see it in the history above. One short natural message, then call finish.`
        : `Open the conversation with ${supplier.name} about this task. Call finish when done.`,
  ].filter(Boolean).join('\n\n');

  const messages = [{ role: 'system', content: system }, ...threadToMessages(thread.messages)];
  if (inboundText) {
    messages.push({ role: 'user', content: inboundKind && inboundKind !== 'text' ? `[${inboundKind}] ${inboundText}` : inboundText });
  }

  let iters = 0;
  const toolLog = [];
  while (iters < MAX_ITERS && !state.finished) {
    iters++;
    const completion = await openai.chat.completions.create({
      model: MODEL_MINI, temperature: 0.5, messages, tools: TOOLS, tool_choice: 'auto',
      // Tool selection across iterations — the one job reasoning helps with.
      // Opts out of the app-wide 'none' default; see constants.js.
      reasoning_effort: EFFORT_BRAIN,
      // 2000 is the sanitizer's reasoning-on floor; lower values are cosmetic.
      max_completion_tokens: 2000,
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      if (!state.replied && msg.content) {
        await toolImpls.reply_to_member({ text: msg.content });
        toolLog.push({ name: 'reply_to_member', args: { text: msg.content }, auto_fallback: true });
      }
      break;
    }
    for (const call of msg.tool_calls) {
      const fnName = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
      const impl = toolImpls[fnName];
      const result = impl ? await impl(args).catch(e => ({ ok: false, error: e.message })) : { ok: false, error: `unknown tool ${fnName}` };
      toolLog.push({ name: fnName, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
    if (toolLog.some(t => t.name === 'finish')) break;
  }

  // Mark disclosure as having happened once we've actually sent a first message.
  // Also register their scoped /help /mytasks command menu here as a safety
  // net — members added before this shipped never got it on add.
  if (firstContact && state.replied) {
    await sb.from('suppliers').update({ ai_disclosed_at: new Date().toISOString() }).eq('id', supplier.id);
    const { registerMemberCommands } = await import('./delegation');
    registerMemberCommands(token, supplier).catch(() => {});
  }

  if (inboundText) {
    await recordTeamTurn(sb, { businessId: business.id, supplierId: supplier.id, taskId: task.id, role: 'them', text: inboundText, kind: inboundKind || 'text' });
  }

  return { ...state, tool_calls: toolLog };
}

