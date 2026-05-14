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
import { TRUST_LEVELS, ROUTINE_INTENTS, MODEL, MODEL_MINI } from './constants';
import { scanForScam } from './scam';
import { runBrain } from './agentBrain';
import { transcribeTelegramAudio, describeTelegramPhoto, readTelegramDocument } from './transcription';
import { retrieveRelevantChunks, matchDocumentByIntent, downloadDocument, looksLikeDocumentRequest } from './knowledge';
import { detectIntent } from './intent';
import { handleSupplierReply } from './supplierReply';
import { notifyOwnerDraft, notifyOwnerAutoSent, notifyOwnerScamAlert, forwardMessageToOwner } from './notification';
import { detectJob } from './jobDetector';
import { createJob, logEvent, advanceStep } from './jobs';
import { tg, tgSendDocument } from './telegramApi';
import { decrementProductStock } from './orders';

const MINIAPP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app';

/**
 * Best chat ID to reach the owner privately.
 * Prefers owner_private_chat_id (set when owner first DMs the bot) and falls
 * back to owner_telegram_id (same value in most cases, but explicit fallback
 * prevents silent notification loss when the field hasn't been set yet).
 */
function ownerChatId(business) {
  return business.owner_private_chat_id || business.owner_telegram_id || null;
}

/** Telegram Stars or native invoice paid → mark order paid + notify owner */
async function handleSuccessfulPayment(business, token, msg) {
  const sp = msg.successful_payment;
  if (!sp) return;
  const payload = sp.invoice_payload || '';
  const orderId = payload.startsWith('order:') ? payload.slice('order:'.length) : null;
  if (!orderId) return;
  const sb = supabase();
  const { data: order } = await sb.from('orders').select('*, customers(*)').eq('id', orderId).maybeSingle();
  if (!order) return;
  await sb.from('orders').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    payment_method: sp.currency === 'XTR' ? 'telegram_stars' : sp.currency.toLowerCase(),
    chapa_tx_ref: order.chapa_tx_ref || sp.telegram_payment_charge_id || sp.provider_payment_charge_id,
  }).eq('id', orderId);

  // Deduct stock for each item in the order
  for (const item of order.items || []) {
    if (item.product_id) {
      try { await decrementProductStock(item.product_id, item.quantity || 0); }
      catch (e) { console.warn('stock deduct (stars/invoice):', e.message); }
    }
  }

  // Receipt to customer
  if (order.customers?.telegram_id) {
    await tg(token, 'sendMessage', {
      chat_id: order.customers.telegram_id,
      text: formatReceipt({ business, order: { ...order, status: 'paid', paid_at: new Date().toISOString() } }),
      parse_mode: 'Markdown',
    });
  }
  // Notify owner
  if (ownerChatId(business)) {
    const method = sp.currency === 'XTR' ? `${sp.total_amount} Stars` : `${(sp.total_amount / 100).toFixed(2)} ${sp.currency}`;
    await tg(token, 'sendMessage', {
      chat_id: ownerChatId(business),
      text: `💰 *Payment received*\n\n${order.customers?.name || 'Customer'} just paid via *${sp.currency === 'XTR' ? 'Telegram Stars' : sp.currency}* (${method}) for order ${order.id.slice(0, 8)}.`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '✓ Mark fulfilled', callback_data: `order_fulfill_${order.id}` }]] },
    });
  }
}

/** Build a clean Telegram-Markdown receipt for a fulfilled order. */
function formatReceipt({ business, order }) {
  const lines = [];
  const date = new Date(order.fulfilled_at || order.updated_at || order.created_at || Date.now())
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const ref = (order.chapa_tx_ref || order.id || '').slice(0, 16);

  lines.push(`🧾 *Receipt — ${business.name}*`);
  lines.push(`_${date}_  ·  Ref: \`${ref}\``);
  lines.push('');

  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length) {
    for (const it of items) {
      const qty = it.quantity || 1;
      const sub = it.subtotal != null ? Number(it.subtotal) : Number(it.unit_price || 0) * qty;
      lines.push(`• ${qty} × ${it.name || 'item'}  —  ${sub.toLocaleString()} ${order.currency || 'ETB'}`);
    }
    lines.push('');
  }
  lines.push(`*Total:* ${Number(order.total || 0).toLocaleString()} ${order.currency || 'ETB'}`);
  lines.push(`*Status:* ✅ Paid & on the way`);

  if (business.address) lines.push(`\n📍 ${business.address}`);
  if (business.whatsapp || business.telegram_bot_username) {
    const contact = business.whatsapp ? `WhatsApp ${business.whatsapp}` : `@${business.telegram_bot_username}`;
    lines.push(`💬 Need help? ${contact}`);
  }
  lines.push(`\nThank you for your order! 🙏`);
  return lines.join('\n');
}

// Returns true if the current Addis Ababa hour is inside the quiet window.
// Window can wrap midnight (e.g. 22 → 8 means 22:00–07:59 is quiet).
function isInQuietHours(dnd) {
  if (!dnd?.enabled) return false;
  const start = Number(dnd.start_hour);
  const end = Number(dnd.end_hour);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  // Africa/Addis_Ababa is fixed UTC+3, no DST.
  const now = new Date();
  const addisHour = (now.getUTCHours() + 3) % 24;
  if (start < end) return addisHour >= start && addisHour < end;
  // wraps midnight
  return addisHour >= start || addisHour < end;
}
function buildActionUrl(a /*, business */) {
  switch (a.kind) {
    case 'open_client':   return `${MINIAPP_BASE}/customers?q=${encodeURIComponent(a.client || '')}`;
    case 'draft_reply':   return `${MINIAPP_BASE}/conversations?q=${encodeURIComponent(a.client || '')}`;
    case 'open_job':      return `${MINIAPP_BASE}/agent/${a.job_id}`;
    case 'open_teach':    return `${MINIAPP_BASE}/agent/knowledge`;
    case 'toggle_dnd':    return `${MINIAPP_BASE}/settings`;
    case 'upgrade_trust': return `${MINIAPP_BASE}/settings/trust`;
    case 'send_review_request': return `${MINIAPP_BASE}/conversations?q=${encodeURIComponent(a.client || '')}`;
    default: return null;
  }
}
import { kickoffJob } from './jobFanout';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

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

