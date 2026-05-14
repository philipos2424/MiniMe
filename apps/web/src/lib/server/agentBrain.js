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
import { matchDocumentByIntent, downloadDocument, retrieveRelevantChunks } from './knowledge';
import { tgSendDocument } from './telegramApi';
import { ingestUrl } from './webIngest';
import { ensureRollingSummary, fetchPastConversationDigests } from './conversationMemory';
import { MODEL } from './constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

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
      description: "Create a real order + Chapa payment link. Call this as soon as you have a usable order — items+quantities, delivery (address or 'pickup'), phone. ALSO call it autonomously when the client has already given you everything you need; you don't need a verbal 'yes' if the data is clear. Each item must match a CATALOG product. Returns a Chapa checkout URL — include it in your reply.",
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
      description: "Send the customer a photo of a specific product when they ask 'what does it look like', 'show me', 'do you have a picture', 'sample', or anything visual. The product MUST be in the CATALOG. If multiple products match (e.g. 'cards'), send the best match first; you can call again for others. If the matched product has no image_url uploaded, the tool returns ok:false with reason 'no image' — fall back to share_links (portfolio/instagram) and tell the client honestly.",
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

  const [{ data: products }, { data: team }, { data: jobs }, { data: allMessagesAsc }, { data: memory }] = await Promise.all([
    sb.from('products').select('name, price, currency, stock_quantity, description, image_url')
      .eq('business_id', business.id).eq('is_active', true),
    sb.from('suppliers').select('id, name, role, contact_telegram, specialties')
      .eq('business_id', business.id).eq('is_active', true),
    sb.from('jobs').select('id, title, status, current_step')
      .eq('business_id', business.id).eq('customer_id', customer.id)
      .in('status', ['draft', 'awaiting_approval', 'active', 'blocked']).limit(5),
    sb.from('messages').select('direction, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true }).limit(400),
    sb.from('customer_memory').select('kind, content, created_at')
      .eq('customer_id', customer.id).eq('business_id', business.id)
      .order('created_at', { ascending: false }).limit(20),
  ]);

  // Recent 14 raw turns for the prompt; older turns get compressed into a
  // rolling summary that's cached on the conversation.
  const recent = (allMessagesAsc || []).slice(-14);
  const longSummary = await ensureRollingSummary(conversation, allMessagesAsc || []);

  // Past conversations with this same customer (other threads).
  const pastDigests = await fetchPastConversationDigests(business.id, customer.id, conversation.id);

  const catalog = (products || [])
    .map(p => `- ${p.name}: ${p.price ? `${p.price} ${p.currency || 'ETB'}` : 'price not set'}${p.stock_quantity != null ? ` (stock ${p.stock_quantity})` : ''}${p.image_url ? ' [📸 photo available]' : ''}${p.description ? ` — ${p.description.slice(0, 80)}` : ''}`)
    .join('\n') || '(no products)';

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

  // Pull any website/KB chunks relevant to the current message so Alfred can
  // answer from what it has already learned about the business or past clients.
  let kbBlock = '';
  try {
    const chunks = await retrieveRelevantChunks(inboundText || '', business.id, { count: 6, threshold: 0.22 });
    if (chunks && chunks.length) {
      kbBlock = chunks.map((c, i) => `[${i + 1}] ${(c.content || '').slice(0, 500)}`).join('\n\n');
    }
  } catch {}

  // If we have NO KB yet but a business website is configured, auto-ingest it
  // once so future turns have something to retrieve from.
  if (!kbBlock && business.website) {
    try {
      const { data: existing } = await sb.from('documents').select('id').eq('business_id', business.id).limit(1);
      if (!existing?.length) {
        await ingestUrl({ businessId: business.id, url: business.website, tag: 'website' });
        const chunks = await retrieveRelevantChunks(inboundText || business.name, business.id, { count: 4, threshold: 0.2 });
        if (chunks?.length) kbBlock = chunks.map((c, i) => `[${i + 1}] ${(c.content || '').slice(0, 500)}`).join('\n\n');
      }
    } catch {}
  }

  return { catalog, teamRoster, openJobs, history, earlierBlock, pastConvBlock, memoryBlock, turnCount, linksBlock, kbBlock };
}

