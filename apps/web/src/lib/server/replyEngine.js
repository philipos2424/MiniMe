/**
 * Tenant-bot reply engine (Vercel serverless edition).
 *
 * Feature groups ported from apps/bot/src/services:
 *   1. Voice / photo transcription  (transcription.js)
 *   2. Scam shield                   (scam.js)
 *   3. Trust levels                  (SHADOW / SUPERVISED / TRUSTED / FULL_AGENT)
 *   4. Knowledge RAG                 (knowledge.js — chunks + whole-doc auto-send)
 *   5. Voice profile                 (sample_replies + voice_embedding in prompt)
 *   6. Supplier-reply quote parser   (supplierReply.js)
 *   7. Owner Markdown buttons        (notification.js — approve/edit/skip)
 *
 * Also: checkout short-circuit (orders + Chapa link) remains from before.
 *
 * Every async branch is AWAITED — Vercel kills fire-and-forget the moment the
 * webhook response returns.
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { TRUST_LEVELS, ROUTINE_INTENTS } from './constants';
import { scanForScam } from './scam';
import { runBrain } from './agentBrain';
import { transcribeTelegramAudio, describeTelegramPhoto, readTelegramDocument } from './transcription';
import { retrieveRelevantChunks, matchDocumentByIntent, downloadDocument, looksLikeDocumentRequest } from './knowledge';
import { detectIntent } from './intent';
import { handleSupplierReply } from './supplierReply';
import { notifyOwnerDraft, notifyOwnerAutoSent, notifyOwnerScamAlert } from './notification';
import { detectJob } from './jobDetector';
import { createJob, logEvent, advanceStep } from './jobs';
import { tg, tgSendDocument } from './telegramApi';
import { kickoffJob } from './jobFanout';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ───────────────────────────── DB helpers ─────────────────────────────
async function findOrCreateCustomer(businessId, from) {
  const sb = supabase();
  const { data: existing } = await sb
    .from('customers').select('*')
    .eq('business_id', businessId).eq('telegram_id', from.id).maybeSingle();
  if (existing) return existing;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Customer';
  const { data } = await sb.from('customers').insert({
    business_id: businessId, telegram_id: from.id,
    telegram_username: from.username || null, name,
  }).select().single();
  return data;
}

async function findOrCreateConversation(businessId, customerId) {
  const sb = supabase();
  const { data: existing } = await sb.from('conversations').select('*')
    .eq('business_id', businessId).eq('customer_id', customerId).maybeSingle();
  if (existing) return existing;
  const { data } = await sb.from('conversations').insert({
    business_id: businessId, customer_id: customerId, message_count: 0,
  }).select().single();
  return data;
}

async function saveMessage(row) {
  const { data } = await supabase().from('messages').insert(row).select().single();
  return data;
}

async function touchConversation(id, action) {
  const sb = supabase();
  const { data: curr } = await sb.from('conversations').select('message_count').eq('id', id).single();
  await sb.from('conversations').update({
    last_ai_action: action,
    last_message_at: new Date().toISOString(),
    message_count: (curr?.message_count || 0) + 1,
  }).eq('id', id);
}

async function getRecentMessages(conversationId, limit = 10) {
  const { data } = await supabase().from('messages')
    .select('direction, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).reverse();
}

async function getProducts(businessId) {
  const { data } = await supabase().from('products').select('*')
    .eq('business_id', businessId).eq('is_active', true);
  return data || [];
}

async function listCustomerMemory(customerId, limit = 10) {
  try {
    const { data } = await supabase().from('customer_memory')
      .select('*').eq('customer_id', customerId)
      .order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

// ───────────────────────────── Reply generation ─────────────────────────────
function isAmharic(text) { return /[\u1200-\u137F]/.test(text || ''); }

function buildSystemPrompt(business, products, voiceProfile, sampleReplies) {
  // Show ALL active products — never truncate, the AI needs every price.
  const productLines = products.map(p => {
    const price = p.price != null
      ? `${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}`
      : 'price not set';
    const stock = p.stock_quantity != null ? ` · stock: ${p.stock_quantity}` : '';
    const desc = p.description ? ` — ${p.description.slice(0, 80)}` : '';
    return `  - ${p.name}: ${price}${stock}${desc}`;
  }).join('\n');

  // CONTACT block — the AI will share whichever fields the owner has set.
  const contactRows = [];
  if (business.owner_phone)       contactRows.push(`  - Phone: ${business.owner_phone}`);
  if (business.whatsapp)          contactRows.push(`  - WhatsApp: ${business.whatsapp}`);
  if (business.email)             contactRows.push(`  - Email: ${business.email}`);
  if (business.website)           contactRows.push(`  - Website: ${business.website}`);
  if (business.portfolio_url)     contactRows.push(`  - Portfolio: ${business.portfolio_url}`);
  if (business.instagram)         contactRows.push(`  - Instagram: ${business.instagram}`);
  if (business.tiktok)            contactRows.push(`  - TikTok: ${business.tiktok}`);
  if (business.facebook)          contactRows.push(`  - Facebook: ${business.facebook}`);
  if (business.telegram_channel)  contactRows.push(`  - Telegram channel: ${business.telegram_channel}`);
  if (business.address)           contactRows.push(`  - Address: ${business.address}`);
  if (business.business_hours)    contactRows.push(`  - Hours: ${business.business_hours}`);
  const contactBlock = contactRows.length
    ? `\n\nCONTACT & LINKS (share freely when asked — copy links verbatim):\n${contactRows.join('\n')}`
    : '';

  let voiceBlock = '';
  if (voiceProfile && Object.keys(voiceProfile).length) {
    const parts = [];
    if (voiceProfile.greeting?.opener) parts.push(`Typical opener: "${voiceProfile.greeting.opener}"`);
    if (voiceProfile.tone) parts.push(`Tone: ${voiceProfile.tone}`);
    if (voiceProfile.uniquePhrases?.length) parts.push(`Signature phrases: ${voiceProfile.uniquePhrases.slice(0, 5).join(', ')}`);
    if (voiceProfile.closings?.length) parts.push(`Typical closings: ${voiceProfile.closings.slice(0, 3).join(' · ')}`);
    if (parts.length) voiceBlock = `\n\n## OWNER'S VOICE (mimic this — not robotic):\n${parts.join('\n')}`;
  }
  if (sampleReplies?.length) {
    voiceBlock += `\n\n## OWNER'S REAL REPLIES (study the style):\n${sampleReplies.slice(0, 6).map((s, i) => `${i + 1}. "${s}"`).join('\n')}`;
  }

  return `You ARE "${business.name}"${business.category ? ` (${business.category})` : ''}${business.location ? `, based in ${business.location}` : ''}. You answer as the business itself. Never tell the customer to "check with ${business.name}" — YOU are ${business.name}.

🔴 PRICE RULE (highest priority):
If the customer asks the price of anything and the product appears in the CATALOG below with a price, quote that exact price. DO NOT say "check with us", "please contact", or "for the latest price". The catalog IS the latest price. If the product isn't in the catalog, say "I don't have that in my list — let me check with ${business.owner_name || 'our team'}."


# LANGUAGE
Match the customer's language exactly (Amharic, English, or mixed). If they mix, you mix. If they write Amharic in Latin script ("selam", "sint new"), reply the same way.

# PERSONALITY
Warm, concise, confident. 1–3 short lines usually. No corporate fluff. Natural contractions ("I'll", "we've"). Sprinkle light warmth ("እሺ", "sure", "got it") — never emoji storms. Never say "As an AI…" or "I'm a chatbot".

# WHAT YOU DO
1. Answer fully using the CATALOG, CONTACT block, KNOWLEDGE BASE, and MEMORY below.
2. When the customer's request is vague or missing key details, ASK 1 clarifying question before committing to an answer (see UNDERSTANDING below).
3. Extract orders — the system will handle payment.
4. Share contact / socials / portfolio links VERBATIM when asked.

# UNDERSTANDING THE CUSTOMER (most important)
Before replying, silently check: do I actually know enough to answer well?
- "How much?" without specifying WHICH item → ask which product / quantity / size / variant.
- "Is it available?" without item name → ask what they're looking for.
- A photo of a product → confirm whether they want to BUY one like it, price-match, or something else.
- An open-ended "I need something for an event" → ask event type, date, quantity, budget — ONE question at a time, not a form.
- A receipt / invoice PDF → ask what they'd like you to do with it (refund? reorder? confirm?).

Only ask ONE clarifying question per turn, and only when the answer genuinely changes what you'd say. Don't interrogate — if you can answer reasonably, answer.

# PRICE QUESTIONS (non-negotiable)
- If the product is in the CATALOG, quote the exact number. NEVER deflect to "ask the owner" when you have the price.
- If you find a number in the KNOWLEDGE BASE (price list PDF, menu, brochure), quote it exactly and cite the doc briefly ("as per our price list").
- If the price truly isn't anywhere, say so and offer to check with ${business.owner_name || 'the owner'}.
- For Amharic price questions ("ስንት ነው", "ዋጋው ስንት", "ዋጋ"), treat them identically.

# CONTACT / LINKS
When asked for phone, WhatsApp, email, website, Instagram, TikTok, Facebook, portfolio, Telegram channel, or address — copy the value from the CONTACT block VERBATIM. If a channel isn't listed, say "we don't have [X] right now" and offer what IS listed.

# MEMORY & CONTEXT
The chat history below is REAL — refer back to it ("as you mentioned earlier…", "like the 20 programs you asked about yesterday"). Do NOT re-ask info the customer already gave.

# MEDIA THE CUSTOMER SENT
Text prefixed with [photo analysis], [voice], or [document] is a summary of non-text media the customer sent. Treat it as if you saw/heard it yourself. Respond to what it actually shows, not generically.

# HONESTY
If you don't know, say so briefly and offer to loop in ${business.owner_name || 'the owner'}. Never invent product names, prices, stock counts, or addresses.

${products.length
  ? `## PRODUCT CATALOG (authoritative — quote these prices exactly):\n${productLines}`
  : '## CATALOG: (empty — tell the customer the catalog is being set up and offer to pass their question to the owner.)'}${contactBlock}${voiceBlock}`;
}

async function draftReply(business, customer, conversation, incomingText) {
  const [products, recent, mem, chunks] = await Promise.all([
    getProducts(business.id),
    getRecentMessages(conversation.id, 30),           // full short-term memory
    listCustomerMemory(customer.id, 20),              // long-term customer facts
    retrieveRelevantChunks(incomingText, business.id, { count: 6, threshold: 0.2 }),
  ]);

  const chatHistory = recent.map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }));

  let systemPrompt = buildSystemPrompt(
    business, products,
    business.voice_embedding || {},
    business.sample_replies || [],
  );

  if (chunks.length) {
    systemPrompt += '\n\n## KNOWLEDGE BASE (owner-uploaded docs — use as TRUTH, quote numbers exactly, paraphrase prose in your voice):\n' +
      chunks.map((c, i) => `[KB-${i + 1}] ${c.content.slice(0, 900)}`).join('\n---\n');
  }
  if (mem.length) {
    systemPrompt += '\n\n## WHAT YOU REMEMBER ABOUT THIS CUSTOMER (reference these — do not re-ask):\n' +
      mem.map(m => `- (${m.kind}) ${m.content}`).join('\n');
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 500,
      presence_penalty: 0.3,
      frequency_penalty: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        ...chatHistory,
        { role: 'user', content: incomingText },
      ],
    });
    const draft = res.choices[0]?.message?.content?.trim() || null;
    if (!draft) return { draft: null, confidence: 0 };
    return { draft, confidence: calculateConfidence(draft, business.voice_embedding || {}, business) };
  } catch (e) {
    console.error('draftReply:', e.message);
    return { draft: null, confidence: 0 };
  }
}

function calculateConfidence(draft, voice, business) {
  let s = 0.6;
  if (voice.greeting?.opener && draft.includes(voice.greeting.opener)) s += 0.1;
  if (draft.length < 200) s += 0.05;
  if (draft.length > 400) s -= 0.1;
  if ((business.sample_replies || []).length >= 20) s += 0.1;
  if ((business.sample_replies || []).length < 5) s -= 0.2;
  if (voice.uniquePhrases?.some(p => draft.includes(p))) s += 0.1;
  return Math.max(0.1, Math.min(0.99, s));
}

// ───────────────────────────── Order detection ─────────────────────────────
const ORDER_HINTS = /\b(want|buy|order|need|send|deliver|take|purchase|i'll take|i will take)\b/i;
const ORDER_HINTS_AM = /(እፈልጋለሁ|እፈልጋ|እገዛ|እገዛለሁ|ላክ|ላኩልኝ|ስጠኝ|ይስጡኝ|ግዛ|መግዛት|እወስዳለሁ)/;

function looksOrderLike(text) {
  if (!text || text.length < 3) return false;
  return ORDER_HINTS.test(text) || ORDER_HINTS_AM.test(text) || /\b\d+\b/.test(text);
}

async function extractOrder(text, products) {
  if (!products.length || !looksOrderLike(text)) return { is_order: false };
  const catalog = products.map(p => ({
    product_id: p.id, name: p.name,
    price: Number(p.price ?? 0),
    currency: p.currency || 'ETB',
    stock: p.stock_quantity ?? null,
  }));
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'Extract purchase orders. Match customer words to the catalog (Amharic ↔ English, fuzzy). Never invent products. Return JSON.' },
        { role: 'user', content: `CATALOG:\n${JSON.stringify(catalog)}\n\nCUSTOMER: """${text}"""\n\nJSON: {"is_order": bool, "items": [{"product_id","quantity"}], "confidence": 0-1}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    const items = (parsed.items || [])
      .filter(it => catalog.some(c => c.product_id === it.product_id))
      .map(it => {
        const p = catalog.find(c => c.product_id === it.product_id);
        const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
        return {
          product_id: p.product_id, name: p.name, quantity: qty,
          unit_price: p.price, subtotal: Number((p.price * qty).toFixed(2)),
          currency: p.currency, stock_available: p.stock,
        };
      });
    return { is_order: !!(parsed.is_order && items.length), items, confidence: Number(parsed.confidence) || 0 };
  } catch (e) {
    console.warn('extractOrder:', e.message);
    return { is_order: false };
  }
}

async function generateChapaLink(business, customer, order, items, total, currency) {
  if (!process.env.CHAPA_SECRET_KEY) return null;
  const txRef = `order-${business.id.slice(0, 8)}-${order.id.slice(0, 8)}-${Date.now()}`;
  try {
    const r = await fetch('https://api.chapa.co/v1/transaction/initialize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
      body: JSON.stringify({
        amount: Number(total).toFixed(2),
        currency,
        email: customer?.email || `cust-${customer?.id}@minime.app`,
        first_name: (customer?.name || 'Customer').split(' ')[0],
        last_name: (customer?.name || '').split(' ').slice(1).join(' ') || 'Order',
        tx_ref: txRef,
        return_url: `${process.env.WEB_URL}/thanks`,
        callback_url: `${process.env.WEB_URL}/api/payment/callback`,
        customization: {
          title: (business.name || 'MiniMe').slice(0, 16),
          description: (items[0]?.name || 'order').slice(0, 50),
        },
      }),
    });
    const j = await r.json();
    return { url: j?.data?.checkout_url || null, txRef };
  } catch (e) { console.warn('chapa init:', e.message); return null; }
}

async function tryCheckout(token, business, customer, conversation, incomingText, chatId, messageId) {
  const products = await getProducts(business.id);
  const extracted = await extractOrder(incomingText, products);
  if (!extracted.is_order || extracted.confidence < 0.55) return false;

  const am = isAmharic(incomingText);
  const oos = extracted.items.find(it => it.stock_available != null && it.stock_available < it.quantity);
  if (oos) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: am
        ? `ይቅርታ፣ በአሁኑ ጊዜ ${oos.name} በቂ የለም። (ያለው: ${oos.stock_available || 0})`
        : `Sorry, we don't have enough ${oos.name} in stock. (Available: ${oos.stock_available || 0})`,
      reply_to_message_id: messageId,
    });
    return true;
  }

  const currency = extracted.items[0].currency || 'ETB';
  const total = Number(extracted.items.reduce((s, it) => s + it.subtotal, 0).toFixed(2));

  const sb = supabase();
  const { data: order } = await sb.from('orders').insert({
    business_id: business.id, customer_id: customer.id, conversation_id: conversation.id,
    items: extracted.items, subtotal: total, total, currency,
    status: 'pending_payment', source: 'bot',
  }).select().single();
  if (!order) return false;

  const link = await generateChapaLink(business, customer, order, extracted.items, total, currency);
  if (!link?.url) {
    await sb.from('orders').update({ status: 'cancelled', owner_note: 'Chapa link failed' }).eq('id', order.id);
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: am ? `ትእዛዝዎን ተቀብያለሁ። ${business.name} በቅርቡ ያገኙዎታል።` : `I've noted your order. ${business.name} will follow up shortly.`,
      reply_to_message_id: messageId,
    });
    return true;
  }
  await sb.from('orders').update({ chapa_tx_ref: link.txRef, checkout_url: link.url }).eq('id', order.id);

  const lines = extracted.items.map(it => `• ${it.quantity} × ${it.name} = ${it.subtotal.toLocaleString()} ${currency}`).join('\n');
  const reply = am
    ? `እሺ፣ ትእዛዝዎን ተቀብያለሁ 🙏\n\n${lines}\n\n*ጠቅላላ: ${total.toLocaleString()} ${currency}*\n\n💳 በአስተማማኝ መንገድ ለመክፈል:\n${link.url}`
    : `Got it — here's your order:\n\n${lines}\n\n*Total: ${total.toLocaleString()} ${currency}*\n\n💳 Tap to pay securely:\n${link.url}`;

  await tg(token, 'sendMessage', {
    chat_id: chatId, text: reply, reply_to_message_id: messageId, parse_mode: 'Markdown',
  });
  await saveMessage({
    conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
    direction: 'outbound', content: reply, content_type: 'text', status: 'sent',
    is_ai_generated: true, ai_model: 'checkout-flow', telegram_chat_id: chatId,
    sent_at: new Date().toISOString(),
  });

  if (business.owner_private_chat_id) {
    await tg(token, 'sendMessage', {
      chat_id: business.owner_private_chat_id,
      text: `🛒 *New order — awaiting payment*\n\n*${customer.name || 'Customer'}*\n${lines}\n\n*Total: ${total.toLocaleString()} ${currency}*`,
      parse_mode: 'Markdown',
    });
  }
  return true;
}

// ───────────────────────────── Knowledge doc auto-send ─────────────────────────────
async function tryAutoSendDocument(token, business, customer, chatId, incomingText) {
  if (!looksLikeDocumentRequest(incomingText)) return false;
  const matches = await matchDocumentByIntent(incomingText, business.id, { threshold: 0.45, count: 1 });
  const doc = matches[0];
  if (!doc || !doc.storage_path) return false;
  try {
    const buf = await downloadDocument(doc.storage_path);
    const caption = isAmharic(incomingText)
      ? `📎 ${doc.title || doc.original_filename} — ${business.name}`
      : `📎 ${doc.title || doc.original_filename} — from ${business.name}`;
    await tgSendDocument(token, chatId, buf, doc.original_filename || 'document.pdf', caption);
    return true;
  } catch (e) {
    console.warn('tryAutoSendDocument:', e.message);
    return false;
  }
}

// ───────────────────────────── Agent job detection ─────────────────────────────
async function tryDetectJob(token, business, customer, conversation, text, chatId, messageId) {
  // Only run for trust-level TRUSTED or FULL_AGENT — the owner has opted into autonomy.
  const trustLevel = Number(business.trust_level ?? TRUST_LEVELS.SUPERVISED);
  if (trustLevel < TRUST_LEVELS.TRUSTED) return false;

  // If we asked a clarifying question last turn, combine prior context with the
  // new reply and re-run detection with the full picture.
  const meta = conversation.metadata || {};
  const priorQuestion = meta.last_job_question;
  const priorContext = meta.last_job_context;
  const effectiveText = priorQuestion && priorContext
    ? `${priorContext}\n\n[follow-up reply]: ${text}`
    : text;

  const detected = await detectJob(effectiveText, {
    businessName: business.name, category: business.category,
  });
  if (!detected.is_job) return false;

  // If GPT still wants more info and we haven't asked yet, ask the question
  // via Telegram and persist the context so the next reply completes the picture.
  if (detected.clarifying_question && !priorQuestion) {
    const q = String(detected.clarifying_question).trim();
    await tg(token, 'sendMessage', {
      chat_id: chatId, text: q, reply_to_message_id: messageId,
    });
    await saveMessage({
      conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
      direction: 'outbound', content: q, content_type: 'text', status: 'sent',
      is_ai_generated: true, ai_model: 'agent-clarify', telegram_chat_id: chatId,
      sent_at: new Date().toISOString(),
    });
    try {
      await supabase().from('conversations').update({
        metadata: { ...meta, last_job_question: q, last_job_context: text },
      }).eq('id', conversation.id);
    } catch (e) { console.warn('persist clarify meta:', e.message); }
    return true;
  }

  // Create the job (draft status — owner must approve to activate)
  const job = await createJob({
    businessId: business.id,
    customerId: customer.id,
    conversationId: conversation.id,
    title: detected.title || 'New project',
    description: detected.description || text.slice(0, 200),
    deadline: detected.deadline_hint || null,
    budget: detected.budget_hint || null,
    currency: detected.currency || 'ETB',
    steps: detected.steps || [],
    clientSnapshot: {
      name: customer.name || 'Client',
      telegram_id: customer.telegram_id,
      username: customer.telegram_username,
    },
  });
  if (!job) return false;

  // Clear any stored clarifying-question state — we've answered enough to proceed.
  if (priorQuestion) {
    try {
      await supabase().from('conversations').update({
        metadata: { ...meta, last_job_question: null, last_job_context: null },
      }).eq('id', conversation.id);
    } catch (e) { console.warn('clear clarify meta:', e.message); }
  }

  await logEvent(job.id, {
    kind: 'detected', icon: '🧠', title: 'Agent detected a multi-step job',
    body: `"${text.slice(0, 180)}${text.length > 180 ? '…' : ''}"`,
    auto: true, color: 'blue',
  });

  // Send a brief acknowledgment to the client so they aren't left hanging
  const am = isAmharic(text);
  const ack = am
    ? `እሺ፣ ተቀብያለሁ። ${business.owner_name || business.name} ወዲያው ያግኝዎታል 🙏`
    : `Got it — we're on it. ${business.owner_name || business.name} will confirm the details with you shortly 🙏`;
  await tg(token, 'sendMessage', {
    chat_id: chatId, text: ack, reply_to_message_id: messageId,
  });
  await saveMessage({
    conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
    direction: 'outbound', content: ack, content_type: 'text', status: 'sent',
    is_ai_generated: true, ai_model: 'agent-ack', telegram_chat_id: chatId,
    sent_at: new Date().toISOString(),
  });

  // Notify owner with inline approval buttons
  if (business.owner_private_chat_id) {
    const stepPreview = (detected.steps || []).slice(0, 6).map(s => `${s.icon || '•'} ${s.label}`).join('\n');
    const budget = detected.budget_hint
      ? `💰 Budget: ${Number(detected.budget_hint).toLocaleString()} ${detected.currency || 'ETB'}\n`
      : '';
    const deadline = detected.deadline_hint
      ? `📅 Deadline: ${new Date(detected.deadline_hint).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}\n`
      : '';
    await tg(token, 'sendMessage', {
      chat_id: business.owner_private_chat_id,
      text: `🤖 *New Agent job detected*\n\n*${job.title}*\nClient: ${customer.name || 'Customer'}\n${budget}${deadline}\n${detected.description || ''}\n\n*Proposed pipeline:*\n${stepPreview}`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Let Agent handle', callback_data: `job_approve_${job.id}` },
            { text: '🚫 I\'ll do it', callback_data: `job_decline_${job.id}` },
          ],
          [
            { text: '👁️ Open in dashboard', url: `${process.env.WEB_URL || 'https://web-theta-one-68.vercel.app'}/agent/${job.id}` },
          ],
        ],
      },
    });
  }
  return true;
}

// ───────────────────────────── Trust-level dispatch ─────────────────────────────
/**
 * SHADOW    — never auto-send, always draft + notify
 * SUPERVISED— always draft + notify (with edit buttons)
 * TRUSTED   — auto-send when confidence >= 0.7 AND intent is routine
 * FULL_AGENT— auto-send almost always (confidence >= 0.5)
 */
