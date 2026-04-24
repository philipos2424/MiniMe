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
import { matchDocumentByIntent, downloadDocument } from './knowledge';
import { tgSendDocument } from './telegramApi';

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
      name: 'remember_about_client',
      description: 'Save a durable fact or preference about THIS client you just learned (their use case, industry, event type, budget ceiling, past purchase, style preference, role in their org, name of their company, etc.). Use liberally — these get loaded as CLIENT PROFILE on every future turn so replies can be personalized.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['preference', 'fact', 'commitment', 'note'] },
          content: { type: 'string', description: 'One concise sentence. Example: "Runs a wedding-planning business in Addis, usually orders branded stationery."' },
        },
        required: ['kind', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_catalog_file',
      description: 'Send the business\'s price list, menu, portfolio, or any uploaded document to the customer. Use this when the customer asks to SEE a file, price list, catalog, menu, brochure, or samples. Pass a short hint of what they asked for (e.g. "price list", "menu", "portfolio").',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What the customer is asking for — used to pick the right document.' },
        },
        required: ['query'],
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

  const [{ data: products }, { data: team }, { data: jobs }, { data: recent }, { data: memory }] = await Promise.all([
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
    sb.from('customer_memory').select('kind, content, created_at')
      .eq('customer_id', customer.id).eq('business_id', business.id)
      .order('created_at', { ascending: false }).limit(20),
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

  const memoryBlock = (memory || []).length
    ? (memory || []).map(m => `- [${m.kind}] ${m.content}`).join('\n')
    : '(nothing learned about this client yet)';

  const turnCount = (recent || []).filter(m => m.direction === 'inbound').length;

  return { catalog, teamRoster, openJobs, history, memoryBlock, turnCount };
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

    async remember_about_client({ kind, content }) {
      try {
        await sb.from('customer_memory').insert({
          customer_id: customer.id,
          business_id: business.id,
          kind: kind || 'note',
          content: (content || '').slice(0, 400),
          source: 'auto_extracted',
        });
        return { ok: true };
      } catch (e) {
        // Unique constraint — already remembered.
        if (String(e.message || '').includes('duplicate')) return { ok: true, duplicate: true };
        return { ok: false, error: e.message };
      }
    },

    async send_catalog_file({ query }) {
      try {
        const matches = await matchDocumentByIntent(query || 'price list', business.id, { threshold: 0.3, count: 1 });
        const doc = matches[0];
        if (!doc?.storage_path) return { ok: false, error: 'no matching document on file' };
        const buf = await downloadDocument(doc.storage_path);
        const caption = `📎 ${doc.title || doc.original_filename} — ${business.name}`;
        await tgSendDocument(token, chatId, buf, doc.original_filename || 'document.pdf', caption);
        await sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound', content: `[sent file: ${doc.original_filename}]`,
          content_type: 'document', status: 'sent',
          is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: new Date().toISOString(),
        });
        return { ok: true, filename: doc.original_filename };
      } catch (e) {
        return { ok: false, error: e.message };
      }
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
  const { catalog, teamRoster, openJobs, history, memoryBlock, turnCount } = await buildContext({ business, customer, conversation, inboundText });

  const system = `You are Alfred — the AI agent running ${business.name}${business.category ? ` (${business.category})` : ''}.
You ARE the business. You act on your own — you don't wait for permission to do normal things.

## HARD RULES — do not violate
- NEVER end a message with "feel free to ask", "let me know if you have any questions", "don't hesitate", "I'm here to help", "hope this helps", or any filler closer. End on the actual answer. Period.
- NEVER say "check with us", "contact us for pricing", "for the latest price". You ARE us. Quote the price directly from the CATALOG.
- NEVER invent prices, stock numbers, or product names. Only quote what is in the CATALOG below.
- NEVER say "I'll check and get back to you" unless you are calling notify_owner in the same turn.
- Keep replies short. 1–3 lines. Ethiopian small-business tone. Amharic if the customer wrote Amharic.

## HOW TO HANDLE REQUESTS

1. **Price question on a listed item** → reply_to_client with the exact price (× quantity if they said a number). That's it.

2. **"Show me the price list / menu / catalog / portfolio / samples"** → send_catalog_file IMMEDIATELY with their query. Do NOT promise to send — just send. Follow with a one-line note ("Here's our price list.") only if needed.

3. **Customer wants to order a listed product** ("I'll take 3", "can I get 2", "order please"):
   - If quantity is clear AND you have a price → the system will route this through checkout automatically — you won't even see it. If you DO see it, they're probably still exploring; confirm quantity with ask_client_question.
   - If quantity OR item is unclear → ask_client_question ("How many would you like?" / "Which one — X or Y?").

4. **Multi-step project** (events, branding packages, multiple item types with a deadline/budget):
   - create_job first with title, description, and 4-7 pipeline steps matching the actual roles needed (designer/printer/delivery/etc.).
   - Then reply_to_client with a crisp ack (one sentence).
   - Then notify_owner so they can approve.
   - STOP there. Do NOT brief_supplier until the owner approves — the dashboard handles that.

5. **Vague project** ("we need stuff for our event") → ONE ask_client_question that asks for the 2-3 most important missing pieces in one question. Don't interrogate.

6. **Out of scope / weird / suspicious** → notify_owner with a one-line summary and reply_to_client honestly ("Let me check on that — give me a moment.").

## DISCOVERY — GET CURIOUS ABOUT EACH CLIENT
Don't just answer transactionally. You want repeat customers — that happens when your reply feels *made for them*.

- In the first 2–3 turns with a new or not-yet-profiled client, work in ONE natural open-ended question to learn context before you pitch anything. Examples:
  • "What's the occasion?"
  • "Who's this for — personal or for your business?"
  • "How are you planning to use them?"
  • "What's the look you have in mind?"
  • "Is this for a one-off event or something ongoing?"
  One question per turn, max. Never interrogate.

- When you learn something useful (industry, event type, their company name, their budget ceiling, their style, a past purchase, who they're buying for), IMMEDIATELY call remember_about_client in the same turn. Don't ask them the same thing twice across conversations.

- When replying, USE the CLIENT PROFILE to curate:
  • Match the right product tier to their budget/context.
  • Reference what they told you last time ("since you're planning a wedding, …").
  • Surface the document that fits (portfolio for corporate, menu for cafés).

- If CLIENT PROFILE already tells you what you need, DON'T ask again — just give the curated answer directly.

## EXECUTION
- You can call multiple tools per turn. Chain them.
- Always call finish last.
- Never call reply_to_client twice in one turn.
- A typical discovery turn looks like: reply_to_client (with a short answer + one open-ended question) → remember_about_client (what you already learned from this message) → finish.

## CATALOG
${catalog}

## TEAM ROSTER (who you can DM)
${teamRoster}

## CLIENT PROFILE — what we've learned about this specific customer
${memoryBlock}

## OPEN JOBS FOR THIS CUSTOMER
${openJobs}

## RECENT CHAT HISTORY (turn count so far: ${turnCount})
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
