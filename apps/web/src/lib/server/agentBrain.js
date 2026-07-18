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
import { makeOpenAI } from './openaiClient';
import { supabase } from './db';
import { tg } from './telegramApi';
import { createJob, logEvent, appendThread } from './jobs';
import { pickSupplier, generateBrief } from './jobFanout';
import { matchDocumentByIntent, downloadDocument, retrieveRelevantChunks } from './knowledge';
import { tgSendDocument } from './telegramApi';
import { ingestUrl } from './webIngest';
import { ensureRollingSummary, fetchPastConversationDigests } from './conversationMemory';
import { MODEL, MODEL_MINI } from './constants';

// Use the fast mini model for the brain reasoning loop.
// gpt-4.1-mini handles tool calling well and is ~4x faster than gpt-4.1.
// We only switch to gpt-4.1 for create_order (financial accuracy matters).
const BRAIN_MODEL = MODEL_MINI;
const ORDER_MODEL = MODEL; // gpt-4.1 for create_order accuracy

const openai = makeOpenAI();

// Max brain iterations:
// - 2 handles 95% of real conversations (1 tool call + optional follow-up)
// - More iters means slower responses; fall-back reply fires on last iter
const MAX_ITERS = 2;

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
        required: ['role', 'brief'],
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
      name: 'create_order',
      description: "Create a real order + Chapa payment link. Call this as soon as you have a usable order — items+quantities, delivery (address or 'pickup'), phone. ALSO call it autonomously when the client has already given you everything you need; you don't need a verbal 'yes' if the data is clear. If a CATALOG exists, items must match catalog products. If no catalog exists, pass items with unit_price from the conversation. Returns a Chapa checkout URL — include it in your reply.",
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                product_name: { type: 'string' },
                quantity: { type: 'integer', minimum: 1 },
                unit_price: { type: 'number', description: 'Required only when the business has no catalog products. The agreed price per unit from the conversation.' },
              },
              required: ['product_name', 'quantity'],
            },
          },
          delivery_address: { type: 'string', description: 'Full delivery address, OR "pickup" if collecting in-store.' },
          phone: { type: 'string', description: 'Customer phone for the courier. If client did not give one, ask once; if they decline, pass "not provided".' },
          deadline_iso: { type: 'string', description: 'Deadline as ISO date YYYY-MM-DD. Resolve relative phrases: "tomorrow" / "next Friday" / "በሳምንት ውስጥ" → an actual date based on today. Leave null only if the client truly did not specify.' },
          deadline_label: { type: 'string', description: 'How the client phrased the deadline (e.g. "by Friday", "next week"). Saved for context.' },
          notes: { type: 'string', description: 'Personalization, special requests, design references, anything the supplier needs.' },
        },
        required: ['items', 'delivery_address', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_product_photo',
      description: "Send the customer a photo of a specific product. Use it (a) when they ask anything visual — 'what does it look like', 'show me', 'do you have a picture', 'sample' — AND (b) proactively whenever they enquire about a specific catalog product (availability, price, details) that has a photo and you haven't already sent that product's photo in this conversation: seeing the item sells it. The product MUST be in the CATALOG. If multiple products match (e.g. 'cards'), send the best match first; you can call again for others. If the matched product has no image_url uploaded, the tool returns ok:false with reason 'no image' — fall back to share_links (portfolio/instagram) and tell the client honestly.",
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: "The product name from the CATALOG (case-insensitive partial match accepted)." },
          caption: { type: 'string', description: 'Optional one-line caption sent with the photo.' },
        },
        required: ['product_name'],
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
      name: 'share_links',
      description: 'Send the business\'s public links to the customer — any combination of website, portfolio, Instagram, Facebook, TikTok, Telegram channel, WhatsApp, address, business hours. Pick only what is relevant (e.g. portfolio + Instagram for a design/creative ask; menu/site for food; WhatsApp/address for a visit). Works even without any text — the tool renders a tidy message. You can include a short lead-in message.',
      parameters: {
        type: 'object',
        properties: {
          include: {
            type: 'array',
            description: 'Which link fields to include.',
            items: { type: 'string', enum: ['website', 'portfolio', 'instagram', 'facebook', 'tiktok', 'telegram_channel', 'whatsapp', 'address', 'hours'] },
          },
          lead_in: { type: 'string', description: 'Optional one-line message before the links.' },
        },
        required: ['include'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the open web for fresh information when the answer isn\'t in CATALOG / KNOWLEDGE BASE / your memory. Returns up to 8 result links with titles + snippets. After picking a relevant one, call research_url to ingest it into the KB and use it. Good for: looking up a client\'s company, current event details, supplier alternatives, prices in the market.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_url',
      description: 'Fetch a web page (the business\'s own website, the client\'s website, a reference URL the client pasted, a portfolio page) and ingest it into the knowledge base. Use this to LEARN about a client\'s company before replying, or to refresh MiniMe\'s knowledge of your own site. Returns a summary of what was found. Future turns can retrieve from it automatically.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          purpose: { type: 'string', enum: ['self', 'client', 'reference'], description: 'self = our own site/portfolio; client = learn about the client; reference = a sample/inspiration they shared.' },
        },
        required: ['url'],
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

  // Fetch all context in parallel — limit aggressively for speed
  const [{ data: products }, { data: team }, { data: jobs }, { data: allMessagesAsc }, { data: memory }, kbChunks] = await Promise.all([
    sb.from('products').select('name, price, currency, stock_quantity, image_url')
      .eq('business_id', business.id).eq('is_active', true).limit(30), // top 30 products only
    sb.from('suppliers').select('id, name, role, contact_telegram, specialties')
      .eq('business_id', business.id).eq('is_active', true),
    sb.from('jobs').select('id, title, status, current_step')
      .eq('business_id', business.id).eq('customer_id', customer.id)
      .in('status', ['draft', 'awaiting_approval', 'active', 'blocked']).limit(3),
    sb.from('messages').select('direction, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false }).limit(20) // last 20 only — then reverse
      .then(r => ({ data: (r.data || []).reverse() })),
    sb.from('customer_memory').select('kind, content')
      .eq('customer_id', customer.id).eq('business_id', business.id)
      .order('created_at', { ascending: false }).limit(10), // top 10 facts
    // KB retrieval in parallel — hard 5s timeout so it never blocks
    Promise.race([
      retrieveRelevantChunks(inboundText || '', business.id, { count: 3, threshold: 0.22 }),
      new Promise(resolve => setTimeout(() => resolve([]), 5000)),
    ]).catch(() => []),
  ]);

  // Use all fetched messages as the recent context (already limited to 20)
  const recent = allMessagesAsc || [];
  // Skip rolling summary and past convos for speed — they add 200-400ms
  // and are only valuable for long-running customer relationships.
  // TODO: re-enable for conversations with >50 messages
  const longSummary = null;
  const pastDigests = [];

  const catalog = (products || [])
    .map(p => `- ${p.name}: ${p.price ? `${p.price} ${p.currency || 'ETB'}` : 'price not set'}${p.stock_quantity != null ? ` (stock ${p.stock_quantity})` : ''}${p.image_url ? ' [📸 photo available]' : ''}${p.description ? ` — ${p.description.slice(0, 80)}` : ''}`)
    .join('\n') || '(no products — if customer asks about pricing, call notify_owner with a brief note that they should add their products/menu to the catalog, then tell customer "Let me check with the team and get back to you shortly")';

  const teamRoster = (team || [])
    .map(t => `- ${t.name} (${t.role || 'unknown role'})${t.contact_telegram ? ' ✓ DM-able' : ' ⚠️ no Telegram ID'}${t.specialties ? ` — ${t.specialties}` : ''}`)
    .join('\n') || '(no team members yet — add them in /agent/team before briefing anyone)';

  const openJobs = (jobs || [])
    .map(j => `- ${j.id}: "${j.title}" · status:${j.status} · step:${j.current_step ?? 0}`)
    .join('\n') || '(no active jobs)';

  const history = (recent || [])
    .map(m => `${m.direction === 'inbound' ? 'CLIENT' : 'ME'}: ${(m.content || '').slice(0, 280)}`)
    .join('\n') || '(new conversation)';

  const earlierBlock = longSummary
    ? `(Earlier in this same chat — summary)\n${longSummary}`
    : '';

  const pastConvBlock = (pastDigests || []).length
    ? pastDigests.map(d => `- ${String(d.at).slice(0, 10)}: ${d.digest.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    : '(no past conversations with this customer)';

  const memoryBlock = (memory || []).length
    ? (memory || []).map(m => `- [${m.kind}] ${m.content}`).join('\n')
    : '(nothing learned about this client yet)';

  const turnCount = (recent || []).filter(m => m.direction === 'inbound').length;

  const linksBlock = [
    business.website && `website: ${business.website}`,
    business.portfolio_url && `portfolio: ${business.portfolio_url}`,
    business.instagram && `instagram: ${business.instagram}`,
    business.facebook && `facebook: ${business.facebook}`,
    business.tiktok && `tiktok: ${business.tiktok}`,
    business.telegram_channel && `telegram channel: ${business.telegram_channel}`,
    business.whatsapp && `whatsapp: ${business.whatsapp}`,
    business.address && `address: ${business.address}`,
    business.business_hours && `hours: ${business.business_hours}`,
  ].filter(Boolean).join('\n') || '(no public links configured — owner should add them in /settings)';

  // Use pre-fetched KB chunks (fetched in parallel above)
  let kbBlock = '';
  if (kbChunks && kbChunks.length) {
    kbBlock = kbChunks.map((c, i) => `[${i + 1}] ${(c.content || '').slice(0, 400)}`).join('\n\n');
  }

  // ⚠️ AUTO-INGEST REMOVED — ingestUrl can take 30+ seconds and causes Telegram
  // webhook timeouts (Vercel 60s limit). Website ingestion now happens lazily via
  // the /api/teach endpoint or the auto-learn cron, not inline during message handling.

  return { catalog, teamRoster, openJobs, history, earlierBlock, pastConvBlock, memoryBlock, turnCount, linksBlock, kbBlock };
}

// ────────────────────────────── Tool executors ──────────────────────────────
function makeTools({ token, business, customer, conversation, chatId, messageId, state, inboundText }) {
  const sb = supabase();
  const isAmharicConversation = /[ሀ-፿]/.test(inboundText || '');

  return {
    async reply_to_client({ text }) {
      // Polish Amharic replies with Addis AI — hard 4s timeout to never block the response
      let finalText = text;
      if (isAmharicConversation) {
        try {
          const { translateToAmharic } = await import('./addisAI');
          const polished = await Promise.race([
            translateToAmharic(text),
            new Promise((_, reject) => setTimeout(() => reject(new Error('addis-ai timeout')), 4000)),
          ]);
          if (polished && polished.length > 10) finalText = polished;
        } catch { /* keep original text on timeout or error */ }
      }
      // VERIFY delivery — never record 'sent' for a send Telegram rejected.
      // If it failed, leave state.replied=false so the caller falls through to
      // the slow-path retry + owner-draft instead of going silent.
      const sendRes = await tg(token, 'sendMessage', { chat_id: chatId, text: finalText, reply_to_message_id: messageId });
      const delivered = sendRes?.ok === true;
      if (!delivered) console.error(`[brain-reply-FAILED] biz=${business.id} chat=${chatId} tg="${sendRes?.description || 'unknown'}"`);
      await Promise.all([
        sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound', content: finalText, content_type: 'text',
          status: delivered ? 'sent' : 'failed',
          is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: delivered ? new Date().toISOString() : null,
        }),
        sb.from('conversations').update({
          requires_owner: !delivered,
          last_ai_action: delivered ? 'auto_sent' : 'send_failed',
          last_message_at: new Date().toISOString(),
        }).eq('id', conversation.id),
      ]);
      state.replied = delivered;
      return { ok: true };
    },

    async ask_client_question({ text }) {
      // Polish Amharic — same 4s hard timeout as reply_to_client
      let finalText = text;
      if (isAmharicConversation) {
        try {
          const { translateToAmharic } = await import('./addisAI');
          const polished = await Promise.race([
            translateToAmharic(text),
            new Promise((_, reject) => setTimeout(() => reject(new Error('addis-ai timeout')), 4000)),
          ]);
          if (polished && polished.length > 10) finalText = polished;
        } catch { /* keep original on timeout */ }
      }
      // VERIFY delivery — never record 'sent' for a send Telegram rejected.
      // If it failed, leave state.replied=false so the caller falls through to
      // the slow-path retry + owner-draft instead of going silent.
      const sendRes = await tg(token, 'sendMessage', { chat_id: chatId, text: finalText, reply_to_message_id: messageId });
      const delivered = sendRes?.ok === true;
      if (!delivered) console.error(`[brain-reply-FAILED] biz=${business.id} chat=${chatId} tg="${sendRes?.description || 'unknown'}"`);
      await Promise.all([
        sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound', content: finalText, content_type: 'text',
          status: delivered ? 'sent' : 'failed',
          is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: delivered ? new Date().toISOString() : null,
        }),
        sb.from('conversations').update({
          requires_owner: !delivered,
          last_ai_action: delivered ? 'auto_sent' : 'send_failed',
          last_message_at: new Date().toISOString(),
        }).eq('id', conversation.id),
      ]);
      state.replied = delivered;
      return { ok: true };
    },

    async create_job({ title, description, deadline, budget, currency, steps }) {
      // Sanitize all LLM-provided fields before DB insertion
      const safeTitle = (String(title || '').replace(/[<>&"'`]/g, '').trim()).slice(0, 200);
      if (!safeTitle) return { ok: false, error: 'title is required' };
      const safeDesc = (String(description || '').replace(/[<>]/g, '')).slice(0, 3000);
      const safeDeadline = deadline ? String(deadline).slice(0, 50).replace(/[^0-9\-TZ:.]/g, '') : null;
      const safeBudget = budget != null ? Math.min(Math.max(0, Number(budget) || 0), 100_000_000) : null;
      const safeCurrency = ['ETB', 'USD', 'EUR', 'GBP'].includes(currency) ? currency : 'ETB';

      const defaultSteps = [
        { label: 'Acknowledge client',     icon: '📥', role: 'agent',    auto: true },
        { label: 'Brief designer',         icon: '🎨', role: 'designer', auto: true },
        { label: 'Client approves design', icon: '👁️', role: 'client',   auto: false },
        { label: 'Send to printer',        icon: '🖨️', role: 'printer',  auto: true },
        { label: 'Arrange delivery',       icon: '🚚', role: 'delivery', auto: true },
        { label: 'Notify client complete', icon: '🎉', role: 'client',   auto: true },
      ];
      // Sanitize steps if provided — cap array and each field
      const safeSteps = (Array.isArray(steps) && steps.length)
        ? steps.slice(0, 10).map(s => ({
            label: (String(s.label || '').replace(/[<>&"]/g, '')).slice(0, 100),
            icon:  (String(s.icon  || '')).slice(0, 10),
            role:  (String(s.role  || 'agent').replace(/[^a-z_]/gi, '')).slice(0, 50),
            auto:  !!s.auto,
          }))
        : defaultSteps;

      const job = await createJob({
        businessId: business.id,
        customerId: customer.id,
        conversationId: conversation.id,
        title: safeTitle, description: safeDesc,
        deadline: safeDeadline,
        budget: safeBudget,
        currency: safeCurrency,
        steps: safeSteps,
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

      const jobId = job_id || state.created_job_id || null;

      const sent = await tg(token, 'sendMessage', {
        chat_id: supplier.contact_telegram,
        text: brief,
      });
      if (jobId) {
        await appendThread(jobId, {
          contactType: 'supplier', supplierId: supplier.id, role,
          title: `${supplier.name} — ${role}`,
          message: { from: 'me', text: brief, auto: true },
        });
        await logEvent(jobId, {
          kind: 'auto_sent', icon: '📨',
          title: `Briefed ${supplier.name}`, body: brief.slice(0, 300),
          auto: true, color: 'purple',
        });
        // Flip job to active so owner sees it's running, not waiting.
        await sb.from('jobs').update({ status: 'active' }).eq('id', jobId).in('status', ['draft', 'awaiting_approval']);
      }
      return { ok: true, supplier_id: supplier.id, supplier_name: supplier.name, message_id: sent?.result?.message_id };
    },

    async forward_attachments_to_supplier({ role, job_id }) {
      const supplier = await pickSupplier({ businessId: business.id, role });
      if (!supplier?.contact_telegram) return { ok: false, error: 'no dm-able supplier' };
      const jobId = job_id || state.created_job_id || null;

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
      if (n && jobId) {
        await logEvent(jobId, {
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

    async create_order({ items, delivery_address, phone, deadline_iso, deadline_label, deadline, notes }) {
      try {
        // ── Sanitize all LLM-provided fields ──────────────────────────────────
        if (!Array.isArray(items) || !items.length) return { ok: false, error: 'no items' };
        if (items.length > 50) return { ok: false, error: 'too many items (max 50)' };

        // Sanitize address and phone — these come from OpenAI, not directly from customer
        const safeAddress = (String(delivery_address || '').replace(/[<>&"]/g, '').trim()).slice(0, 300);
        const safePhone   = (String(phone || '').replace(/[^0-9+\-() ]/g, '').trim()).slice(0, 30);
        if (!safeAddress || !safePhone) return { ok: false, error: 'delivery and phone required' };

        const safeNotes  = notes ? (String(notes).replace(/[<>]/g, '')).slice(0, 1000) : null;
        const dlIso = deadline_iso ? String(deadline_iso).replace(/[^0-9\-T]/g, '').slice(0, 10) : null;
        const dlLabel = (deadline_label || deadline)
          ? String(deadline_label || deadline).replace(/[<>&]/g, '').slice(0, 100)
          : null;

        const { data: products } = await sb.from('products')
          .select('id, name, name_am, price, currency, stock_quantity')
          .eq('business_id', business.id).eq('is_active', true);

        const matched = [];
        const hasProducts = products?.length > 0;

        for (const req of items) {
          const q = (req.product_name || '').trim().toLowerCase();
          const qty = Math.max(1, Math.floor(Number(req.quantity) || 1));
          const price = Number(req.unit_price || req.price || 0);

          if (hasProducts) {
            // Match against the catalog
            const score = p => {
              const hay = `${p.name || ''} ${p.name_am || ''}`.toLowerCase();
              if (hay === q) return 5;
              if (hay.includes(q)) return 3;
              return q.split(/\s+/).filter(Boolean).reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
            };
            const best = products.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]?.p;
            if (!best) return { ok: false, error: `no product matches "${req.product_name}" — ask the customer to clarify or add the item to your catalog first` };
            if (best.stock_quantity != null && best.stock_quantity < qty) {
              return { ok: false, error: `only ${best.stock_quantity} of ${best.name} in stock` };
            }
            const unit = Number(best.price) || price;
            matched.push({
              product_id: best.id, name: best.name, quantity: qty,
              unit_price: unit, subtotal: Number((unit * qty).toFixed(2)),
              currency: best.currency || 'ETB',
            });
          } else {
            // No catalog — accept free-form items with prices from conversation
            if (!price && !req.unit_price) {
              return { ok: false, error: `price for "${req.product_name}" not provided — confirm the price with the customer before creating the order` };
            }
            matched.push({
              name: req.product_name || 'Item', quantity: qty,
              unit_price: price, subtotal: Number((price * qty).toFixed(2)),
              currency: 'ETB',
            });
          }
        }

        const currency = matched[0].currency;
        const total = Number(matched.reduce((s, it) => s + it.subtotal, 0).toFixed(2));

        // Save sanitized phone on the customer for future orders
        if (safePhone && safePhone !== customer.phone) {
          await sb.from('customers').update({ phone: safePhone }).eq('id', customer.id);
        }

        const { data: order, error: orderErr } = await sb.from('orders').insert({
          business_id: business.id,
          customer_id: customer.id,
          conversation_id: conversation.id,
          items: matched,
          subtotal: total, total, currency,
          status: 'pending_payment',
          source: 'bot',
          customer_note: [
            safeAddress && `Deliver to: ${safeAddress}`,
            safePhone && safePhone !== 'not provided' && `Phone: ${safePhone}`,
            dlIso && `By: ${dlIso}`,
            !dlIso && dlLabel && `By (loose): ${dlLabel}`,
            notes,
          ].filter(Boolean).join(' · ').slice(0, 1000),
        }).select().single();
        if (orderErr || !order) return { ok: false, error: orderErr?.message || 'order create failed' };

        // Generate payment options based on what's enabled
        const pmts = business.notification_prefs?.payments || { chapa: true };
        let checkoutUrl = null;
        const inlineButtons = [];

        if (pmts.chapa !== false) {
          try {
            const { generateChapaLink } = await import('./replyEngine');
            const link = await generateChapaLink(business, { ...customer, phone: safePhone }, order, matched, total, currency);
            if (link?.url) {
              await sb.from('orders').update({ chapa_tx_ref: link.txRef, checkout_url: link.url }).eq('id', order.id);
              checkoutUrl = link.url;
              inlineButtons.push([{ text: '💳 Pay with Chapa', url: link.url }]);
            }
          } catch (e) {
            console.warn('chapa link failed:', e.message);
          }
        }

        if (pmts.telegram_stars && currency === 'ETB') {
          const starsAmount = Math.max(1, Math.round(total * (pmts.stars_per_etb || 1)));
          inlineButtons.push([{ text: `⭐ Pay ${starsAmount.toLocaleString()} Stars`, callback_data: `pay_stars_${order.id}` }]);
        }

        if (pmts.cbe_manual && pmts.cbe_account) {
          inlineButtons.push([{ text: '🏦 Pay via CBE transfer', callback_data: `pay_cbe_${order.id}` }]);
        }

        const orderNum = order.id.slice(-6).toUpperCase();

        // Happy path — at least one payment method renderable. Send the order
        // summary with pay buttons; that message is the AUTHORITATIVE confirmation.
        if (inlineButtons.length) {
          const summary = matched.map(it => `• ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${it.currency}`).join('\n');
          const deliverLine = safeAddress && safeAddress !== 'pickup'
            ? `\n📍 Deliver to: ${safeAddress}`
            : safeAddress === 'pickup' ? `\n🏪 Pickup in-store` : '';
          const phoneLine = safePhone && safePhone !== 'not provided' ? `\n📱 ${safePhone}` : '';
          const deadlineLine = dlLabel ? `\n⏰ By: ${dlLabel}` : '';
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `🧾 *Order #${orderNum}*\n\n${summary}${deliverLine}${phoneLine}${deadlineLine}\n\n*Total: ${total.toLocaleString()} ${currency}*\n\nPick how you'd like to pay:`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineButtons },
          });
          state.replied = true;
          return { ok: true, order_id: order.id, total, currency, items_count: matched.length, checkout_url: checkoutUrl, payment_methods: inlineButtons.length };
        }

        // ── No payment method could be presented (e.g. Chapa link failed AND no
        //    fallback enabled). The order ROW exists but the customer has NO way
        //    to pay yet and NO confirmation. Never let this be silent or let the
        //    brain spin it as success — send an honest holding message, flag the
        //    turn so the post-loop guardrail escalates to the owner, and return a
        //    result that tells the model the truth.
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `🧾 Order #${orderNum} saved (total ${total.toLocaleString()} ${currency}).\n\nI'm setting up your payment details — someone from ${business.name} will send them to you shortly. 🙏`,
        });
        await sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound', content: `[order #${orderNum} saved — payment link pending owner follow-up]`,
          content_type: 'text', status: 'sent', is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: new Date().toISOString(),
        });
        state.replied = true;
        state.payment_setup_failed = { order_id: order.id, order_num: orderNum, total, currency };
        return {
          ok: true,
          order_id: order.id, total, currency, items_count: matched.length,
          checkout_url: null, payment_methods: 0,
          payment_pending: true,
          note: 'Order saved but NO payment link could be generated. Customer was told the team will follow up. Do NOT send a payment link or claim payment is set up — the owner is being notified to handle it.',
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async send_product_photo({ product_name, caption }) {
      try {
        const q = (product_name || '').trim().toLowerCase();
        if (!q) return { ok: false, error: 'no product_name' };
        const { data: products } = await sb.from('products')
          .select('id, name, name_am, price, currency, image_url, description')
          .eq('business_id', business.id).eq('is_active', true);
        if (!products?.length) return { ok: false, error: 'no products in catalog' };
        // Score by simple substring + word match
        const score = p => {
          const hay = `${p.name || ''} ${p.name_am || ''}`.toLowerCase();
          if (hay.includes(q)) return 3;
          const words = q.split(/\s+/).filter(Boolean);
          return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
        };
        const ranked = products.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
        const match = ranked[0]?.p;
        if (!match) return { ok: false, error: `no product matches "${product_name}"` };
        if (!match.image_url) return { ok: false, error: 'no image', product_name: match.name };
        const text = caption || `${match.name}${match.price ? ` — ${match.price} ${match.currency || 'ETB'}` : ''}`;
        await tg(token, 'sendPhoto', { chat_id: chatId, photo: match.image_url, caption: text });
        await sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound', content: `[sent photo: ${match.name}] ${text}`,
          content_type: 'image', status: 'sent',
          is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: new Date().toISOString(),
        });
        state.replied = true;
        return { ok: true, product_name: match.name };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async send_catalog_file({ query }) {
      try {
        const matches = await matchDocumentByIntent(query || 'price list menu catalog', business.id, { threshold: 0.15, count: 3 });
        // Pick best match — prefer files that are specifically tagged for sending
        const doc = matches[0];
        if (!doc?.storage_path) return { ok: false, error: 'no matching file found — ask the owner to upload one via Settings → Files' };

        const isImage = doc.mime_type?.startsWith('image/') || doc.meta?.is_image;
        const fileUrl = doc.meta?.file_url;
        const caption = `📎 *${doc.title || doc.original_filename}*\nFrom ${business.name}`;

        if (isImage && fileUrl) {
          // Send as photo using the public URL (fast — no download needed)
          await tg(token, 'sendPhoto', {
            chat_id: chatId,
            photo: fileUrl,
            caption,
            parse_mode: 'Markdown',
          });
        } else {
          // Download and send as document (PDF, Word, etc.)
          const buf = await Promise.race([
            downloadDocument(doc.storage_path),
            new Promise((_, reject) => setTimeout(() => reject(new Error('download timeout')), 15000)),
          ]);
          await tgSendDocument(token, chatId, buf, doc.original_filename || 'document.pdf', caption);
        }

        await sb.from('messages').insert({
          conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
          direction: 'outbound',
          content: `[sent ${isImage ? 'photo' : 'file'}: ${doc.original_filename || doc.title}]`,
          content_type: isImage ? 'photo' : 'document', status: 'sent',
          is_ai_generated: true, ai_model: 'agent-brain',
          telegram_chat_id: chatId, sent_at: new Date().toISOString(),
          file_url: fileUrl || null,
        });
        return { ok: true, filename: doc.original_filename, type: isImage ? 'photo' : 'document' };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async share_links({ include = [], lead_in }) {
      const map = {
        website: business.website && `🌐 Website: ${business.website}`,
        portfolio: business.portfolio_url && `🎨 Portfolio: ${business.portfolio_url}`,
        instagram: business.instagram && `📸 Instagram: ${business.instagram.startsWith('http') ? business.instagram : `https://instagram.com/${business.instagram.replace(/^@/, '')}`}`,
        facebook: business.facebook && `📘 Facebook: ${business.facebook.startsWith('http') ? business.facebook : `https://facebook.com/${business.facebook}`}`,
        tiktok: business.tiktok && `🎵 TikTok: ${business.tiktok.startsWith('http') ? business.tiktok : `https://tiktok.com/@${business.tiktok.replace(/^@/, '')}`}`,
        telegram_channel: business.telegram_channel && `📣 Telegram: ${business.telegram_channel.startsWith('http') ? business.telegram_channel : `https://t.me/${business.telegram_channel.replace(/^@/, '')}`}`,
        whatsapp: business.whatsapp && `💬 WhatsApp: ${business.whatsapp}`,
        address: business.address && `📍 ${business.address}`,
        hours: business.business_hours && `🕒 ${business.business_hours}`,
      };
      const lines = include.map(k => map[k]).filter(Boolean);
      if (!lines.length) return { ok: false, error: 'none of the requested links are set on the business profile' };
      const body = [lead_in, ...lines].filter(Boolean).join('\n');
      await tg(token, 'sendMessage', { chat_id: chatId, text: body, disable_web_page_preview: false });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: body, content_type: 'text', status: 'sent',
        is_ai_generated: true, ai_model: 'agent-brain',
        telegram_chat_id: chatId, sent_at: new Date().toISOString(),
      });
      state.replied = true;
      return { ok: true, sent: lines.length };
    },

    async web_search({ query }) {
      try {
        const { searchWeb } = await import('./webSearch');
        const results = await searchWeb(query, { count: 6 });
        if (!results.length) return { ok: false, error: 'no results' };
        return { ok: true, results };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    async research_url({ url, purpose }) {
      const result = await ingestUrl({ businessId: business.id, url, tag: purpose === 'self' ? 'website' : purpose === 'client' ? 'client-research' : 'reference' });
      if (!result.ok) return result;
      // Pull a brief summary from the freshly ingested content for THIS turn's reasoning.
      const chunks = await retrieveRelevantChunks(inboundText || url, business.id, { count: 3, threshold: 0.2 });
      const snippet = chunks.map(c => c.content).join('\n---\n').slice(0, 1200);
      return { ok: true, title: result.title, chars: result.chars, chunks: result.chunks, summary_snippet: snippet || '(ingested; will be used on next retrieval)' };
    },

    async notify_owner({ text }) {
      const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
      if (!ownerChat) return { ok: false, error: 'no owner chat id' };
      const { customerHeader } = await import('./mentions');
      const header = customerHeader(customer);
      const body = `🤖 *MiniMe*\n\n${header ? header + '\n\n' : ''}${text}`;
      await tg(token, 'sendMessage', {
        chat_id: ownerChat,
        text: body,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
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
  const state = { replied: false, finished: false, created_job_id: null, summary: null, payment_setup_failed: null };
  const toolImpls = makeTools({ token, business, customer, conversation, chatId, messageId, state, inboundText });
  // Hard 10s cap on context building — never let slow DB/embeddings queries block the brain
  const ctxTimeout = new Promise(resolve => setTimeout(() => resolve({
    catalog: '(context loading timed out)', teamRoster: '', openJobs: '', history: '',
    earlierBlock: '', pastConvBlock: '', memoryBlock: '', turnCount: 0, linksBlock: '', kbBlock: '',
  }), 10000));
  const { catalog, teamRoster, openJobs, history, earlierBlock, pastConvBlock, memoryBlock, turnCount, linksBlock, kbBlock } =
    await Promise.race([buildContext({ business, customer, conversation, inboundText }), ctxTimeout]);

  // Dynamic product examples — NEVER hardcode specific business products in the prompt
  const ex1 = catalog.length > 0 ? catalog[0] : null;
  const ex2 = catalog.length > 1 ? catalog[1] : null;
  const exName = ex1 ? ex1.name : 'our product';
  const exPrice = ex1 ? `${ex1.price || '???'} ${ex1.currency || 'ETB'}` : '500 ETB';
  const exName2 = ex2 ? ex2.name : 'another product';
  const exPrice2 = ex2 ? `${ex2.price || '???'} ${ex2.currency || 'ETB'}` : '800 ETB';

  // Build owner rules block — these override all defaults
  const ownerRules = (business.owner_instructions || []);
  const ownerRulesBlock = ownerRules.length
    ? `\n## OWNER'S RULES — ALWAYS FOLLOW (override all defaults below):\n${ownerRules.map(r => `- ${r.rule}`).join('\n')}\n`
    : '';

  const system = [
    `You ARE "${business.name}"${business.category ? ` (${business.category})` : ''} — reply AS the business, not about it.`,

    ownerRulesBlock || '',

    `PERSONA: Warm, direct, human. Use customer's name. Mirror Amharic ↔ English. Short replies (1-4 lines). Ask ONE question when info is missing. Never say "feel free to ask", "let me know", "I'm here to help".`,

    `AMHARIC: Spoken everyday style ("ሰላም!", "እሺ", "አሪፍ", "ጥሩ"). NEVER Latin transliteration. Mix English business terms (ETB, delivery, discount) naturally.`,

    `RULES:
- Quote prices from CATALOG only — never invent them.
- Never say "check with us" or "contact us for pricing" — you ARE us.
- Never claim something happened (order prepared, delivery scheduled) unless a tool just confirmed it.
- If a tool returns ok:false, NEVER pretend it worked. Be honest with the customer ("let me sort this out and come right back to you"). The owner is alerted automatically for order/supplier failures — you do not need to apologise repeatedly or invent next steps.
- First message: greet warmly, ask what they need — don't dump catalog.
- Low-signal messages (hi, ok, 👍, sticker): brief ack + one open question.`,

    `ORDERS: When customer wants to buy — collect (a) item+qty, (b) address or "pickup", (c) phone. Once you have all three, call create_order immediately. The create_order tool sends its OWN order summary + payment buttons — that is the authoritative confirmation. Do NOT type your own "order placed" message, do NOT fabricate or paste a payment link, do NOT echo the order number before the tool has run. If create_order returns payment_pending:true, the order was saved but no payment link exists yet — the customer has already been told the team will follow up; just acknowledge briefly and move on. If catalog is empty, confirm price first then pass unit_price.`,

    `DESIGN/CUSTOM: Gather brief (purpose, name, colors, text, deadline, qty) one question at a time. When complete: create_job → brief_supplier(designer) → forward_attachments_to_supplier → reply_to_client with honest ack.`,

    `NOTIFY OWNER only for: scam/threat, explicit owner decision (refund/VIP), missing supplier role. NOT for normal orders, prices, or FYI.`,

    kbBlock ? `KNOWLEDGE (use these facts — don't invent):
${kbBlock}` : '',

    catalog ? `CATALOG:
${catalog}` : '(no catalog — confirm prices with customer before ordering)',

    teamRoster ? `TEAM:
${teamRoster}` : '',

    memoryBlock ? `CUSTOMER PROFILE:
${memoryBlock}` : '',

    pastConvBlock ? `PAST CONVOS:
${pastConvBlock}` : '',

    openJobs ? `OPEN JOBS:
${openJobs}` : '',

    earlierBlock ? `EARLIER (compressed):
${earlierBlock}` : '',

    `RECENT CHAT (last 14 turns):
${history}`,

    linksBlock ? `LINKS:
${linksBlock}` : '',

    `Today: ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}). Resolve relative dates against this.

Customer: """${inboundText}"""

Call the right tools. End with finish.`,
  ].filter(Boolean).join('\n\n');
  const messages = [{ role: 'system', content: system }];

  let iters = 0;
  const toolLog = [];

  while (iters < MAX_ITERS && !state.finished) {
    iters++;
    const completion = await openai.chat.completions.create({
      model: BRAIN_MODEL,
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

  // ── Last-chance reply if brain exhausted MAX_ITERS without replying ─────────
  // Ask the model one final time with no tools — forces a direct text reply.
  if (!state.replied && !state.finished && iters >= MAX_ITERS) {
    try {
      const fallback = await openai.chat.completions.create({
        model: BRAIN_MODEL,
        temperature: 0.4,
        messages: [
          ...messages,
          { role: 'user', content: 'You have not replied yet. Give a brief, helpful response to the customer RIGHT NOW — no tools, just text.' },
        ],
        // No tools — forces a plain-text reply
        max_tokens: 300,
      });
      const fallbackText = fallback.choices[0]?.message?.content?.trim();
      if (fallbackText) {
        await toolImpls.reply_to_client({ text: fallbackText });
        toolLog.push({ name: 'reply_to_client', args: { text: fallbackText }, forced_fallback: true });
      }
    } catch (e) {
      console.warn('brain last-chance fallback failed:', e.message);
    }
  }

  // ── Trust backstop: no critical action may fail silently ────────────────────
  // The brain is INSTRUCTED to be honest on tool failures, but that's a soft
  // rule. Here we deterministically guarantee that when an order/supplier brief
  // fails — OR when create_order saved a row but couldn't render a payment path
  // — the OWNER finds out, in human language, even if the brain didn't think
  // to call notify_owner. This is the "owner never gets blindsided" promise
  // that lets them turn up the autonomy dial.
  try {
    const CRITICAL_TOOLS = new Set(['create_order', 'brief_supplier']);
    const criticalFailures = toolLog.filter(t => CRITICAL_TOOLS.has(t.name) && t.result?.ok === false);
    const ownerAlreadyNotified = toolLog.some(t => t.name === 'notify_owner' && t.result?.ok !== false);
    const escalateFailures = criticalFailures.length > 0 && !ownerAlreadyNotified;

    if (escalateFailures || state.payment_setup_failed) {
      const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
      if (ownerChat) {
        const { customerHeader } = await import('./mentions');
        const header = customerHeader(customer);
        const lines = ['⚠️ *MiniMe needs you*'];
        if (header) lines.push('', header);

        // Payment-setup failure: ALWAYS escalate. The brain literally can't see
        // this honestly (the tool returned ok:true with payment_pending), so
        // there's nothing soft about it — the owner must follow up by hand.
        if (state.payment_setup_failed) {
          const p = state.payment_setup_failed;
          lines.push(
            '',
            `💳 Order #${p.order_num} (${p.total.toLocaleString()} ${p.currency}) was saved but I couldn't generate a payment link.`,
            `The customer was told you'll follow up — please send them payment details.`,
          );
        }

        // Hard failures (create_order ok:false / brief_supplier ok:false): only
        // escalate if the brain didn't already call notify_owner this turn, to
        // avoid double-DMing for the same incident.
        if (escalateFailures) {
          for (const f of criticalFailures) {
            const why = (f.result?.error || 'unknown error').toString().slice(0, 240);
            if (f.name === 'create_order') lines.push('', `🧾 Couldn't create an order: ${why}`);
            else if (f.name === 'brief_supplier') lines.push('', `📨 Couldn't brief a supplier: ${why}`);
          }
        }

        await tg(token, 'sendMessage', {
          chat_id: ownerChat,
          text: lines.join('\n'),
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      }
    }
  } catch (e) {
    console.warn('[brain] critical-failure escalation failed (non-fatal):', e.message);
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
    model: BRAIN_MODEL,
  }).select('id').single()).data?.id;

  // "Did that help?" feedback prompt to owner — only for significant turns
  // (create_job, brief_supplier, notify_owner, or research_url all qualify), and only
  // once every 3 such turns per business so we don't spam the owner.
  const SIGNIFICANT_TOOLS = new Set(['create_job', 'brief_supplier', 'notify_owner', 'research_url', 'forward_files_to_supplier']);
  const didSignificant = toolLog.some(t => SIGNIFICANT_TOOLS.has(t.name) && t.result?.ok !== false);
  const ownerNotifyChat = business.owner_private_chat_id || business.owner_telegram_id;
  if (didSignificant && ownerNotifyChat && thoughtId) {
    try {
      // Light throttle: check recent feedback prompts (last 3 thought ids) — skip if 2+ already asked
      const { data: recentFb } = await sb
        .from('feedback')
        .select('id, created_at')
        .eq('business_id', business.id)
        .eq('source', 'agent_action')
        .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // last 30 min
        .limit(3);
      const recentCount = (recentFb || []).length;
      // Ask at most once per 30 minutes
      if (recentCount === 0) {
        await tg(token, 'sendMessage', {
          chat_id: ownerNotifyChat,
          text: 'Did that help?',
          reply_markup: { inline_keyboard: [[
            { text: '👍 Yes', callback_data: `fb_yes_agent_${thoughtId}` },
            { text: '👎 No',  callback_data: `fb_no_agent_${thoughtId}` },
          ]]},
        });
      }
    } catch (e) { console.warn('feedback prompt:', e.message); }
  }

  return { replied: state.replied, thought_id: thoughtId, created_job_id: state.created_job_id };
}