function shouldAutoSend(trustLevel, confidence, intent) {
  const isRoutine = ROUTINE_INTENTS.includes(intent?.intent);
  if (trustLevel >= TRUST_LEVELS.FULL_AGENT) return confidence >= 0.5;
  if (trustLevel >= TRUST_LEVELS.TRUSTED) return confidence >= 0.7 && isRoutine;
  return false; // SHADOW + SUPERVISED always draft
}

// ───────────────────────────── Pending owner edits ─────────────────────────────
/**
 * Owner tapped Edit → we replied with force_reply. When they reply in the next
 * update, `msg.reply_to_message` will reference that prompt. The prompt text
 * starts with the sentinel "✏️ Edit draft <uuid>" so we can recover the draft id
 * without any server-side session state.
 */
const EDIT_PROMPT_PREFIX = '✏️ Edit draft ';

async function handleOwnerPendingEdit(token, business, msg) {
  const replyTo = msg.reply_to_message;
  if (!replyTo?.text?.startsWith(EDIT_PROMPT_PREFIX)) return false;
  const draftId = replyTo.text.slice(EDIT_PROMPT_PREFIX.length).split(/\s/)[0].trim();
  if (!draftId) return false;

  const newText = msg.text;
  const sb = supabase();
  const { data: draft } = await sb.from('messages').select('*').eq('id', draftId).maybeSingle();
  if (!draft) {
    await tg(token, 'sendMessage', { chat_id: msg.chat.id, text: '❌ Draft not found — it may have been skipped already.' });
    return true;
  }

  // Send the edited reply to the customer
  await tg(token, 'sendMessage', {
    chat_id: draft.telegram_chat_id,
    text: newText,
    reply_to_message_id: draft.telegram_message_id || undefined,
  });
  await sb.from('messages').update({
    content: newText, status: 'sent', owner_edited: true,
    approved_at: new Date().toISOString(), sent_at: new Date().toISOString(),
  }).eq('id', draftId);

  await tg(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text: `✅ Edited reply sent.\n\n"${newText}"`,
  });
  return true;
}

