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
import { transcribeTelegramAudio, describeTelegramPhoto } from './transcription';
import { retrieveRelevantChunks, matchDocumentByIntent, downloadDocument, looksLikeDocumentRequest } from './knowledge';
import { detectIntent } from './intent';
import { handleSupplierReply } from './supplierReply';
import { notifyOwnerDraft, notifyOwnerAutoSent, notifyOwnerScamAlert } from './notification';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ───────────────────────────── Telegram HTTP ─────────────────────────────
async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j?.ok) console.warn(`tg ${method}:`, j?.description);
  return j;
}

/** multipart sendDocument — used for auto-sending PDFs/files from the knowledge base. */
async function tgSendDocument(token, chatId, buffer, filename, caption) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('document', new Blob([buffer]), filename);
  if (caption) fd.append('caption', caption);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: fd,
  });
  return r.json();
}

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
  const productLines = products.slice(0, 20).map(p =>
    `  - ${p.name}${p.selling_price ? ` (${p.selling_price} ${p.currency || 'ETB'})` : ''}${p.stock_quantity != null ? ` · stock: ${p.stock_quantity}` : ''}${p.description ? ` — ${p.description.slice(0, 80)}` : ''}`
  ).join('\n');

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

  return `You are a warm, concise customer-service assistant for "${business.name}"${business.category ? ` (${business.category})` : ''}${business.location ? `, based in ${business.location}` : ''}.
You reply to customers in the SAME language they write in (Amharic or English or mix).

Personality: friendly, helpful, fast. Keep replies to 1–3 short lines unless more detail is asked for. Never sound robotic. Use natural contractions. Sprinkle light warmth (e.g. "እሺ", "sure"), not emoji storms.

What you can answer:
- Product availability, prices, descriptions (ALWAYS quote the exact catalog price when asked "how much", "ስንት", "ዋጋ" — never dodge a price question)
- Store hours / location / address
- Contact info, social media links, portfolio, website — share them when asked
- General help
- Politely take orders (the system will handle payment separately)

${products.length
  ? `PRODUCT CATALOG (these are authoritative prices — quote them exactly):\n${productLines}`
  : 'CATALOG: (empty — explain that products are being added and offer to pass the query to the owner.)'}${contactBlock}${voiceBlock}

RULES:
- When asked a price, answer with the number from the catalog. Do NOT say "please check with the owner" if the product is in the catalog.
- When asked for contact / socials / portfolio / website / WhatsApp / Instagram / TikTok, share the links from the CONTACT block above exactly as written. If a specific channel isn't listed, say so and offer what IS listed.
- If you're not sure, say so rather than inventing. If the customer asks something only the owner can answer (custom pricing, complaints, special requests), say you'll let ${business.owner_name || 'the owner'} know.`;
}

async function draftReply(business, customer, conversation, incomingText) {
  const [products, recent, mem, chunks] = await Promise.all([
    getProducts(business.id),
    getRecentMessages(conversation.id, 8),
    listCustomerMemory(customer.id, 10),
    retrieveRelevantChunks(incomingText, business.id, { count: 4, threshold: 0.3 }),
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
    systemPrompt += '\n\n## KNOWLEDGE BASE (owner-uploaded docs — use as truth, paraphrase in your voice):\n' +
      chunks.map((c, i) => `[KB-${i + 1}] ${c.content.slice(0, 600)}`).join('\n---\n');
  }
  if (mem.length) {
    systemPrompt += '\n\n## WHAT YOU REMEMBER ABOUT THIS CUSTOMER:\n' +
      mem.map(m => `- (${m.kind}) ${m.content}`).join('\n');
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.78,
      max_tokens: 350,
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
    price: Number(p.selling_price ?? 0),
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

  // 1. Voice / photo → transcribe into msg.text
  if (!msg.text) {
    if (msg.voice || msg.audio || msg.video_note) {
      const tr = await transcribeTelegramAudio(token, msg);
      if (tr?.text) msg.text = `[voice] ${tr.text}`;
    } else if (msg.photo) {
      const desc = await describeTelegramPhoto(token, msg);
      if (desc) msg.text = `[photo] ${desc}${msg.caption ? `\nCaption: ${msg.caption}` : ''}`;
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

  await saveMessage({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'inbound',
    content: msg.text,
    content_type: msg.voice || msg.audio || msg.video_note ? 'voice'
      : msg.photo ? 'photo' : 'text',
    telegram_message_id: messageId,
    telegram_chat_id: chatId,
  });

  if (business.panic_mode) return;

  // 2. Scam shield
  const scan = scanForScam(msg.text);
  if (scan.isScam) {
    await notifyOwnerScamAlert(token, business, customer, msg.text, scan);
    await touchConversation(conversation.id, 'scam_flagged');
    return; // never auto-reply to scams
  }

  // Checkout short-circuit (orders handle their own flow)
  try {
    const handled = await tryCheckout(token, business, customer, conversation, msg.text, chatId, messageId);
    if (handled) { await touchConversation(conversation.id, 'order_created'); return; }
  } catch (e) { console.warn('checkout skipped:', e.message); }

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