function buildSystemPrompt(business, products, voiceProfile, sampleReplies, customer) {
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

  // Owner's behavioral rules (injected at highest priority)
  const ownerRules = (business.owner_instructions || []);
  const instructionsBlock = ownerRules.length
    ? `\n\n## OWNER'S RULES — ALWAYS FOLLOW (these override all your defaults):\n${ownerRules.map(r => `- ${r.rule}`).join('\n')}`
    : '';

  // Customer recognition — greet by first name when we have a real one
  const rawName = (customer?.name || '').trim();
  const firstName = rawName && rawName !== 'Customer' ? rawName.split(/\s+/)[0] : '';
  const customerBlock = firstName
    ? `\n\n## CUSTOMER\nThe customer's first name is **${firstName}**. When opening a conversation (no recent history), greet them by name naturally — e.g. "ሰላም ${firstName}!" or "Hi ${firstName} 👋". Use the name at most once at the open and once at the close — never sprinkle it through every line.`
    : '';

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
  : '## CATALOG: (empty — tell the customer the catalog is being set up and offer to pass their question to the owner.)'}${contactBlock}${voiceBlock}${instructionsBlock}${customerBlock}`;
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
    customer,
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
      model: MODEL,
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
    let draft = res.choices[0]?.message?.content?.trim() || null;
    if (!draft) return { draft: null, confidence: 0 };

    // If the customer wrote in Amharic, polish GPT's reply with Hasab for natural spoken Amharic
    if (isAmharic(incomingText) && draft) {
      try {
        const { translateToAmharic } = await import('./hasab');
        const amharicDraft = await translateToAmharic(draft);
        if (amharicDraft && amharicDraft.length > 10) {
          draft = amharicDraft;
        }
      } catch (e) { console.warn('hasab amharic polish:', e.message); }
    }

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

// Anything that implies design/personalization MUST go through the brain's
// discovery flow, never the one-shot checkout.
const CUSTOMIZATION_HINTS = /\b(customi[sz]e|custom|personali[sz]e|design|logo|brand|colors?|theme|tagline|engrav|monogram|with my name|with our|my company|our company|business card|wedding|invitation|brochure)\b/i;
const CUSTOMIZATION_HINTS_AM = /(ዲዛይን|ሎጎ|ብራንድ|ቀለም|ስም|ኩባንያ|የኔ|የእኔ|ጋብቻ|ጥሪ|ካርድ)/;
function looksLikeCustomization(text) {
  if (!text) return false;
  return CUSTOMIZATION_HINTS.test(text) || CUSTOMIZATION_HINTS_AM.test(text);
}

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
      model: MODEL,
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

export async function generateChapaLink(business, customer, order, items, total, currency) {
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
  // If the message smells like a customization/design request, never short-circuit
  // — the brain needs to run the discovery checklist (purpose, name, colors, etc).
  if (looksLikeCustomization(incomingText)) return false;

  const products = await getProducts(business.id);
  const extracted = await extractOrder(incomingText, products);
  // Higher bar so ambiguous "I want one" goes to the brain (which asks for
  // delivery address, phone, deadline, etc). Real, complete orders look like
  // "I'll take 2 cards, deliver to Bole, phone 0911..." and will score >0.85.
  if (!extracted.is_order || extracted.confidence < 0.85) return false;

  // If the text doesn't already include a phone-like number AND the order is
  // for a deliverable item, defer to brain so it can collect contact + address.
  const hasPhoneOrAddress = /\b\d{7,}\b|\bbole\b|\bpiazza\b|\bcmc\b|\baddis\b|\bsefer\b|deliver/i.test(incomingText);
  if (!hasPhoneOrAddress) return false;

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
  const editNow = new Date().toISOString();
  await sb.from('messages').update({
    content: newText, status: 'sent', owner_edited: true,
    approved_at: editNow, sent_at: editNow,
  }).eq('id', draftId);
  await sb.from('conversations').update({
    requires_owner: false, last_ai_action: 'approved', last_message_at: editNow,
  }).eq('id', draft.conversation_id);

  await tg(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text: `✅ Edited reply sent.\n\n"${newText}"`,
  });
  return true;
}

// ───────────────────────────── Main entry ─────────────────────────────
export async function handleTenantUpdate(business, token, update) {
  // Telegram payment events (Stars / native invoices)
  if (update.pre_checkout_query) {
    try { await tg(token, 'answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true }); } catch {}
    return;
  }
  if (update.message?.successful_payment) {
    return handleSuccessfulPayment(business, token, update.message);
  }

  // Callback queries (button taps) are handled by dispatchCallback() below.
  if (update.callback_query) return dispatchCallback(business, token, update.callback_query);

  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const senderId = msg.from?.id;
  const messageId = msg.message_id;

  // Determine privilege level.
  // Owner and any sub-admins get the full bot dashboard; everyone else is a customer.
  const isOwner    = senderId === business.owner_telegram_id;
  const isSubAdmin = !isOwner && Array.isArray(business.sub_admin_telegram_ids)
    && business.sub_admin_telegram_ids.includes(senderId);
  const isPrivileged = isOwner || isSubAdmin;

  // 1. Voice / photo / document → transcribe & analyze into msg.text
  // NOTE: skip for privileged users — the owner/sub-admin section has its own targeted
  //       handlers (teachFromMedia, transcription for knowledge ingestion, etc.)
  if (!msg.text && !isPrivileged) {
    if (msg.voice || msg.audio || msg.video_note) {
      const tr = await transcribeTelegramAudio(token, msg);
      if (tr?.text) {
        // If Hasab returned an English translation alongside Amharic, include both
        msg.text = tr.translation
          ? `[voice] ${tr.text}\n[translation] ${tr.translation}`
          : `[voice] ${tr.text}`;
      }
    } else if (msg.photo) {
      const desc = await describeTelegramPhoto(token, msg);
      if (desc) msg.text = `[photo analysis]\n${desc}${msg.caption ? `\n\nCustomer caption: ${msg.caption}` : ''}`;
    } else if (msg.document) {
      const doc = await readTelegramDocument(token, msg);
      if (doc) msg.text = `[document]\n${doc}${msg.caption ? `\n\nCustomer caption: ${msg.caption}` : ''}`;
    }
  }
  // For customer messages, bail out if we couldn't extract any text
  if (!msg.text && !isPrivileged) return;

  // ── Owner / Sub-admin messaging their own bot ──
  if (isPrivileged) {
    // ── Auto-register owner_private_chat_id on first contact ─────────────
    // Notifications (draft alerts, order pings, low-stock, etc.) target
    // owner_private_chat_id. If it's null the owner never gets notified.
    // We update it here — this also self-heals when the owner switches devices.
    if (isOwner && business.owner_private_chat_id !== chatId) {
      try {
        await supabase().from('businesses')
          .update({ owner_private_chat_id: chatId })
          .eq('id', business.id);
        business.owner_private_chat_id = chatId; // keep local copy in sync
      } catch {}
    }

    // Owner replying to an Edit prompt with their edited reply?
    if (msg.text && await handleOwnerPendingEdit(token, business, msg)) return;

    if (msg.text?.startsWith('/start')) {
      const alreadyKnown = business.owner_private_chat_id === chatId;
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ Hi ${business.owner_name || ''}! Your bot is connected to MiniMe.${!alreadyKnown ? '\n\n🔔 Notifications are now active — you\'ll receive draft alerts, order pings, and low-stock warnings here.' : ''}\n\nShare this link with customers: https://t.me/${business.telegram_bot_username || 'your_bot'}\n\nManage everything in the Mini App.`,
      });
      return;
    }

    // ── All text-based owner commands (slash commands + forwards) ─────────
    if (msg.text) {

    // /teach — open the teaching flow OR accept inline knowledge
    if (msg.text.startsWith('/teach')) {
      const after = msg.text.replace(/^\/teach(@\S+)?\s*/, '').trim();
      if (!after) {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: 'Teach me about your business. You can:\n\n• Type `/teach <description>` — describe your shop, prices, clients\n• Forward any client message — I\'ll extract names, mood, project hints\n• Open the Mini App for the full teaching tools',
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🧠 Open Teaching Guide', url: `${MINIAPP_BASE}/advisor/teach` }]] },
        });
        return;
      }
      try {
        const { teachFromText } = await import('./teaching');
        const r = await teachFromText(business.id, after);
        const ex = r.extracted || {};
        const lines = ['✓ Got it. I learned:'];
        if (ex.summary) lines.push(`📝 ${ex.summary}`);
        if (ex.category) lines.push(`🏷️ ${ex.category}`);
        if (ex.services?.length) lines.push(`🛠️ ${ex.services.join(', ')}`);
        if (ex.price_range && (ex.price_range.min || ex.price_range.max)) lines.push(`💰 ${ex.price_range.min || '?'}–${ex.price_range.max || '?'} ${ex.price_range.currency || 'ETB'}`);
        if (ex.turnaround) lines.push(`⏱️ ${ex.turnaround}`);
        await tg(token, 'sendMessage', { chat_id: chatId, text: lines.join('\n') });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Teaching error: ${e.message}` });
      }
      return;
    }

    // ── Owner forwarded a message → learn from it regardless of type ────────
    if (msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) {
      const forwardedFrom =
        msg.forward_from?.first_name ||
        msg.forward_from?.username ||
        msg.forward_from_chat?.title ||
        msg.forward_sender_name ||
        'unknown';

      await tg(token, 'sendMessage', { chat_id: chatId, text: `⏳ Learning from ${forwardedFrom}…` });

      try {
        // ── 1. Forwarded document (PDF / image-as-doc / text file) ────────────
        if (msg.document) {
          const { teachFromDocument } = await import('./teachFromMedia');
          const r = await teachFromDocument(token, business.id, msg);
          if (r.ok) {
            const src = r.source === 'pdf'   ? `📄 PDF (${r.chunks} chunks saved)`
                      : r.source === 'image' ? '🖼️ Image described'
                      :                        '📝 Text file saved';
            await tg(token, 'sendMessage', {
              chat_id: chatId,
              text: `✅ *Learned from ${forwardedFrom}!* ${src}\n\n_Preview:_ ${r.preview || ''}`,
              parse_mode: 'Markdown',
            });
          } else {
            await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't read that file: ${r.error}` });
          }
          return;
        }

        // ── 2. Forwarded voice / audio ────────────────────────────────────────
        if (msg.voice || msg.audio || msg.video_note) {
          const { transcribeTelegramAudio } = await import('./transcription');
          const tr = await transcribeTelegramAudio(token, msg);
          if (tr?.text) {
            const { teachFromText } = await import('./teaching');
            const fullText = msg.caption ? `${msg.caption}\n\n${tr.text}` : tr.text;
            await teachFromText(business.id, fullText);
            const via = tr.via === 'hasab' ? '🇪🇹 Hasab' : '🎙️ Whisper';
            await tg(token, 'sendMessage', {
              chat_id: chatId,
              text: `✅ *Learned from ${forwardedFrom}!* (${via})\n\n_"${tr.text.slice(0, 160)}${tr.text.length > 160 ? '…' : ''}"_`,
              parse_mode: 'Markdown',
            });
          } else {
            await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't transcribe that audio from ${forwardedFrom}.` });
          }
          return;
        }

        // ── 3. Forwarded message containing a URL → ingest the page ───────────
        const fwdContent = msg.text || msg.caption || '';
        const urlMatch = fwdContent.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          const url = urlMatch[0].replace(/[.,;!?)]+$/, '');
          const { teachFromLink } = await import('./teachFromMedia');
          const r = await teachFromLink(business.id, url);
          // Also save any extra text from the forwarded message
          const extraText = fwdContent.replace(url, '').trim();
          if (extraText) {
            const { teachFromText } = await import('./teaching');
            await teachFromText(business.id, extraText, { forwardedFrom });
          }
          if (r.ok) {
            await tg(token, 'sendMessage', {
              chat_id: chatId,
              text: `✅ *Learned from ${forwardedFrom}!*\n\n📎 _${r.title || url}_ — ${r.chunks} chunks saved`,
              parse_mode: 'Markdown',
            });
          } else {
            await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't read that link: ${r.error}` });
          }
          return;
        }

        // ── 4. Forwarded photo → Vision describe + product detection ───────────
        if (msg.photo?.length) {
          const { teachFromPhoto } = await import('./teachFromMedia');
          const photoResult = await teachFromPhoto(token, business.id, msg);

          // Also try product extraction from caption
          let productResult = null;
          const captionText = msg.caption || '';
          if (captionText) {
            try {
              const { extractProductFromMessage, upsertProductFromForward } = await import('./teaching');
              const productData = await extractProductFromMessage(captionText);
              if (productData) {
                // Grab the photo to use as product image
                let imageUrl = null;
                try {
                  const largestPhoto = msg.photo[msg.photo.length - 1];
                  const fileRes = await tg(token, 'getFile', { file_id: largestPhoto.file_id });
                  if (fileRes?.ok && fileRes.result?.file_path) {
                    const photoUrl = `https://api.telegram.org/file/bot${token}/${fileRes.result.file_path}`;
                    const buf = Buffer.from(await (await fetch(photoUrl)).arrayBuffer());
                    const ext = fileRes.result.file_path.split('.').pop() || 'jpg';
                    const storagePath = `products/${business.id}/fwd-${Date.now()}.${ext}`;
                    await supabase().storage.from('documents').upload(storagePath, buf, {
                      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true,
                    });
                    const { data: ud } = supabase().storage.from('documents').getPublicUrl(storagePath);
                    imageUrl = ud?.publicUrl || null;
                  }
                } catch {}
                productResult = await upsertProductFromForward(business.id, productData, imageUrl);
              }
            } catch {}
          }

          const lines = [`✅ *Learned from ${forwardedFrom}!* 🖼️`];
          if (productResult?.created) lines.push(`🛍️ *New product:* ${productResult.product.name}`);
          else if (productResult) lines.push(`🔄 *Product updated:* ${productResult.product.name}`);
          if (photoResult?.preview) lines.push(`\n_${photoResult.preview.slice(0, 160)}_`);
          await tg(token, 'sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' });
          return;
        }

        // ── 5. Plain text forward → product/stock detection + teachFromText ───
        if (!fwdContent) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ That forwarded message doesn't have any readable content.` });
          return;
        }

        const { teachFromText, extractStockChanges, applyStockChanges, extractProductFromMessage, upsertProductFromForward } = await import('./teaching');

        // Find linked customer
        let matchedCustomerId = null;
        if (msg.forward_from?.id) {
          const { data: c } = await supabase().from('customers').select('id')
            .eq('business_id', business.id).eq('telegram_id', msg.forward_from.id).maybeSingle();
          if (c) matchedCustomerId = c.id;
        }

        // Stock changes
        const stockHint = /\b(stock|inventory|received|in stock|out of stock|sold|delivered|left|remaining|count)\b/i.test(fwdContent)
          || /(\d+)\s*(pcs|pieces|cards|units|boxes|kg|liters|bottles)/i.test(fwdContent);
        let stockSummary = null;
        if (stockHint) {
          const { data: products } = await supabase().from('products')
            .select('id, name, name_am, stock_quantity').eq('business_id', business.id).eq('is_active', true).limit(50);
          if (products?.length) {
            const updates = await extractStockChanges(fwdContent, products);
            if (updates.length) {
              const applied = await applyStockChanges(business.id, updates);
              stockSummary = applied.filter(a => !a.error);
            }
          }
        }

        // Product detection
        let productResult = null;
        try {
          const productData = await extractProductFromMessage(fwdContent);
          if (productData) productResult = await upsertProductFromForward(business.id, productData, null);
        } catch {}

        const r = await teachFromText(business.id, fwdContent, { forwardedFrom, attachedCustomerId: matchedCustomerId });
        const ex = r.extracted || {};
        const lines = [`✅ *Learned from ${forwardedFrom}!*`];
        if (productResult?.created)  lines.push(`🛍️ *New product:* ${productResult.product.name}${productResult.product.price ? ` — ${productResult.product.price} ETB` : ''}`);
        else if (productResult)      lines.push(`🔄 *Updated:* ${productResult.product.name}`);
        if (stockSummary?.length) {
          lines.push('📦 *Stock updated:*');
          for (const s of stockSummary) lines.push(`• ${s.product}: ${s.before} → ${s.after}`);
        }
        if (ex.client_name)   lines.push(`👤 ${ex.client_name}`);
        if (ex.facts?.length) lines.push(...ex.facts.slice(0, 4).map(f => `• ${f}`));
        if (matchedCustomerId) lines.push('_Saved to that client\'s profile._');
        lines.push('\n💡 _/advisor to discuss this._');
        await tg(token, 'sendMessage', { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' });

      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Forward learning error: ${e.message}` });
      }
      return;
    }

    // /rule <text> — save a behavioral rule directly (no GPT classification needed)
    if (msg.text.startsWith('/rule ') || msg.text.match(/^\/rule(@\S+)?\s+\S/)) {
      const rule = msg.text.replace(/^\/rule(@\S+)?\s+/, '').trim();
      if (!rule) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ Usage: `/rule use emojis often`', parse_mode: 'Markdown' });
        return;
      }
      try {
        const { saveOwnerInstruction, listOwnerInstructions } = await import('./advisor');
        const updated = await saveOwnerInstruction(business.id, rule);
        const list = updated.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
        await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ Rule saved!\n\n📋 *All rules:*\n${list}`, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /rules — list all current behavioral rules
    if (msg.text.match(/^\/rules(@\S+)?(\s|$)/)) {
      try {
        const { listOwnerInstructions } = await import('./advisor');
        const rules = await listOwnerInstructions(business.id);
        if (!rules.length) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: '📋 No rules set yet.\n\nAdd one with:\n`/rule use emojis often`', parse_mode: 'Markdown' });
        } else {
          const list = rules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
          await tg(token, 'sendMessage', { chat_id: chatId, text: `📋 *Your rules:*\n${list}\n\nAdd: \`/rule <text>\`\nClear all: \`/clearrules\``, parse_mode: 'Markdown' });
        }
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /clearrules — remove all rules
    if (msg.text.match(/^\/clearrules(@\S+)?(\s|$)/)) {
      try {
        const { supabase } = await import('./db');
        await supabase().from('businesses').update({ owner_instructions: [] }).eq('id', business.id);
        await tg(token, 'sendMessage', { chat_id: chatId, text: '🗑️ All rules cleared.' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /knowledge — list recent knowledge items with delete buttons
    if (msg.text.match(/^\/knowledge(@\S+)?(\s|$)/)) {
      try {
        const sb = supabase();
        const { data: docs } = await sb.from('documents')
          .select('id, title, tag, status, created_at')
          .eq('business_id', business.id)
          .order('created_at', { ascending: false })
          .limit(8);
        if (!docs?.length) {
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: '📚 *Knowledge base is empty.*\n\nSend a PDF, photo, voice note, or link to start teaching MiniMe!',
            parse_mode: 'Markdown',
          });
          return;
        }
        const tagIcon = t => ({ pdf_upload:'📄', bot_upload:'📎', bot_link:'🔗', faq:'❓', 'business-brief':'📝', 'forwarded-notes':'💬' })[t] || '📋';
        const keyboard = docs.map(d => [{
          text: `🗑️ "${(d.title || 'Untitled').slice(0, 40)}"`,
          callback_data: `del_doc_${d.id}`,
        }]);
        const list = docs.map((d, i) => `${i + 1}. ${tagIcon(d.tag)} ${(d.title || 'Untitled').slice(0, 50)} _(${d.tag})_`).join('\n');
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `📚 *Recent knowledge (${docs.length} items):*\n\n${list}\n\nTap a 🗑️ button to delete an item.`,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /forget <query> — delete knowledge items matching the query
    if (msg.text.match(/^\/forget(@\S+)?\s+\S/)) {
      const query = msg.text.replace(/^\/forget(@\S+)?\s+/, '').trim();
      try {
        const sb = supabase();
        const { data: docs } = await sb.from('documents')
          .select('id, title, tag')
          .eq('business_id', business.id)
          .ilike('title', `%${query}%`)
          .limit(5);
        if (!docs?.length) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: `🔍 No knowledge items matched *"${query}"*.`, parse_mode: 'Markdown' });
          return;
        }
        if (docs.length === 1) {
          // Single match — ask for confirmation
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `Found *"${docs[0].title}"*. Delete it?`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
              { text: '🗑️ Yes, delete', callback_data: `del_doc_${docs[0].id}` },
              { text: '❌ Cancel', callback_data: 'noop' },
            ]]},
          });
        } else {
          // Multiple matches — show each with delete button
          const keyboard = docs.map(d => [{ text: `🗑️ ${d.title.slice(0, 40)}`, callback_data: `del_doc_${d.id}` }]);
          const list = docs.map((d, i) => `${i + 1}. ${d.title.slice(0, 50)}`).join('\n');
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `Found ${docs.length} matches for *"${query}"*:\n\n${list}\n\nTap to delete:`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
          });
        }
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /price <product> <new_price> — update a product's price from the bot
    // Usage: /price Injera 18   or   /price "Spaghetti Special" 120
    if (msg.text.match(/^\/price(@\S+)?\s+\S/)) {
      const after = msg.text.replace(/^\/price(@\S+)?\s+/, '').trim();
      // Split on last whitespace-separated token which should be the price
      const priceMatch = after.match(/^([\s\S]+?)\s+([\d,.]+)\s*(?:ETB|birr|br)?$/i);
      if (!priceMatch) {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: '❌ Usage: `/price <product name> <new price>`\n\nExample: `/price Injera 18`',
          parse_mode: 'Markdown',
        });
        return;
      }
      const [, productQuery, rawPrice] = priceMatch;
      const newPrice = parseFloat(rawPrice.replace(/,/g, ''));
      if (!Number.isFinite(newPrice) || newPrice < 0) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ That doesn\'t look like a valid price.' });
        return;
      }
      try {
        const { data: products } = await supabase().from('products')
          .select('id, name, price, currency').eq('business_id', business.id).eq('is_active', true);
        if (!products?.length) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ No products found. Add products in the Mini App first.' });
          return;
        }
        // Fuzzy match: prefer exact (case-insensitive), then substring
        const q = productQuery.trim().toLowerCase();
        let match = products.find(p => p.name.toLowerCase() === q);
        if (!match) match = products.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
        if (!match) {
          const names = products.slice(0, 10).map(p => `• ${p.name}`).join('\n');
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `❌ No product matched *"${productQuery}"*.\n\nYour products:\n${names}`,
            parse_mode: 'Markdown',
          });
          return;
        }
        const oldPrice = match.price != null ? `${Number(match.price).toLocaleString()} ${match.currency || 'ETB'}` : 'not set';
        await supabase().from('products').update({ price: newPrice }).eq('id', match.id);
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `✅ *${match.name}* — price updated!\n\n${oldPrice} → *${newPrice.toLocaleString()} ${match.currency || 'ETB'}*`,
          parse_mode: 'Markdown',
        });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /restock <product> <quantity> — set or add stock from the bot
    // Usage: /restock Injera 100   →  sets stock to 100
    //        /restock Injera +50   →  adds 50 to current stock
    if (msg.text.match(/^\/restock(@\S+)?\s+\S/)) {
      const after = msg.text.replace(/^\/restock(@\S+)?\s+/, '').trim();
      const stockMatch = after.match(/^([\s\S]+?)\s+([+-]?\d+)\s*(?:pcs|kg|liters|units)?$/i);
      if (!stockMatch) {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: '❌ Usage: `/restock <product> <quantity>`\n\nExamples:\n• `/restock Injera 100` — set stock to 100\n• `/restock Injera +50` — add 50 to current stock',
          parse_mode: 'Markdown',
        });
        return;
      }
      const [, productQuery, rawQty] = stockMatch;
      const isRelative = rawQty.startsWith('+') || rawQty.startsWith('-');
      const delta = parseInt(rawQty, 10);
      if (!Number.isFinite(delta)) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ That doesn\'t look like a valid quantity.' });
        return;
      }
      try {
        const { data: products } = await supabase().from('products')
          .select('id, name, stock_quantity, currency').eq('business_id', business.id).eq('is_active', true);
        if (!products?.length) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: '❌ No products found. Add products in the Mini App first.' });
          return;
        }
        const q = productQuery.trim().toLowerCase();
        let match = products.find(p => p.name.toLowerCase() === q);
        if (!match) match = products.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
        if (!match) {
          const names = products.slice(0, 10).map(p => `• ${p.name} (${p.stock_quantity ?? '?'})`).join('\n');
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `❌ No product matched *"${productQuery}"*.\n\nCurrent stock:\n${names}`,
            parse_mode: 'Markdown',
          });
          return;
        }
        const oldQty = match.stock_quantity ?? 0;
        const newQty = isRelative ? Math.max(0, oldQty + delta) : Math.max(0, delta);
        await supabase().from('products').update({ stock_quantity: newQty }).eq('id', match.id);
        const changeLabel = isRelative
          ? (delta >= 0 ? `+${delta}` : `${delta}`)
          : `set to`;
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `✅ *${match.name}* — stock updated!\n\n${oldQty} → *${newQty}* units ${isRelative ? `(${changeLabel})` : `(${changeLabel} ${newQty})`}`,
          parse_mode: 'Markdown',
        });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    if (msg.text.startsWith('/advisor')) {
      const question = msg.text.replace(/^\/advisor(@\S+)?\s*/, '').trim();
      if (!question) {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: 'Ask the Advisor anything:\n\n`/advisor What should I focus on today?`\n`/advisor Which deals am I losing?`\n`/advisor ዛሬ ምን ማድረግ አለብኝ?`\n\n💡 Other commands:\n`/sales` — revenue today / week / month\n`/stock` — inventory levels\n`/rule use emojis often` — add a rule\n`/rules` — see all rules',
          parse_mode: 'Markdown',
        });
        return;
      }
      try {
        const { generateAdvisorResponse } = await import('./advisor');
        const { response, suggestedActions } = await generateAdvisorResponse(business.id, question);
        const keyboard = (suggestedActions || []).slice(0, 3).map(a => [{
          text: a.label,
          url: buildActionUrl(a, business),
        }]).filter(row => row[0].url);
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `🧠 *Advisor*\n\n${response}`,
          parse_mode: 'Markdown',
          ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
        });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Advisor error: ${e.message}` });
      }
      return;
    }

    // /sales — revenue summary (today / 7-day / 30-day)
    if (msg.text.match(/^\/sales(@\S+)?(\s|$)/)) {
      try {
        const { listOwnerSales } = await import('./ownerCommands');
        const text = await listOwnerSales(business.id);
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /stock — inventory levels with low-stock and out-of-stock highlights
    if (msg.text.match(/^\/stock(@\S+)?(\s|$)/)) {
      try {
        const { listOwnerStock } = await import('./ownerCommands');
        const text = await listOwnerStock(business.id);
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /orders — show pending orders + active jobs
    if (msg.text.startsWith('/orders')) {
      try {
        const { listOwnerOrders } = await import('./ownerCommands');
        const text = await listOwnerOrders(business.id);
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /customers — list customers with linked Telegram accounts
    if (msg.text.startsWith('/customers')) {
      try {
        const { listCustomersForOwner } = await import('./ownerCommands');
        const filter = msg.text.match(/^\/customers(?:@\S+)?\s+(\w+)/)?.[1];
        const text = await listCustomersForOwner(business, { filter });
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /reminders — list pending reminders
    if (msg.text.startsWith('/reminders')) {
      try {
        const { listReminders } = await import('./ownerCommands');
        const text = await listReminders(business.id);
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /team — list active team members with linked Telegram accounts
    if (msg.text.startsWith('/team')) {
      try {
        const { listTeamForOwner } = await import('./ownerCommands');
        const text = await listTeamForOwner(business);
        await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    // /dm <client> <message> — Alfred drafts and sends a DM to a client
    if (msg.text.startsWith('/dm')) {
      const after = msg.text.replace(/^\/dm(@\S+)?\s*/, '').trim();
      try {
        const { ownerDmClient } = await import('./ownerCommands');
        const reply = await ownerDmClient(token, business, after);
        await tg(token, 'sendMessage', { chat_id: chatId, text: reply, parse_mode: 'Markdown' });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
      }
      return;
    }

    } // end if (msg.text) text-command block

    // ── Owner sends a document (PDF / image-as-doc / text file) ──────────
    if (msg.document && !msg.forward_from && !msg.forward_sender_name) {
      await tg(token, 'sendMessage', { chat_id: chatId, text: '⏳ Reading your file…' });
      try {
        const { teachFromDocument } = await import('./teachFromMedia');
        const r = await teachFromDocument(token, business.id, msg);
        if (r.ok) {
          const src = r.source === 'pdf' ? `📄 PDF (${r.chunks} chunks saved)`
                    : r.source === 'image' ? '🖼️ Image described'
                    : '📝 Text file saved';
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `✅ *Learned!* ${src}\n\n_Preview:_ ${r.preview || ''}`,
            parse_mode: 'Markdown',
          });
        } else {
          await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't process file: ${r.error}` });
        }
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ File error: ${e.message}` });
      }
      return;
    }

    // ── Owner sends a voice / audio message → transcribe → teach ───────────
    if ((msg.voice || msg.audio || msg.video_note) && !msg.forward_from && !msg.forward_sender_name) {
      await tg(token, 'sendMessage', { chat_id: chatId, text: '🎙️ Transcribing your message…' });
      try {
        const { transcribeTelegramAudio } = await import('./transcription');
        const tr = await transcribeTelegramAudio(token, msg);
        if (!tr?.text) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: "⚠️ Couldn't transcribe the audio. Try typing it instead." });
          return;
        }
        const caption = (msg.caption || '').trim();
        const fullText = caption ? `${caption}\n\n${tr.text}` : tr.text;
        const { teachFromText } = await import('./teaching');
        await teachFromText(business.id, fullText);
        const viaBadge = tr.via === 'hasab' ? '🇪🇹 Hasab' : '🎙️ Whisper';
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: `✅ *Learned from voice!* (${viaBadge})\n\n_"${tr.text.slice(0, 180)}${tr.text.length > 180 ? '…' : ''}"_`,
          parse_mode: 'Markdown',
        });
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Voice error: ${e.message}` });
      }
      return;
    }

    // ── Owner sends a photo (not forwarded — forwarded photos handled above) ──
    if (msg.photo?.length && !msg.forward_from && !msg.forward_sender_name) {
      await tg(token, 'sendMessage', { chat_id: chatId, text: '⏳ Analyzing your photo…' });
      try {
        const { teachFromPhoto } = await import('./teachFromMedia');
        const r = await teachFromPhoto(token, business.id, msg);
        if (r.ok) {
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `✅ *Learned from photo!*\n\n_${r.preview || ''}_`,
            parse_mode: 'Markdown',
          });
        } else {
          await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't analyze photo: ${r.error}` });
        }
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Photo error: ${e.message}` });
      }
      return;
    }

    // Free-form owner message: URL → ingest first, otherwise route through controller
    if (msg.text && !msg.text.startsWith('/')) {

      // ── "Update your system / knowledge / learn from this" ────────────────
      // Catches: "update your system based on this", "learn from this",
      //          "update minime", "save this", "ስለዚህ ተማር", etc.
      const TEACH_PHRASE = /\b(update.{0,35}(system|knowledge|info|minime)|learn\s+(from\s+)?this|save\s+(this\s+to\s+)?(your\s+)?(knowledge|system|memory|info)|remember\s+this|add\s+this\s+to\s+(knowledge|system)|teach\s+(your|mini\s?me)\s*this|ስለዚህ\s*ተማር|አዘምን)\b/i;
      if (TEACH_PHRASE.test(msg.text)) {
        // If the owner replied to a previous message, learn from THAT message
        const replySource = msg.reply_to_message;
        if (replySource) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: '⏳ Learning from the replied message…' });
          try {
            // Replied-to document
            if (replySource.document) {
              const { teachFromDocument } = await import('./teachFromMedia');
              const r = await teachFromDocument(token, business.id, replySource);
              if (r.ok) {
                const src = r.source === 'pdf' ? `📄 PDF (${r.chunks} chunks)` : r.source === 'image' ? '🖼️ Image' : '📝 Text';
                await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned!* ${src}\n\n_${r.preview || ''}_`, parse_mode: 'Markdown' });
              } else {
                await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ ${r.error}` });
              }
            }
            // Replied-to photo
            else if (replySource.photo?.length) {
              const { teachFromPhoto } = await import('./teachFromMedia');
              const r = await teachFromPhoto(token, business.id, replySource);
              if (r.ok) await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned from photo!*\n\n_${r.preview || ''}_`, parse_mode: 'Markdown' });
              else await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ ${r.error}` });
            }
            // Replied-to voice/audio
            else if (replySource.voice || replySource.audio) {
              const { transcribeTelegramAudio } = await import('./transcription');
              const tr = await transcribeTelegramAudio(token, replySource);
              if (tr?.text) {
                const { teachFromText } = await import('./teaching');
                await teachFromText(business.id, tr.text);
                await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned from voice!*\n\n_"${tr.text.slice(0, 160)}"_`, parse_mode: 'Markdown' });
              } else {
                await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't transcribe that audio.` });
              }
            }
            // Replied-to text / URL
            else {
              const srcText = replySource.text || replySource.caption || '';
              if (!srcText) {
                await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ That message has no text content I can learn from.` });
              } else {
                const urlInReply = srcText.match(/https?:\/\/[^\s]+/);
                if (urlInReply) {
                  const url = urlInReply[0].replace(/[.,;!?)]+$/, '');
                  const { teachFromLink } = await import('./teachFromMedia');
                  const r = await teachFromLink(business.id, url);
                  if (r.ok) await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned from link!*\n\n📎 _${r.title || url}_ — ${r.chunks} chunks`, parse_mode: 'Markdown' });
                  else await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't read link: ${r.error}` });
                } else {
                  const { teachFromText } = await import('./teaching');
                  const r = await teachFromText(business.id, srcText);
                  const ex = r.extracted || {};
                  const summary = ex.summary ? `📝 ${ex.summary}` : `Saved: "${srcText.slice(0, 100)}…"`;
                  await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned!*\n\n${summary}`, parse_mode: 'Markdown' });
                }
              }
            }
          } catch (e) {
            await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Error learning from reply: ${e.message}` });
          }
        } else {
          // No reply — strip the command phrase and teach from the rest of the text
          const cleanText = msg.text.replace(TEACH_PHRASE, '').replace(/\s+based\s+on\s+this/i, '').replace(/\s+(from\s+)?this/i, '').trim();
          if (cleanText && cleanText.length > 5) {
            await tg(token, 'sendMessage', { chat_id: chatId, text: '⏳ Saving to knowledge…' });
            try {
              const { teachFromText } = await import('./teaching');
              const r = await teachFromText(business.id, cleanText);
              const ex = r.extracted || {};
              const summary = ex.summary ? `📝 ${ex.summary}` : `Saved: "${cleanText.slice(0, 100)}"`;
              await tg(token, 'sendMessage', { chat_id: chatId, text: `✅ *Learned!*\n\n${summary}`, parse_mode: 'Markdown' });
            } catch (e) {
              await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ ${e.message}` });
            }
          } else {
            // The phrase was the whole message — prompt for what to learn
            await tg(token, 'sendMessage', {
              chat_id: chatId,
              text: '👋 Ready to learn! You can:\n\n• *Reply* to any message + say "learn this"\n• Send a PDF, photo, voice note, or link\n• Type `/teach <info>` to save text',
              parse_mode: 'Markdown',
            });
          }
        }
        return;
      }

      // Detect a URL — ingest it into the knowledge base
      const urlMatch = msg.text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        const url = urlMatch[0].replace(/[.,;!?)]+$/, ''); // strip trailing punctuation
        await tg(token, 'sendMessage', { chat_id: chatId, text: `⏳ Reading ${url} …` });
        try {
          const { teachFromLink } = await import('./teachFromMedia');
          const r = await teachFromLink(business.id, url);
          if (r.ok) {
            await tg(token, 'sendMessage', {
              chat_id: chatId,
              text: `✅ *Learned from link!*\n\n📎 _${r.title || url}_ — ${r.chunks} chunks saved`,
              parse_mode: 'Markdown',
            });
          } else {
            await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Couldn't read that link: ${r.error}\n\nTry \`/teach\` + pasting the key info manually.`, parse_mode: 'Markdown' });
          }
        } catch (e) {
          await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ Link error: ${e.message}` });
        }
        return;
      }

      try {
        const { handleOwnerPrompt } = await import('./ownerCommands');
        const out = await handleOwnerPrompt({ token, business, chatId, ownerText: msg.text });
        if (out?.replied) return;
      } catch (e) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: `Error: ${e.message}` });
        return;
      }
      // Fallback help
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Hi! Try one of these:\n\n• `/orders` — pending orders & jobs\n• `/sales` — revenue summary (today / week / month)\n• `/stock` — inventory levels\n• `/price <product> <price>` — update a product\'s price\n• `/restock <product> <qty>` — update stock (use +50 to add)\n• `/customers` — your client list\n• `/dm <name> <message>` — message a client\n• `/advisor <question>` — ask MiniMe anything\n• `/teach <description>` — teach me about your shop\n• `/rule <text>` — add a behavior rule\n• `/knowledge` — see what I\'ve learned (+ delete)\n• `/forget <title>` — delete a knowledge item\n\n🎓 *Teach me by sending:*\n• 🎙️ Voice note → I\'ll transcribe & learn (Amharic or English)\n• 📄 PDF → I\'ll read it\n• 🖼️ Photo → I\'ll describe what I see\n• 🔗 URL → I\'ll scrape the page\n• ✍️ Plain text → I\'ll save it directly\n\n💡 *Or forward anything* + I\'ll learn from it.\n_Reply to any message and say "learn this" to teach from it._',
        parse_mode: 'Markdown',
      });
      return;
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

  // ── Customer-side commands: /start, /help, /menu ──
  // Short, warm opener + ONE question. The brain handles the actual conversation
  // from the next message onward.
  if (msg.text && /^\/(start|help|menu)\b/i.test(msg.text)) {
    await saveMessage({
      conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
      direction: 'inbound', content: msg.text, content_type: 'text',
      telegram_message_id: messageId, telegram_chat_id: chatId,
    });
    const firstName = msg.from?.first_name ? msg.from.first_name : '';
    const reply = firstName
      ? `Hey ${firstName}! 👋 Welcome to ${business.name}. What are you working on — anything I can help with today?`
      : `Hey! 👋 Welcome to ${business.name}. What are you working on — anything I can help with today?`;
    await tg(token, 'sendMessage', {
      chat_id: chatId, text: reply,
      reply_to_message_id: messageId,
    });
    await saveMessage({
      conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
      direction: 'outbound', content: reply, content_type: 'text', status: 'sent',
      is_ai_generated: true, ai_model: 'help-command',
      telegram_chat_id: chatId, sent_at: new Date().toISOString(),
    });
    return;
  }

  // Capture the Telegram file_id so the Agent can forward attachments later.
  let fileId = null, fileType = null, fileName = null, fileMime = null;
  if (msg.photo?.length) {
    fileId = msg.photo[msg.photo.length - 1].file_id;   // largest size
    fileType = 'photo';
    fileMime = 'image/jpeg';
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = 'document';
    fileName = msg.document.file_name || null;
    fileMime = msg.document.mime_type || 'application/octet-stream';
  } else if (msg.voice) {
    fileId = msg.voice.file_id; fileType = 'voice';
    fileMime = 'audio/ogg';
  } else if (msg.video || msg.video_note) {
    fileId = (msg.video || msg.video_note).file_id; fileType = 'video';
    fileMime = 'video/mp4';
  }

  // Persist media to Supabase Storage so the Mini App can display it (Telegram URLs expire)
  let mediaUrl = null;
  if (fileId) {
    try {
      const fileRes = await tg(token, 'getFile', { file_id: fileId });
      if (fileRes?.ok && fileRes.result?.file_path) {
        const tgUrl = `https://api.telegram.org/file/bot${token}/${fileRes.result.file_path}`;
        const resp = await fetch(tgUrl, { signal: AbortSignal.timeout(30000) });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          const ext = (fileRes.result.file_path.split('.').pop() || 'bin').toLowerCase();
          const storagePath = `media/${business.id}/${Date.now()}-${fileId.slice(-8)}.${ext}`;
          const sb = supabase();
          await sb.storage.from('documents').upload(storagePath, buf, {
            contentType: fileMime || 'application/octet-stream',
            upsert: true,
          });
          const { data: urlData } = sb.storage.from('documents').getPublicUrl(storagePath);
          mediaUrl = urlData?.publicUrl || null;
        }
      }
    } catch (e) { console.warn('media persist:', e.message); }
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
    media_url: mediaUrl,
  });

  // Forward files (photos, documents, voice) to owner so they see them immediately
  if (fileId) {
    await forwardMessageToOwner(token, business, chatId, messageId);
  }

  if (business.panic_mode) return;

  // ── Subscription gate ──
  // Free-tier businesses are always allowed. Paid tiers must have an active or
  // unexpired trial subscription; expired/cancelled ones get a polite notice and
  // the owner gets a reminder to renew.
  const plan = business.plan_tier || business.subscription_plan || 'free';
  if (plan !== 'free') {
    const status = business.subscription_status || 'trial';
    const trialOver = status === 'trial' && business.trial_ends_at && new Date(business.trial_ends_at) < new Date();
    const subExpired = status === 'expired' || status === 'cancelled';
    const subExpiresAt = business.subscription_expires_at;
    const subscriptionExpired = subExpired || (subExpiresAt && new Date(subExpiresAt) < new Date());
    if (trialOver || subscriptionExpired) {
      const paused = "⚠️ This service is temporarily paused. Please contact the business for updates.";
      await tg(token, 'sendMessage', { chat_id: chatId, text: paused });
      // Nudge the owner once per day at most (check last_subscription_nudge in business meta)
      const meta = business.meta || {};
      const lastNudge = meta.last_subscription_nudge ? new Date(meta.last_subscription_nudge) : null;
      const nudgeAge = lastNudge ? Date.now() - lastNudge.getTime() : Infinity;
      if (nudgeAge > 86400000 && business.owner_telegram_id) {
        await tg(token, 'sendMessage', {
          chat_id: ownerChatId(business),
          text: `⚠️ *MiniMe is paused* — your subscription (${plan}) has ${trialOver ? 'trial expired' : status}.\n\nYour customers are seeing a "service paused" message. Renew in the admin panel to resume.`,
          parse_mode: 'Markdown',
        });
        await supabase().from('businesses').update({ meta: { ...meta, last_subscription_nudge: new Date().toISOString() } }).eq('id', business.id);
      }
      return;
    }
  }

  // ── Pending feedback text capture ──
  // If a feedback prompt was sent and the customer's first reply lands here,
  // save the text as a follow-up to their rating, then resume normal brain flow.
  if (conversation.metadata?.pending_feedback && msg.text && msg.text.length > 1) {
    const fb = conversation.metadata.pending_feedback;
    const sb2 = supabase();
    await sb2.from('customer_memory').insert({
      business_id: business.id,
      customer_id: customer.id,
      kind: 'feedback',
      content: `Feedback on order ${fb.order_id?.slice(0, 8)} (${fb.rating}/5): ${msg.text.slice(0, 400)}`,
      source: 'feedback',
    });
    const newMeta = { ...conversation.metadata };
    delete newMeta.pending_feedback;
    await sb2.from('conversations').update({ metadata: newMeta }).eq('id', conversation.id);
    if (ownerChatId(business)) {
      await tg(token, 'sendMessage', {
        chat_id: ownerChatId(business),
        text: `💬 *${customer.name || 'Customer'}* added feedback (${fb.rating}/5):\n\n_"${msg.text.slice(0, 400)}"_`,
        parse_mode: 'Markdown',
      });
    }
    await tg(token, 'sendMessage', { chat_id: chatId, text: 'Thank you! 🙏' });
    return;
  }

  // ── DND / quiet hours ──
  // notification_prefs.dnd = { enabled, start_hour, end_hour, mode, message }
  const dnd = business.notification_prefs?.dnd;
  if (dnd?.enabled && isInQuietHours(dnd)) {
    if (dnd.mode === 'silent') {
      await touchConversation(conversation.id, 'quiet_hours_skipped');
      return;
    }
    // auto_reply: send the configured message and stop. Owner will follow up.
    const text = dnd.message || "We're closed right now — I've got your message and we'll reply in the morning. 🌙";
    await tg(token, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: messageId });
    await saveMessage({
      conversation_id: conversation.id, business_id: business.id, customer_id: customer.id,
      direction: 'outbound', content: text, content_type: 'text', status: 'sent',
      is_ai_generated: true, ai_model: 'dnd-auto-reply',
      telegram_chat_id: chatId, sent_at: new Date().toISOString(),
    });
    await touchConversation(conversation.id, 'quiet_hours_replied');
    return;
  }

  // 2. Scam shield
  const scan = scanForScam(msg.text);
  if (scan.isScam) {
    await notifyOwnerScamAlert(token, business, customer, msg.text, scan);
    await touchConversation(conversation.id, 'scam_flagged');
    await supabase().from('conversations').update({ requires_owner: true }).eq('id', conversation.id);
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
      is_ai_generated: true, ai_model: MODEL,
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
    direction: 'outbound', content: draft, content_type: 'text', status: 'drafted',
    is_ai_generated: true, ai_model: MODEL,
    telegram_chat_id: chatId, telegram_message_id: messageId,
    confidence,
  });
  if (saved?.id) {
    await notifyOwnerDraft(token, business, customer, msg.text, draft, confidence, saved.id, intent, null, conversation.id);
  }
  await touchConversation(conversation.id, 'drafted');
  // Flag conversation so the home feed and ConversationsPage show it as pending
  await supabase().from('conversations').update({ requires_owner: true }).eq('id', conversation.id);
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
      const now = new Date().toISOString();
      await sb.from('messages').update({
        status: 'sent', approved_at: now, sent_at: now, owner_edited: false,
      }).eq('id', id);
      await sb.from('conversations').update({
        requires_owner: false, last_ai_action: 'approved', last_message_at: now,
      }).eq('id', m.conversation_id);
      // If this was a low-confidence draft, the approve implies 👍 feedback
      if ((m.confidence ?? 1) < 0.55) {
        try {
          await sb.from('feedback').insert({
            business_id: business.id, source: 'low_confidence_draft',
            target_id: id, helpful: true,
          });
        } catch (e) { console.warn('implicit fb on approve:', e.message); }
      }
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
      const { data: skipMsg } = await sb.from('messages').select('conversation_id').eq('id', id).maybeSingle();
      await sb.from('messages').update({ status: 'skipped' }).eq('id', id);
      if (skipMsg?.conversation_id) {
        await sb.from('conversations').update({
          requires_owner: false, last_ai_action: 'skipped',
        }).eq('id', skipMsg.conversation_id);
      }
      await editMsg(token, chatId, msgId, '⏭️ Skipped. Reply manually if needed.');
      return answerCbq(token, q.id, 'Skipped');
    }

    // ── Pay with Telegram Stars: send invoice ──
    if (data.startsWith('pay_stars_')) {
      const orderId = data.slice('pay_stars_'.length);
      const { data: order } = await sb.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Order not found');
      const pmts = business.notification_prefs?.payments || {};
      const starsAmount = Math.max(1, Math.round(Number(order.total) * (pmts.stars_per_etb || 1)));
      try {
        await tg(token, 'sendInvoice', {
          chat_id: chatId,
          title: `${business.name} — Order ${order.id.slice(0, 8)}`,
          description: (Array.isArray(order.items) ? order.items.map(it => `${it.quantity}× ${it.name}`).join(', ') : 'Order').slice(0, 250),
          payload: `order:${order.id}`,
          provider_token: '', // empty = Telegram Stars
          currency: 'XTR',
          prices: [{ label: 'Total', amount: starsAmount }],
        });
        return answerCbq(token, q.id, 'Opening Stars payment…');
      } catch (e) {
        return answerCbq(token, q.id, `❌ ${e.message}`);
      }
    }

    // ── Pay with CBE manual transfer ──
    if (data.startsWith('pay_cbe_')) {
      const orderId = data.slice('pay_cbe_'.length);
      const { data: order } = await sb.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Order not found');
      const pmts = business.notification_prefs?.payments || {};
      if (!pmts.cbe_account) return answerCbq(token, q.id, 'CBE not configured');
      const ref = (order.id.slice(0, 8) || 'NOREF').toUpperCase();
      const lines = [
        `🏦 *CBE Bank Transfer*`,
        ``,
        `*Account:* \`${pmts.cbe_account}\``,
        `*Name:* ${pmts.cbe_name || business.name}`,
        ...(pmts.cbe_phone ? [`*Phone:* ${pmts.cbe_phone}`] : []),
        ``,
        `*Amount:* ${Number(order.total).toLocaleString()} ${order.currency || 'ETB'}`,
        `*Reference:* \`${ref}\``,
        ``,
        `_After transferring, send a screenshot here and we'll confirm._`,
      ];
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "✓ I've sent it", callback_data: `cbe_sent_${order.id}` }]] },
      });
      // Save the reference on the order
      await sb.from('orders').update({ chapa_tx_ref: order.chapa_tx_ref || `CBE-${ref}`, payment_method: 'cbe_manual' }).eq('id', order.id);
      return answerCbq(token, q.id, '🏦 Transfer details sent');
    }

    // ── Customer claims they paid via CBE — notify owner to confirm ──
    if (data.startsWith('cbe_sent_')) {
      const orderId = data.slice('cbe_sent_'.length);
      const { data: order } = await sb.from('orders').select('*, customers(name, telegram_username, telegram_id)').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Not found');
      await editMsg(token, chatId, msgId, '⏳ Got it — waiting for the owner to confirm. We\'ll message you as soon as it\'s verified.');
      // Notify owner with confirm/reject buttons
      if (ownerChatId(business)) {
        const cust = order.customers;
        await tg(token, 'sendMessage', {
          chat_id: ownerChatId(business),
          text: `🏦 *CBE payment claimed*\n\n${cust?.name || 'Customer'}${cust?.telegram_username ? ' @' + cust.telegram_username : ''} says they sent ${Number(order.total).toLocaleString()} ${order.currency || 'ETB'} — ref \`${(order.id.slice(0, 8)).toUpperCase()}\`.\n\nCheck your CBE app, then confirm:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✓ Confirm received', callback_data: `cbe_confirm_${order.id}` },
              { text: '✗ Not yet', callback_data: `cbe_reject_${order.id}` },
            ]],
          },
        });
      }
      return answerCbq(token, q.id, '⏳ Sent to owner');
    }

    if (data.startsWith('cbe_confirm_')) {
      const orderId = data.slice('cbe_confirm_'.length);
      const { data: order } = await sb.from('orders').select('*, customers(telegram_id)').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Not found');
      await sb.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', orderId);
      // Deduct stock for each item in the order
      for (const item of order.items || []) {
        if (item.product_id) {
          try { await decrementProductStock(item.product_id, item.quantity || 0); }
          catch (e) { console.warn('stock deduct (cbe):', e.message); }
        }
      }
      await editMsg(token, chatId, msgId, `✅ Payment confirmed — ${Number(order.total).toLocaleString()} ${order.currency} (CBE)`);
      if (order.customers?.telegram_id) {
        await tg(token, 'sendMessage', { chat_id: order.customers.telegram_id, text: '✅ Payment received — thank you! We\'re getting your order ready.' });
      }
      return answerCbq(token, q.id, '✅ Confirmed');
    }
    if (data.startsWith('cbe_reject_')) {
      const orderId = data.slice('cbe_reject_'.length);
      const { data: order } = await sb.from('orders').select('customers(telegram_id)').eq('id', orderId).maybeSingle();
      await editMsg(token, chatId, msgId, '⚠️ Marked not yet received.');
      if (order?.customers?.telegram_id) {
        await tg(token, 'sendMessage', { chat_id: order.customers.telegram_id, text: '⚠️ We haven\'t seen the transfer in our CBE account yet. Could you double-check or send a screenshot?' });
      }
      return answerCbq(token, q.id, 'Marked unverified');
    }

    // ── Order fulfillment / refund (from the Chapa-paid DM) ──
    if (data.startsWith('order_fulfill_')) {
      const orderId = data.slice('order_fulfill_'.length);
      const { data: order } = await sb.from('orders').select('*, customers(*)').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌ Not found');
      await sb.from('orders').update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }).eq('id', orderId);
      await editMsg(token, chatId, msgId, `✅ Order fulfilled — ${order.total} ${order.currency} · ${order.customers?.name || 'customer'}`);
      if (order.customers?.telegram_id) {
        const receipt = formatReceipt({ business, order: { ...order, status: 'fulfilled', fulfilled_at: new Date().toISOString() } });
        await tg(token, 'sendMessage', {
          chat_id: order.customers.telegram_id,
          text: receipt,
          parse_mode: 'Markdown',
        });
        // Feedback request — inline 5-star keyboard
        await tg(token, 'sendMessage', {
          chat_id: order.customers.telegram_id,
          text: `How was your experience with ${business.name}?`,
          reply_markup: {
            inline_keyboard: [[
              { text: '⭐', callback_data: `fb_${orderId}_1` },
              { text: '⭐⭐', callback_data: `fb_${orderId}_2` },
              { text: '⭐⭐⭐', callback_data: `fb_${orderId}_3` },
              { text: '⭐⭐⭐⭐', callback_data: `fb_${orderId}_4` },
              { text: '⭐⭐⭐⭐⭐', callback_data: `fb_${orderId}_5` },
            ]],
          },
        });
      }
      return answerCbq(token, q.id, '✅ Fulfilled');
    }

    // ── Feedback rating tap (star ratings on orders) ──
    if (data.startsWith('fb_') && !data.startsWith('fb_yes_') && !data.startsWith('fb_no_')) {
      const m = data.match(/^fb_([0-9a-f-]{8,})_([1-5])$/);
      if (!m) return answerCbq(token, q.id, '');
      const orderId = m[1];
      const rating = Number(m[2]);
      const { data: order } = await sb.from('orders').select('id, business_id, customer_id, customers(name)').eq('id', orderId).maybeSingle();
      if (!order) return answerCbq(token, q.id, '❌');
      // Save rating as a customer_memory fact + notify owner
      await sb.from('customer_memory').insert({
        business_id: order.business_id,
        customer_id: order.customer_id,
        kind: 'feedback',
        content: `Rated order ${orderId.slice(0, 8)}: ${rating}/5 stars`,
        source: 'feedback',
      });
      await editMsg(token, chatId, msgId, `${'⭐'.repeat(rating)} Thank you! Anything you'd like to add? Just type a reply.`);
      // Mark conversation pending-feedback so the next inbound is captured as feedback text
      const { data: conv } = await sb.from('conversations').select('id, metadata').eq('business_id', order.business_id).eq('customer_id', order.customer_id).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
      if (conv) {
        const newMeta = { ...(conv.metadata || {}), pending_feedback: { order_id: orderId, rating, at: new Date().toISOString() } };
        await sb.from('conversations').update({ metadata: newMeta }).eq('id', conv.id);
      }
      // Notify owner
      if (ownerChatId(business)) {
        await tg(token, 'sendMessage', {
          chat_id: ownerChatId(business),
          text: `${'⭐'.repeat(rating)} *${order.customers?.name || 'A customer'}* rated their order ${rating}/5.`,
          parse_mode: 'Markdown',
        });
      }
      return answerCbq(token, q.id, `Saved ${rating}/5`);
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
        model: MODEL, temperature: 0.6, max_tokens: 300,
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

    // ── noop (cancel button) ──
    if (data === 'noop') {
      try { await tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }); } catch {}
      return answerCbq(token, q.id, 'Cancelled');
    }

    // ── Delete a knowledge document ──
    if (data.startsWith('del_doc_')) {
      const docId = data.slice(8);
      try {
        const { data: doc } = await sb.from('documents').select('id, title, business_id').eq('id', docId).maybeSingle();
        if (!doc || doc.business_id !== business.id) return answerCbq(token, q.id, '❌ Not found');
        // Delete chunks first (FK), then the doc
        await sb.from('document_chunks').delete().eq('document_id', docId);
        await sb.from('documents').delete().eq('id', docId);
        try {
          await editMsg(token, chatId, msgId, `🗑️ *Deleted:* _${doc.title || 'Untitled'}_\n\nMiniMe will no longer use this knowledge.`);
        } catch {}
        return answerCbq(token, q.id, '🗑️ Deleted');
      } catch (e) {
        return answerCbq(token, q.id, `❌ ${e.message}`);
      }
    }

    // ── "Did that help?" feedback (👍/👎) ──
    // Callback shape: fb_yes_<source>_<targetId>  or  fb_no_<source>_<targetId>
    if (data.startsWith('fb_yes_') || data.startsWith('fb_no_')) {
      const helpful = data.startsWith('fb_yes_');
      const rest = data.slice(helpful ? 7 : 6); // strip prefix
      // source is the segment up to the next _, the rest is targetId
      const us = rest.indexOf('_');
      const source = us >= 0 ? rest.slice(0, us) : 'agent_action';
      const targetId = us >= 0 ? rest.slice(us + 1) : null;
      const sourceMap = { agent: 'agent_action', advisor: 'advisor_reply', draft: 'low_confidence_draft' };
      const fbSource = sourceMap[source] || 'agent_action';
      try {
        await sb.from('feedback').insert({
          business_id: business.id,
          source: fbSource,
          target_id: targetId || null,
          helpful,
        });
      } catch (e) { console.warn('feedback insert:', e.message); }
      // Mark the message text to show that we recorded it (best-effort)
      try {
        const newText = `${q.message.text || ''}\n\n${helpful ? '👍 You marked this helpful — thanks!' : '👎 Noted. I\'ll learn from this.'}`;
        await editMsg(token, chatId, msgId, newText);
      } catch {}
      return answerCbq(token, q.id, helpful ? 'Thanks 🙏' : 'Noted — I\'ll learn');
    }

    return answerCbq(token, q.id, '');
  } catch (e) {
    console.error('dispatchCallback:', e);
    return answerCbq(token, q.id, '❌ Error');
  }
}