// ───────────────────────────── Main entry ─────────────────────────────
export async function handleTenantUpdate(business, token, update) {
  // Callback queries (button taps) are handled by dispatchCallback() below.
  if (update.callback_query) return dispatchCallback(business, token, update.callback_query);

  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const senderId = msg.from?.id;
  const messageId = msg.message_id;

  // 1. Voice / photo / document → transcribe & analyze into msg.text
  if (!msg.text) {
    if (msg.voice || msg.audio || msg.video_note) {
      const tr = await transcribeTelegramAudio(token, msg);
      if (tr?.text) msg.text = `[voice] ${tr.text}`;
    } else if (msg.photo) {
      const desc = await describeTelegramPhoto(token, msg);
      if (desc) msg.text = `[photo analysis]\n${desc}${msg.caption ? `\n\nCustomer caption: ${msg.caption}` : ''}`;
    } else if (msg.document) {
      const doc = await readTelegramDocument(token, msg);
      if (doc) msg.text = `[document]\n${doc}${msg.caption ? `\n\nCustomer caption: ${msg.caption}` : ''}`;
    }
  }
  if (!msg.text) return;

  // ── Owner messaging their own bot ──
  if (senderId === business.owner_telegram_id) {
    // Owner replying to an Edit prompt with their edited reply?
    if (await handleOwnerPendingEdit(token, business, msg)) return;

    if (msg.text.startsWith('/start')) {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Hi ${business.owner_name || ''}! Your bot is connected to MiniMe.\n\nShare this link with customers: https://t.me/${business.telegram_bot_username || 'your_bot'}\n\nManage everything in the Mini App.`,
      });
    }
    return;
  }

  // ── Supplier reply? short-circuit ──
  if (await handleSupplierReply(token, business, msg, senderId)) return;

  // ── Customer flow ──
  const customer = await findOrCreateCustomer(business.id, msg.from);
  if (!customer) return;
  const conversation = await findOrCreateConversation(business.id, customer.id);
  if (!conversation) return;

  // Capture the Telegram file_id so the Agent can forward attachments later.
  let fileId = null, fileType = null, fileName = null;
  if (msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id;   // largest size
    fileType = 'photo';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = 'document';
    fileName = msg.document.file_name || null;
  } else if (msg.voice) {
    fileId = msg.voice.file_id; fileType = 'voice';
  } else if (msg.video || msg.video_note) {
    fileId = (msg.video || msg.video_note).file_id; fileType = 'video';
  }

  await saveMessage({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'inbound',
    content: msg.text,
    content_type: msg.voice || msg.audio || msg.video_note ? 'voice'
      : msg.photo ? 'photo'
      : msg.document ? 'document'
      : 'text',
    telegram_message_id: messageId,
    telegram_chat_id: chatId,
    telegram_file_id: fileId,
    telegram_file_type: fileType,
    telegram_file_name: fileName,
  });

  if (business.panic_mode) return;

  // 2. Scam shield
  const scan = scanForScam(msg.text);
  if (scan.isScam) {
    await notifyOwnerScamAlert(token, business, customer, msg.text, scan);
    await touchConversation(conversation.id, 'scam_flagged');
    return; // never auto-reply to scams
  }

  // 2b. Checkout short-circuit runs FIRST (orders need the Chapa flow,
  // not the agent brain). If this is a clear single-product order, handle
  // it and exit. Otherwise fall through to the brain.
  try {
    const handled = await tryCheckout(token, business, customer, conversation, msg.text, chatId, messageId);
    if (handled) { await touchConversation(conversation.id, 'order_created'); return; }
  } catch (e) { console.warn('checkout skipped:', e.message); }

  // 2c. BRAIN MODE — autonomous tool-calling agent.
  // When the business has opted in, Alfred reasons each turn instead of
  // following the rigid pipeline. Falls back to the pipeline on any error.
  if (business.brain_mode) {
    try {
      const out = await runBrain({
        token, business, customer, conversation,
        chatId, messageId, inboundText: msg.text,
      });
      if (out?.replied) {
        await touchConversation(conversation.id, out.created_job_id ? 'job_detected' : 'auto_sent');
        return;
      }
    } catch (e) {
      console.warn('brain failed, falling through:', e.message);
    }
  }

  // 3b. Multi-step Agent job detection — if the message describes a real
  // project (quantities + deadline + budget), create a Job and ping owner.
  try {
    const handled = await tryDetectJob(token, business, customer, conversation, msg.text, chatId, messageId);
    if (handled) { await touchConversation(conversation.id, 'job_detected'); return; }
  } catch (e) { console.warn('job detect skipped:', e.message); }

  // 4. Knowledge doc auto-send (price list / menu / portfolio).
  //    We send the doc but ALSO let the AI reply afterwards — customers asking
  //    "how much is X" want the number in chat too, not just a PDF attachment.
  let docWasSent = false;
  try {
    docWasSent = await tryAutoSendDocument(token, business, customer, chatId, msg.text);
  } catch (e) { console.warn('doc autosend:', e.message); }

  // 5. Intent (for routing + owner context)
  const history = await getRecentMessages(conversation.id, 6);
  const intent = await detectIntent(msg.text, history);

  // 6. Draft reply (RAG + voice profile + memory)
  const { draft, confidence } = await draftReply(business, customer, conversation, msg.text);
  if (!draft) return;

  const trustLevel = Number(business.trust_level ?? TRUST_LEVELS.SUPERVISED);
  const autoSend = shouldAutoSend(trustLevel, confidence, intent);

  if (autoSend) {
    await tg(token, 'sendMessage', {
      chat_id: chatId, text: draft, reply_to_message_id: messageId,
    });
    const saved = await saveMessage({
      conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
      direction: 'outbound', content: draft, content_type: 'text', status: 'sent',
      is_ai_generated: true, ai_model: 'gpt-4o',
      telegram_chat_id: chatId, sent_at: new Date().toISOString(),
      confidence,
    });
    await notifyOwnerAutoSent(token, business, customer, msg.text, draft, confidence);
    await touchConversation(conversation.id, 'auto_sent');
    return;
  }

  // SHADOW / SUPERVISED / not-confident-enough → save as draft + notify owner
  const saved = await saveMessage({
    conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
    direction: 'outbound', content: draft, content_type: 'text', status: 'pending_approval',
    is_ai_generated: true, ai_model: 'gpt-4o',
    telegram_chat_id: chatId, telegram_message_id: messageId,
    confidence,
  });
  if (saved?.id) {
    await notifyOwnerDraft(token, business, customer, msg.text, draft, confidence, saved.id, intent);
  }
  await touchConversation(conversation.id, 'drafted');
}

