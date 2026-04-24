/**
 * Agent Brain — autonomous reasoning loop for Alfred.
 *
 * Instead of the rigid pipeline (detect → brief → forward), the brain is
 * given the current state (business, customer, recent chat, active jobs,
 * team roster, catalog) and a set of TOOLS. It decides each turn which
 * tools to call. GPT-4o function calling keeps the loop going until the
 * model returns a final plain-text message (or hits max iterations).
 *
 * Tools Alfred can use:
 *   - reply_to_client(text)           send text to the customer now
 *   - ask_client_question(text)       single clarifying Q (identical to reply but logged differently)
 *   - send_file_to_client(caption?)   send the business's auto-doc (price list)
 *   - create_job({title, description, deadline?, budget?, currency?, steps?})
 *   - brief_supplier({role, brief})   pick a supplier by role & DM them
 *   - forward_attachments_to_supplier({role})  forward recent customer files
 *   - notify_owner(text)              ping the owner's Telegram
 *   - mark_step_done({job_id, step_index})
 *   - advance_job({job_id})           move to next supplier step
 *   - log_note(text)                  write a private note on the conversation
 *
 * The brain is triggered after the inbound message is saved. It returns
 * {replied: boolean, thought_id: string} so the caller can bail out of
 * any fallback reply logic when the brain already handled it.
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { tg } from './telegramApi';
import { createJob, logEvent, appendThread } from './jobs';
import { pickSupplier, generateBrief } from './jobFanout';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_ITERS = 6;

// ────────────────────────────── Tool schema ──────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'reply_to_client',
      description: 'Send a short, direct text message to the customer right now. Use this for answers, acknowledgments, and confirmations.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_client_question',
      description: 'Ask the customer ONE focused clarifying question when critical info (quantity, deadline, budget, or scope) is missing.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_job',
      description: 'Create a multi-step job in the Agent dashboard when the customer has described a real project (items + deadline and/or budget). Do this BEFORE briefing any supplier.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          deadline: { type: 'string', description: 'ISO date or null' },
          budget: { type: 'number' },
          currency: { type: 'string', enum: ['ETB', 'USD'] },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                icon: { type: 'string' },
                role: { type: 'string', enum: ['agent', 'client', 'designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'] },
                auto: { type: 'boolean' },
              },
              required: ['label', 'role'],
            },
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brief_supplier',
      description: 'Pick an active supplier by role and DM them a brief. Only use AFTER a job exists and the owner has approved (or brain is running in full-agent mode). Will block if no matching team member is registered.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'] },
          brief: { type: 'string', description: 'The brief to send. 4-7 short lines. WHAT, QUANTITIES, DEADLINE, BUDGET, DELIVERABLES.' },
          job_id: { type: 'string' },
        },
        required: ['role', 'brief', 'job_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forward_attachments_to_supplier',
      description: 'Forward the customer\'s recent photos/PDFs to the supplier handling the given role. Call this right after brief_supplier.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          job_id: { type: 'string' },
        },
        required: ['role', 'job_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify_owner',
      description: 'Send the business owner a short Telegram note. Use for anything that needs their attention: approval required, escalation, unusual request.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Call this when you have nothing more to do for this turn.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } } },
    },
  },
];

// ────────────────────────────── Context builder ──────────────────────────────
async function buildContext({ business, customer, conversation, inboundText }) {
  const sb = supabase();

  const [{ data: products }, { data: team }, { data: jobs }, { data: recent }] = await Promise.all([
    sb.from('products').select('name, price, currency, stock_quantity, description')
      .eq('business_id', business.id).eq('is_active', true),
    sb.from('suppliers').select('id, name, role, contact_telegram, specialties')
      .eq('business_id', business.id).eq('is_active', true),
    sb.from('jobs').select('id, title, status, current_step')
      .eq('business_id', business.id).eq('customer_id', customer.id)
      .in('status', ['draft', 'awaiting_approval', 'active', 'blocked']).limit(5),
    sb.from('messages').select('direction, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false }).limit(14),
  ]);

  const catalog = (products || [])
    .map(p => `- ${p.name}: ${p.price ? `${p.price} ${p.currency || 'ETB'}` : 'price not set'}${p.stock_quantity != null ? ` (stock ${p.stock_quantity})` : ''}${p.description ? ` — ${p.description.slice(0, 80)}` : ''}`)
    .join('\n') || '(no products)';

  const teamRoster = (team || [])
    .map(t => `- ${t.name} (${t.role || 'unknown role'})${t.contact_telegram ? ' ✓ DM-able' : ' ⚠️ no Telegram ID'}${t.specialties ? ` — ${t.specialties}` : ''}`)
    .join('\n') || '(no team members yet — add them in /agent/team before briefing anyone)';

  const openJobs = (jobs || [])
    .map(j => `- ${j.id}: "${j.title}" · status:${j.status} · step:${j.current_step ?? 0}`)
    .join('\n') || '(no active jobs)';

  const history = (recent || [])
    .reverse()
    .map(m => `${m.direction === 'inbound' ? 'CLIENT' : 'ME'}: ${(m.content || '').slice(0, 280)}`)
    .join('\n') || '(new conversation)';

  return { catalog, teamRoster, openJobs, history };
}

// ────────────────────────────── Tool executors ──────────────────────────────
function makeTools({ token, business, customer, conversation, chatId, messageId, state }) {
  const sb = supabase();

  return {
    async reply_to_client({ text }) {
      await tg(token, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: messageId });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: text, content_type: 'text', status: 'sent',
        is_ai_generated: true, ai_model: 'agent-brain',
        telegram_chat_id: chatId, sent_at: new Date().toISOString(),
      });
      state.replied = true;
      return { ok: true };
    },

    async ask_client_question({ text }) {
      await tg(token, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: messageId });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: text, content_type: 'text', status: 'sent',
        is_ai_generated: true, ai_model: 'agent-brain',
        telegram_chat_id: chatId, sent_at: new Date().toISOString(),
      });
      state.replied = true;
      return { ok: true };
    },

    async create_job({ title, description, deadline, budget, currency, steps }) {
      const defaultSteps = [
        { label: 'Acknowledge client',     icon: '📥', role: 'agent',    auto: true },
        { label: 'Brief designer',         icon: '🎨', role: 'designer', auto: true },
        { label: 'Client approves design', icon: '👁️', role: 'client',   auto: false },
        { label: 'Send to printer',        icon: '🖨️', role: 'printer',  auto: true },
        { label: 'Arrange delivery',       icon: '🚚', role: 'delivery', auto: true },
        { label: 'Notify client complete', icon: '🎉', role: 'client',   auto: true },
      ];
      const job = await createJob({
        businessId: business.id,
        customerId: customer.id,
        conversationId: conversation.id,
        title, description,
        deadline: deadline || null,
        budget: budget || null,
        currency: currency || 'ETB',
        steps: (steps && steps.length) ? steps : defaultSteps,
        clientSnapshot: { name: customer.name, contact: customer.telegram_username ? `@${customer.telegram_username}` : null },
      });
      if (!job) return { ok: false, error: 'create failed' };
      state.created_job_id = job.id;
      return { ok: true, job_id: job.id };
    },

    async brief_supplier({ role, brief, job_id }) {
      const supplier = await pickSupplier({ businessId: business.id, role });
      if (!supplier) return { ok: false, error: `No ${role} on team. Call notify_owner to ask them to set it up.` };
      if (!supplier.contact_telegram) return { ok: false, error: `${supplier.name} has no Telegram ID on file.` };

      const sent = await tg(token, 'sendMessage', {
        chat_id: supplier.contact_telegram,
        text: brief,
      });
      await appendThread(job_id, {
        contactType: 'supplier', supplierId: supplier.id, role,
        title: `${supplier.name} — ${role}`,
        message: { from: 'me', text: brief, auto: true },
      });
      await logEvent(job_id, {
        kind: 'auto_sent', icon: '📨',
        title: `Briefed ${supplier.name}`, body: brief.slice(0, 300),
        auto: true, color: 'purple',
      });
      return { ok: true, supplier_id: supplier.id, supplier_name: supplier.name, message_id: sent?.result?.message_id };
    },

    async forward_attachments_to_supplier({ role, job_id }) {
      const supplier = await pickSupplier({ businessId: business.id, role });
      if (!supplier?.contact_telegram) return { ok: false, error: 'no dm-able supplier' };

      const { data: files } = await sb.from('messages')
        .select('telegram_file_id, telegram_file_type, telegram_file_name, content')
        .eq('customer_id', customer.id)
        .not('telegram_file_id', 'is', null)
        .order('created_at', { ascending: false }).limit(8);

      let n = 0;
      for (const f of (files || [])) {
        try {
          if (f.telegram_file_type === 'photo') {
            await tg(token, 'sendPhoto', { chat_id: supplier.contact_telegram, photo: f.telegram_file_id, caption: f.content?.slice(0, 200) });
            n++;
          } else if (f.telegram_file_type === 'document') {
            await tg(token, 'sendDocument', { chat_id: supplier.contact_telegram, document: f.telegram_file_id, caption: f.telegram_file_name });
            n++;
          }
        } catch {}
      }
      if (n) {
        await logEvent(job_id, {
          kind: 'auto_sent', icon: '📎',
          title: `Forwarded ${n} file${n > 1 ? 's' : ''} to ${supplier.name}`,
          auto: true, color: 'purple',
        });
      }
      return { ok: true, forwarded: n };
    },

    async notify_owner({ text }) {
      if (!business.owner_telegram_id) return { ok: false, error: 'no owner telegram id' };
      await tg(token, 'sendMessage', {
        chat_id: business.owner_telegram_id,
        text: `🧠 Alfred: ${text}`,
      });
      return { ok: true };
    },

    async finish({ summary }) {
      state.finished = true;
      state.summary = summary || null;
      return { ok: true };
    },
  };
}

// ────────────────────────────── Main loop ──────────────────────────────
export async function runBrain({ token, business, customer, conversation, chatId, messageId, inboundText }) {
  const sb = supabase();
  const started = Date.now();
  const state = { replied: false, finished: false, created_job_id: null, summary: null };
  const toolImpls = makeTools({ token, business, customer, conversation, chatId, messageId, state });
  const { catalog, teamRoster, openJobs, history } = await buildContext({ business, customer, conversation, inboundText });

  const system = `You are Alfred — the AI agent running ${business.name}${business.category ? ` (${business.category})` : ''}.
You ARE the business. Never say "check with us" — quote prices directly from the catalog.
You are autonomous: you choose which tools to call to best serve this customer right now.

## OPERATING PRINCIPLES
- Be concise. Ethiopian small-business tone. Amharic ok if the customer writes Amharic.
- PRICES: if the customer asks a price and the item is in the catalog, quote the exact number. No "contact us".
- If a message describes a MULTI-STEP project (quantities + deadline/budget), create_job FIRST, then reply_to_client with a short ack, then notify_owner to get approval.
- If you have info but something critical is missing (quantity, deadline, or budget for a project), use ask_client_question.
- Only brief_supplier AFTER the owner has approved (or the job is already active). For a brand-new job, STOP after create_job + reply_to_client + notify_owner so the owner can approve.
- If the customer simply orders a listed product, reply_to_client with a confirmation and notify_owner. Do not create a job for a single-product retail order.
- After replying, call finish.
- Never call reply_to_client twice in one turn unless strictly necessary.

## CATALOG
${catalog}

## TEAM ROSTER (who you can DM)
${teamRoster}

## OPEN JOBS FOR THIS CUSTOMER
${openJobs}

## RECENT CHAT HISTORY
${history}

## NOW
The customer just sent: """${inboundText}"""

Reason step by step, then call the right tools. End with finish.`;

  const messages = [{ role: 'system', content: system }];

  let iters = 0;
  const toolLog = [];

  while (iters < MAX_ITERS && !state.finished) {
    iters++;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || !msg.tool_calls.length) {
      // Model ended without calling finish — treat its content as a reply if we haven't replied yet.
      if (!state.replied && msg.content) {
        await toolImpls.reply_to_client({ text: msg.content });
        toolLog.push({ name: 'reply_to_client', args: { text: msg.content }, auto_fallback: true });
      }
      break;
    }

    for (const call of msg.tool_calls) {
      const fnName = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
      const impl = toolImpls[fnName];
      let result;
      if (!impl) {
        result = { ok: false, error: `unknown tool ${fnName}` };
      } else {
        try { result = await impl(args); }
        catch (e) { result = { ok: false, error: e.message }; }
      }
      toolLog.push({ name: fnName, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      if (fnName === 'finish') { state.finished = true; break; }
    }
  }

  const thoughtId = (await sb.from('agent_thoughts').insert({
    business_id: business.id,
    conversation_id: conversation.id,
    job_id: state.created_job_id || null,
    trigger: 'customer_msg',
    reasoning: messages.filter(m => m.role === 'assistant' && m.content).map(m => m.content).join('\n\n').slice(0, 4000),
    tool_calls: toolLog,
    outcome: state.summary || (state.replied ? 'replied' : 'no reply'),
    duration_ms: Date.now() - started,
    model: 'gpt-4o',
  }).select('id').single()).data?.id;

  return { replied: state.replied, thought_id: thoughtId, created_job_id: state.created_job_id };
}