// ────────────────────────────── Tool executors ──────────────────────────────
function makeTools({ token, business, customer, conversation, chatId, messageId, state }) {
  const sb = supabase();

  return {
    async reply_to_client({ text }) {
      // Polish Amharic replies with Hasab for natural spoken quality
      let finalText = text;
      if (/[ሀ-፿]/.test(inboundText || '')) {
        try {
          const { translateToAmharic } = await import('./hasab');
          const polished = await translateToAmharic(text);
          if (polished && polished.length > 10) finalText = polished;
        } catch (e) { /* keep original */ }
      }
      await tg(token, 'sendMessage', { chat_id: chatId, text: finalText, reply_to_message_id: messageId });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: finalText, content_type: 'text', status: 'sent',
        is_ai_generated: true, ai_model: 'agent-brain',
        telegram_chat_id: chatId, sent_at: new Date().toISOString(),
      });
      state.replied = true;
      return { ok: true };
    },

    async ask_client_question({ text }) {
      // Polish Amharic replies with Hasab for natural spoken quality
      let finalText = text;
      if (/[ሀ-፿]/.test(inboundText || '')) {
        try {
          const { translateToAmharic } = await import('./hasab');
          const polished = await translateToAmharic(text);
          if (polished && polished.length > 10) finalText = polished;
        } catch (e) { /* keep original */ }
      }
      await tg(token, 'sendMessage', { chat_id: chatId, text: finalText, reply_to_message_id: messageId });
      await sb.from('messages').insert({
        conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
        direction: 'outbound', content: finalText, content_type: 'text', status: 'sent',
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
      const dlIso = deadline_iso || null;
      const dlLabel = deadline_label || deadline || null;
      try {
        if (!Array.isArray(items) || !items.length) return { ok: false, error: 'no items' };
        if (!delivery_address || !phone) return { ok: false, error: 'delivery and phone required' };

        const { data: products } = await sb.from('products')
          .select('id, name, name_am, price, currency, stock_quantity')
          .eq('business_id', business.id).eq('is_active', true);
        if (!products?.length) return { ok: false, error: 'no products in catalog' };

        const matched = [];
        for (const req of items) {
          const q = (req.product_name || '').trim().toLowerCase();
          const qty = Math.max(1, Math.floor(Number(req.quantity) || 1));
          const score = p => {
            const hay = `${p.name || ''} ${p.name_am || ''}`.toLowerCase();
            if (hay === q) return 5;
            if (hay.includes(q)) return 3;
            return q.split(/\s+/).filter(Boolean).reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
          };
          const best = products.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]?.p;
          if (!best) return { ok: false, error: `no product matches "${req.product_name}"` };
          if (best.stock_quantity != null && best.stock_quantity < qty) {
            return { ok: false, error: `only ${best.stock_quantity} of ${best.name} in stock` };
          }
          const unit = Number(best.price) || 0;
          matched.push({
            product_id: best.id, name: best.name, quantity: qty,
            unit_price: unit, subtotal: Number((unit * qty).toFixed(2)),
            currency: best.currency || 'ETB',
          });
        }

        const currency = matched[0].currency;
        const total = Number(matched.reduce((s, it) => s + it.subtotal, 0).toFixed(2));

        // Save phone on the customer for future orders
        if (phone && phone !== customer.phone) {
          await sb.from('customers').update({ phone }).eq('id', customer.id);
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
            delivery_address && `Deliver to: ${delivery_address}`,
            phone && phone !== 'not provided' && `Phone: ${phone}`,
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
            const link = await generateChapaLink(business, { ...customer, phone }, order, matched, total, currency);
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

        // Send the payment-options message right away if we have any buttons
        if (inlineButtons.length) {
          const summary = matched.map(it => `• ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${it.currency}`).join('\n');
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `🧾 *Order ready*\n\n${summary}\n\n*Total: ${total.toLocaleString()} ${currency}*\n\nPick how you'd like to pay:`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: inlineButtons },
          });
          state.replied = true;
        }

        return { ok: true, order_id: order.id, total, currency, items_count: matched.length, checkout_url: checkoutUrl, payment_methods: inlineButtons.length };
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
        const matches = await matchDocumentByIntent(query || 'price list', business.id, { threshold: 0.18, count: 1 });
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
  const state = { replied: false, finished: false, created_job_id: null, summary: null };
  const toolImpls = makeTools({ token, business, customer, conversation, chatId, messageId, state });
  const { catalog, teamRoster, openJobs, history, earlierBlock, pastConvBlock, memoryBlock, turnCount, linksBlock, kbBlock } = await buildContext({ business, customer, conversation, inboundText });

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

  const system = `You are MiniMe — the AI agent running ${business.name}${business.category ? ` (${business.category})` : ''}.
You ARE the business. You act on your own — you don't wait for permission to do normal things.
${ownerRulesBlock}
## TONE — WARM, CURIOUS, HUMAN
- Talk like a real person who actually runs this shop. Warm, unhurried, interested in the client.
- First message in a new conversation: greet, ask what they're working on or how you can help — DO NOT lead with a price or a product dump. Price comes AFTER you understand what they actually need.
- Use the client's name if you have it. Mirror their language (Amharic ↔ English). Casual > formal.
- Replies are short (1–4 lines) but never robotic. A one-line "Here's the price list." is fine; "yes 500 ETB" is not — add a sentence of context.
- Be curious. Ask ONE open question when it helps you serve them better.

## AMHARIC — write like a real Addis shopkeeper, not a textbook
When replying in Amharic:
- Use **everyday spoken Amharic**, not formal/written register. Aim for what a friendly shop owner would actually type on Telegram.
- Always Ethiopic script. NEVER use Latin transliteration ("selam dehna nesh" is BANNED — write "ሰላም ደህና ነሽ").
- Mix English business terms freely when natural — "ETB", "delivery", "discount", "WhatsApp", brand names, prices in numerals. Don't translate them awkwardly.
- Use casual particles: "እሺ", "በቃ", "በጣም", "አሪፍ", "ዋው" — not "በመሆኑም", "ስለዚህ", "በዚህ መሰረት".
- Keep sentences short. Two short lines beat one long one. Drop the formal "እባክዎ" / "እርስዎ" unless the client used them first.
- Greetings: "ሰላም!", "እንደምን ነህ/ነሽ", "ጤና ይስጥልኝ" — pick the one that matches their vibe.
- Confirmations: "እሺ", "በቃ", "ጥሩ", "አሪፍ", "ሆኗል". Avoid "በትክክል", "በተሳካ ሁኔታ".
- Shop talk: "አለ" (we have it), "የለም" (out), "ደረሰ" (delivered), "እጥፍ ነው" (it's double), "ቅናሽ አለ" (there's a discount).
- Use 🌷 ☕ 💛 ✨ 🙏 sparingly when warm closure helps. Never overdo emojis.
- Examples of GOOD Amharic replies:
  - "ሰላም! አዎ ቀይ ቀሚስ M ሳይዝ አለ — 1,800 ብር።"
  - "እሺ! ቦሌ ነው የሚደርሰው — 150 ብር።"
  - "በቃ ለነገ ይዣለሁ። ቁጥርሽን ላክልኝ።"
  - "አሪፍ! ፎቶ ላክልኝ ቀለሙን እንዲያይ።"
- BAD Amharic to avoid:
  - "በመሆኑም ይህ ምርት በስቶክ ላይ ይገኛል።" (too formal/translated)
  - "selam, akum yelegnal" (Latin)
  - "ይህን ምርት ለመግዛት ፍላጎትዎን አሳውቁን።" (corporate-speak)

## DON'T BE A BROKEN RECORD
- If a customer sends something low-signal — a single ".", "ok", "👍", "hi", "test", an empty message, a sticker, or anything that does NOT clearly ask about a product or service — DO NOT push your catalog or repeat your last reply. Acknowledge briefly and ask ONE open question to find out what they actually need ("How can I help today?" / "What are you working on?" / "ምን ላግዝዎ?").
- NEVER repeat your previous reply word-for-word. If your last outbound message already covered something, don't say it again — instead, advance the conversation (ask a different question, share a relevant link, or wait if they need to think).
- If you genuinely have no idea what they're asking, ASK. "Sorry, can you tell me a bit more about what you're looking for?" is much better than guessing the catalog item.
- Out-of-scope chitchat ("how are you", "what's the weather") → answer briefly + politely steer back ("Doing well, thanks. Anything I can help you with today?"). DO NOT ignore it and force-quote prices.

## HARD RULES — do not violate
- NEVER claim a status that hasn't happened. Do NOT say "your order is being prepared", "it's on its way", "the designer started", "delivery is scheduled", "it's ready" UNLESS you actually see that in OPEN JOBS / the tool just returned ok for that step. If in doubt, say what IS true ("I've briefed our designer — I'll update you as soon as they send a draft").
- NEVER end a message with "feel free to ask", "let me know if you have any questions", "don't hesitate", "I'm here to help", "hope this helps", or any filler closer.
- NEVER say "check with us", "contact us for pricing", "for the latest price". You ARE us. Quote the price directly from the CATALOG.
- NEVER invent prices, stock numbers, product names, delivery dates, or facts about the business. If you don't know, use research_url on our own website first, or ask the owner via notify_owner.
- NEVER say "I'll check and get back to you" unless you are calling notify_owner in the same turn.
- NEVER quote a price on the first turn unless the client explicitly asked for it. Greet first, then ask one question, then price.

## AUTONOMY — YOU ARE IN CHARGE. ACT. DO NOT WAIT FOR APPROVAL.
You run this business end-to-end. When a customer has given you enough to proceed, YOU create the job, YOU brief the supplier, YOU forward their files. Do not send "awaiting approval" messages. Do not ask the owner for permission to do your job.

## WHEN TO NOTIFY OWNER (rare — maybe 1 in 20 turns)
Only call notify_owner for:
  • Something genuinely suspicious (scam, abuse, threat)
  • An explicit owner-only decision (refund, big discount, VIP escalation)
  • A supplier/role you don't have on the team yet and can't proceed without
DO NOT notify_owner for: a paid checkout order (system notifies), a price question, a normal order, a normal customization request, a job you just created, or "FYI" updates. The owner watches the dashboard. Do not spam them.

## HOW TO HANDLE REQUESTS

1. **Price question on a listed item** → quote the price AND add a warm sentence around it ("The ${exName} is ${exPrice} — want me to walk you through the options?"). If they haven't told you what it's for yet and it's an early turn, ask once.

2. **Anything price-related — "price list", "menu", "catalog", "samples", "how much", "what do you charge", "ዋጋ", "package", "options"** → send_catalog_file IMMEDIATELY with their query (try synonyms: "price list", "packages", "menu"). ALSO share_links with portfolio/instagram if relevant. Do NOT promise to send — just send. One-line lead-in is fine. If matchDocumentByIntent returns no document, fall back to quoting prices from CATALOG and one-line "I can also send our full price list — want me to grab it?" only if the owner has uploaded one.

3. **Customer wants to order a listed product** ("I'll take 3", "can I get 2", "order please", "I'll order"):
   You are the autonomous order-taker. Take the order yourself — no owner approval needed.
   Required minimums to call create_order: (a) item + quantity, (b) delivery address OR "pickup", (c) phone number.
   Optional but helpful: deadline, personalization notes, payment preference.
   How to gather:
     - Ask ONE concise question per turn for whatever's missing. NEVER list five questions at once. Cluster naturally: "Quick — what's the delivery address and a phone number for the courier?" beats two separate questions.
     - If the customer ALREADY supplied everything in their first message, DO NOT ask anything — call create_order immediately and reply with the summary + Chapa link.
     - DEADLINE handling: if the client says "tomorrow" / "ነገ", "next Friday", "by April 30", "በሳምንት ውስጥ" — resolve it to a YYYY-MM-DD date based on today and pass it as deadline_iso. If they didn't mention a deadline AT ALL, don't ask for one — pass null. Never invent a deadline.
     - If they decline to give a phone, accept "not provided" and proceed.
   Confirm-and-fire pattern: once minimums are met, send ONE summary message ("So that's 2 ${exName}, deliver to Bole, courier 0911234567, by Friday — total. Sending the payment link 👇") AND call create_order in the same turn. Don't wait for verbal "yes" if data is unambiguous.
   The tool returns checkout_url — include it as the next line. Don't say "your order is placed" until you have a checkout_url to share.

4. **Customization / design request** ("I want to customize my order", "can you design a logo for me", "I need custom business cards"):
   You are the designer's intake agent. You MUST gather the brief before anyone is briefed. Walk the client through a short discovery — one focused question per turn — to collect the DESIGN BRIEF CHECKLIST:
     a. Purpose/use case ("What are you using this for — personal, business, an event?")
     b. Name & any contact details they want on it
     c. Brand or company name, if applicable
     d. Colors / style they like (or: "do you have a logo or reference image?")
     e. Text / tagline they want on it
     f. Deadline ("When do you need it by?")
     g. Quantity (if they haven't said)
   Ask ONE at a time. As you learn each piece, call remember_about_client to save it.
   When you have enough (at least a, d, e, f) AND the client has confirmed a summary: in the SAME turn — (1) create_job with a rich description listing every requirement, (2) brief_supplier with role="designer" and a 4-7 line brief (purpose, name, brand, colors, text, deadline, quantity), passing the job_id you just created, (3) forward_attachments_to_supplier if they uploaded any reference files, (4) reply_to_client with a truthful ack: "I've briefed our designer — they'll send a first draft by [deadline]. I'll share it here as soon as it's in." Do NOT say anything about delivery, printing, or completion — none of that has happened yet.
   **ALWAYS ASK FOR FILES.** During discovery you must ask ONCE: "Do you have a logo, brand assets, or any reference images? Send whatever you've got — even a screenshot helps." If they send anything, treat it as the brand pack and pass it forward. If they say no, work from the description.
   Proactively share your portfolio/Instagram during discovery (share_links with portfolio + instagram) so they see your style and it informs their answers.
   If they upload a reference photo/logo while you're gathering — acknowledge it in the next reply and keep going.

5. **Multi-step project** (events, branding packages, multiple item types with a deadline/budget):
   - If any of these are missing — quantities per item, deadline, rough budget — ask_client_question to fill the gap first (one question).
   - Once you have the basics, do it all in ONE turn:
     a. create_job with title + rich description + 4-7 pipeline steps matching real roles needed.
     b. brief_supplier for the FIRST role in the pipeline (usually designer) with the job_id.
     c. forward_attachments_to_supplier if there are reference files.
     d. reply_to_client with a crisp ack that names the next step and ETA.
   - Do NOT notify_owner. Do NOT wait for approval. You handle it.

6. **Vague project** ("we need stuff for our event") → ONE ask_client_question that asks for the 2-3 most important missing pieces in one question. Don't interrogate.

7. **Out of scope / weird / suspicious** → notify_owner with a one-line summary and reply_to_client honestly ("Let me check on that — give me a moment.").

8. **"Do you have a portfolio / site / Instagram / samples of your work / where can I see more"** → share_links with the relevant fields (portfolio + instagram for design/creative; website + whatsapp + address for food/retail; all relevant socials if they asked broadly). Pair it with a one-line lead_in. If a physical portfolio PDF exists in documents, also send_catalog_file("portfolio") in the same turn.

9. **Client shares their OWN website / company URL / Instagram** ("our site is xyz.com", "check out our IG @acme") → research_url with purpose="client" BEFORE you reply. The tool returns a snippet with what the site says about them. Use it to personalize your reply ("I saw you're a [industry] — for that, I'd recommend...") AND call remember_about_client with the facts you learned (industry, scale, brand style). Then reply_to_client.

10. **Client pastes a reference URL / inspiration / "something like this"** → research_url with purpose="reference", then reply_to_client acknowledging the style and proposing how you'd execute it. Forward the URL in the designer brief later.

11. **You don't know an answer about OUR OWN business** (hours, services, policy, history) and KNOWLEDGE BASE above is empty on it → research_url with purpose="self" on OUR website (in PUBLIC LINKS), then answer from the snippet.

12. **Status check** ("any update?", "is my card ready?", "did you start?") → read OPEN JOBS and recent history carefully. Reply with ONLY what is true. If the job is still in draft, say "I'm getting your brief ready now — should be off to the designer within the hour" NOT "it's being worked on". If the supplier was briefed but hasn't replied, say "I've briefed [Name] — waiting on their first draft" NOT "it's in production". Under-promise, over-deliver.

13. **Client uploads a photo / PDF / file** — the inbound text starts with "[photo analysis]" or "[document]" or "[voice]". Don't ignore it. React naturally:
   - If you DON'T know what it's for yet → ask one question ("Is this a reference for the design? Or something you'd like printed?"). Do not assume.
   - If it's clearly a reference / inspiration during design discovery → acknowledge it ("Got it — I see you want a clean, modern look like this") and continue collecting the brief. Save what you learned with remember_about_client.
   - If it's a logo / asset for a job that's already underway → forward it to the right supplier IMMEDIATELY using forward_attachments_to_supplier. Then reply to the client confirming you got it and shared it with [supplier name].
   - If it's something you can't process (random meme, unrelated photo) → react gently and ask what they'd like you to do with it.

14. **Client asks to see your work / portfolio / samples / "do you have examples"** — call share_links with at least portfolio + instagram (whichever your business has set). If a portfolio PDF is uploaded, also send_catalog_file("portfolio"). NEVER answer "yes we have a portfolio" without actually sending the link/file. NEVER promise "I'll send it later" — send it NOW.

14b. **Client asks "what does X look like" / "show me X" / "do you have a picture of X" / "sample" / "can I see it" / "ምን ይመስላል" / "ፎቶ"** — if the CATALOG entry shows [📸 photo available] for that product, call send_product_photo with the product name immediately. The tool sends the photo + price as caption. Don't add a redundant text reply afterward unless they asked something else too. If no [📸 photo available] flag, fall back to share_links (portfolio + instagram) and tell them honestly: "I don't have a product photo on hand — but here's our portfolio with examples."

15. **Client gives partial info ("I want a logo", "we need cards", "do you do photography")** → DON'T jump to pricing. Ask ONE focused question that helps you serve them better. Examples:
   - "Sure! What's the logo for — your own brand or a client's?"
   - "Yes — how many cards, and is it a fresh design or a re-print of an existing one?"
   - "We do! Is it for an event, product shoot, or portraits?"

16. **Client describes a NEED without naming a product** ("I'm starting a business and want something professional", "ለሰርግ ስጦታ እፈልጋለሁ", "we have a workshop next month, what do you have for that?") → BE THE EXPERT. Look at the CATALOG and proactively SUGGEST 1–3 specific products that fit their need, with a one-line reason for each. Then ask ONE qualifying question. Examples:
   - "For that, two options work well: the *${exName}* (${exPrice}) and the *${exName2}* (${exPrice2}). How many do you need?"
   - If the customer writes in Amharic, reply in Amharic with the same product suggestions from your CATALOG.
   You're recommending, not order-taking yet. Don't ask 5 things at once.
   If CATALOG has nothing relevant, say so honestly: "We don't have anything for that yet — but [share_links / refer them to a partner]."

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

## PUBLIC LINKS (use share_links to send any of these to the client)
${linksBlock}

## KNOWLEDGE BASE SNIPPETS relevant to this message (from the business website, uploaded docs, and past research — USE these to answer; don't invent)
${kbBlock || '(no matching knowledge yet)'}

## CATALOG
${catalog}

## TEAM ROSTER (who you can DM)
${teamRoster}

## CLIENT PROFILE — what we've learned about this specific customer
${memoryBlock}

## PAST CONVERSATIONS WITH THIS CUSTOMER (other threads, oldest at bottom)
${pastConvBlock}

## OPEN JOBS FOR THIS CUSTOMER
${openJobs}

${earlierBlock ? `## EARLIER IN THIS CHAT (compressed — older turns are summarized)\n${earlierBlock}\n` : ''}
## RECENT CHAT HISTORY (last 14 turns; turn count so far: ${turnCount})
${history}

## NOW
Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}). Resolve all relative dates ("tomorrow", "next Friday", "በሳምንት ውስጥ") against this.

The customer just sent: """${inboundText}"""

Reason step by step, then call the right tools. End with finish.`;

  const messages = [{ role: 'system', content: system }];

  let iters = 0;
  const toolLog = [];

  while (iters < MAX_ITERS && !state.finished) {
    iters++;
    const completion = await openai.chat.completions.create({
      model: MODEL,
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
    model: MODEL,
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