// ───────────────────────────── Callback-query dispatch ─────────────────────────────
async function answerCbq(token, id, text) {
  try { await tg(token, 'answerCallbackQuery', { callback_query_id: id, text }); } catch {}
}
async function editMsg(token, chatId, messageId, text, extra = {}) {
  try {
    await tg(token, 'editMessageText', {
      chat_id: chatId, message_id: messageId, text,
      parse_mode: extra.parse_mode || 'Markdown',
      ...extra,
    });
  } catch {}
}

async function dispatchCallback(business, token, q) {
  try {
    const data = q.data || '';
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;
    const sb = supabase();

    // ── Approve draft ──
    if (data.startsWith('approve_')) {
      const id = data.slice(8);
      const { data: m } = await sb.from('messages').select('*').eq('id', id).maybeSingle();
      if (!m) return answerCbq(token, q.id, '❌ Draft not found');
      await tg(token, 'sendMessage', {
        chat_id: m.telegram_chat_id, text: m.content,
        reply_to_message_id: m.telegram_message_id || undefined,
      });
      await sb.from('messages').update({
        status: 'sent', approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString(), owner_edited: false,
      }).eq('id', id);
      await editMsg(token, chatId, msgId, `✅ Sent!\n\n"${m.content}"`);
      return answerCbq(token, q.id, '✅ Sent');
    }

    // ── Edit draft (stateless via force_reply) ──
    if (data.startsWith('edit_')) {
      const id = data.slice(5);
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `${EDIT_PROMPT_PREFIX}${id}\n\nReply to this message with the edited version — I'll send it to the customer.`,
        reply_markup: { force_reply: true, selective: true },
      });
      return answerCbq(token, q.id, '✏️ Send your edited reply');
    }

    // ── Skip draft ──
    if (data.startsWith('skip_')) {
      const id = data.slice(5);
      await sb.from('messages').update({ status: 'skipped' }).eq('id', id);
      await editMsg(token, chatId, msgId, '⏭️ Skipped. Reply manually if needed.');
      return answerCbq(token, q.id, 'Skipped');
    }

    // ── Order fulfillment / refund (from the Chapa-paid DM) ──
    if (data.startsWith('order_fulfill_')) {
      const orderId = data.slice('order_fulfill_'.length);
      const { data: order } = await sb.from('orders').select('*, customers(*)').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Not found');
      await sb.from('orders').update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }).eq('id', orderId);
      await editMsg(token, chatId, msgId, `✅ Order fulfilled — ${order.total} ${order.currency} · ${order.customers?.name || 'customer'}`);
      if (order.customers?.telegram_id) {
        await tg(token, 'sendMessage', {
          chat_id: order.customers.telegram_id,
          text: `📦 Your order is on its way! Thanks again — ${order.customers.name || ''}`.trim(),
        });
      }
      return answerCbq(token, q.id, '✅ Fulfilled');
    }
    if (data.startsWith('order_refund_')) {
      const orderId = data.slice('order_refund_'.length);
      await sb.from('orders').update({ status: 'refunded', owner_note: 'Refund initiated by owner' }).eq('id', orderId);
      await editMsg(token, chatId, msgId, '↩️ Order marked for refund. Process it in Chapa dashboard.');
      return answerCbq(token, q.id, 'Marked refunded');
    }

    // ── Agent job approval ──
    if (data.startsWith('job_approve_')) {
      const jobId = data.slice('job_approve_'.length);
      const { data: job } = await sb.from('jobs').select('*, customers(*)').eq('id', jobId).maybeSingle();
      if (!job) return answerCbq(token, q.id, '❌ Job not found');

      await sb.from('jobs').update({
        status: 'active',
        current_step: 1,
      }).eq('id', jobId);

      // Mark the first "agent ack" step as done, next one as active
      await sb.from('job_steps').update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('job_id', jobId).eq('order_index', 0);
      await sb.from('job_steps').update({ status: 'active', started_at: new Date().toISOString() })
        .eq('job_id', jobId).eq('order_index', 1);

      await logEvent(jobId, {
        kind: 'approved', icon: '✅', title: 'Owner approved the job',
        body: 'Agent will now orchestrate the pipeline.',
        auto: false, color: 'green',
      });

      // Send a confident, tailored follow-up to the client
      const isAm = job.customers?.language === 'am';
      const followup = isAm
        ? `ጥሩ ዜና! ለ"${job.title}" ስራ ጀምሬያለሁ። ሂደቱን እከታተልና በየደረጃው አዘምንሃለሁ 💪`
        : `Good news — I've started work on "${job.title}". I'll keep you posted as each stage completes 💪`;
      if (job.customers?.telegram_id) {
        await tg(token, 'sendMessage', {
          chat_id: job.customers.telegram_id,
          text: followup,
        });
        await logEvent(jobId, {
          kind: 'auto_sent', icon: '📨', title: 'Confirmed with client',
          body: followup, auto: true, color: 'green',
        });
      }

      // Fire the fan-out — pick supplier, generate brief, DM them.
      try {
        await kickoffJob({ token, jobId });
      } catch (e) {
        console.warn('kickoffJob:', e.message);
        await logEvent(jobId, {
          kind: 'error', icon: '⚠️', title: 'Fan-out failed',
          body: e.message || 'Unknown error', auto: true, color: 'red',
        });
      }

      await editMsg(token, chatId, msgId, `✅ *${job.title}* — Agent is handling it.\n\nTrack progress: ${process.env.WEB_URL || 'https://web-theta-one-68.vercel.app'}/agent/${jobId}`);
      return answerCbq(token, q.id, '✅ Agent activated');
    }

    if (data.startsWith('job_decline_')) {
      const jobId = data.slice('job_decline_'.length);
      await sb.from('jobs').update({ status: 'cancelled' }).eq('id', jobId);
      await logEvent(jobId, {
        kind: 'cancelled', icon: '🚫', title: 'Owner declined Agent handling',
        body: 'Handling this one manually.', auto: false, color: 'red',
      });
      await editMsg(token, chatId, msgId, '🚫 Job cancelled — you\'re handling this one manually.');
      return answerCbq(token, q.id, 'Declined');
    }

    // ── Supplier quote actions ──
    if (data.startsWith('quote_approve_')) {
      const taskId = data.slice('quote_approve_'.length);
      const { data: task } = await sb.from('agent_tasks').select('*').eq('id', taskId).maybeSingle();
      if (!task) return answerCbq(token, q.id, '❌ Not found');
      const quote = task.payload?.latest_quote || {};
      const est = quote.unit_price && (quote.quantity || 50) ? quote.unit_price * (quote.quantity || 50) : task.estimated_amount;
      await sb.from('agent_tasks').update({
        status: 'approved', approved_by: 'owner',
        approved_at: new Date().toISOString(), estimated_amount: est,
      }).eq('id', taskId);
      await tg(token, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
      });
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Quote approved. Proceed as agreed:\n• ${quote.unit_price || '?'} ${quote.currency || ''} × ${quote.quantity || '?'}\n• Lead time: ${quote.lead_time_days || '?'} days\n• Terms: ${quote.payment_terms || '—'}`,
      });
      return answerCbq(token, q.id, '✅ Approved');
    }
    if (data.startsWith('quote_decline_')) {
      const taskId = data.slice('quote_decline_'.length);
      await sb.from('agent_tasks').update({ status: 'cancelled' }).eq('id', taskId);
      await tg(token, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
      });
      await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ Quote declined. Task cancelled.' });
      return answerCbq(token, q.id, 'Declined');
    }
    if (data.startsWith('quote_negotiate_')) {
      const taskId = data.slice('quote_negotiate_'.length);
      const { data: task } = await sb.from('agent_tasks').select('*').eq('id', taskId).maybeSingle();
      if (!task) return answerCbq(token, q.id, '❌ Not found');
      const quote = task.payload?.latest_quote || {};
      const product = task.payload?.product || {};
      const { data: supplier } = await sb.from('suppliers').select('*')
        .eq('business_id', task.business_id).ilike('name', task.supplier_name || '').maybeSingle();
      const isIntl = !!supplier?.is_international;
      const prompt = `You are ${business.owner_name || 'the owner'} replying to a supplier's quote and negotiating gently. ${isIntl ? 'Write in professional English (formal trade tone).' : "Write in warm Amharic (Ge'ez ፊደል)."}\n\nTheir quote:\n- Unit price: ${quote.unit_price ?? '?'} ${quote.currency ?? ''}\n- Quantity: ${quote.quantity ?? 'as discussed'}\n- Lead time: ${quote.lead_time_days ?? '?'} days\n- Payment: ${quote.payment_terms ?? '?'}\n- Incoterms: ${quote.incoterms ?? '?'}\n\nWrite a short, polite counter (3–5 sentences max): thank them, note one gentle concern, propose a small improvement, keep the relationship warm.`;
      const draft = (await openai.chat.completions.create({
        model: 'gpt-4o', temperature: 0.6, max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      })).choices[0].message.content.trim();
      await tg(token, 'editMessageReplyMarkup', {
        chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] },
      });
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `💬 *Negotiation draft for ${task.supplier_name}*:\n\n${draft}\n\n_Copy & send via your preferred channel._`,
        parse_mode: 'Markdown',
      });
      return answerCbq(token, q.id, '💬 Draft ready');
    }

    return answerCbq(token, q.id, '');
  } catch (e) {
    console.error('dispatchCallback:', e);
    return answerCbq(token, q.id, '❌ Error');
  }
}
