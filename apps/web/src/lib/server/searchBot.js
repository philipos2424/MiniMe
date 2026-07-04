/**
 * MiniMe Search Bot — natural language business directory search.
 *
 * Handles messages from @MiniMeSearchBot (a single public bot, not per-tenant).
 * Any customer can search for businesses on the MiniMe network.
 *
 * Flow: keyword cache / GPT parse → clarifying buttons → match businesses → results
 */
import { makeOpenAI } from './openaiClient';
import { supabase } from './db';
import { loggedCompletion } from './openai-wrapper';
import { rateLimit } from './rateLimit';
import { MODEL_MINI, EMBED_MODEL } from './constants';

// trim(): the Vercel-stored value carries a trailing newline — untrimmed it
// breaks web_app button URLs (Telegram rejects them).
const MINIAPP_BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');

let _embedClient;
function embedClient() {
  if (!_embedClient) _embedClient = makeOpenAI();
  return _embedClient;
}

// ── Module-scope state (in-memory, per-instance) ───────────────────────────
/** Track non-search message streak per user → chatter blocking */
const chatterStreaks = new Map();
/** Pending clarification flows: chatId → { text, parsed, senderId, usedGPT, searchLogId, step } */
const pendingClarifications = new Map();
/** Pending review comment: chatId → { businessId, rating } */
const pendingReviews = new Map();
/** Result cache: cacheKey → { results, timestamp } */
const resultCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Cleanup stale cache entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of resultCache.entries()) {
    if (now - v.timestamp > CACHE_TTL) resultCache.delete(k);
  }
}, 15 * 60 * 1000);

// ── Keyword-to-category cache ──────────────────────────────────────────────
// Routes simple single-word queries directly to a category — skips GPT (~70% of searches).
const KEYWORD_CACHE = {
  // Electronics & Phones
  'laptop':       { category: 'electronics_phones', keywords: ['laptop'] },
  'laptops':      { category: 'electronics_phones', keywords: ['laptop'] },
  'phone':        { category: 'electronics_phones', keywords: ['phone'] },
  'phones':       { category: 'electronics_phones', keywords: ['phone'] },
  'mobile':       { category: 'electronics_phones', keywords: ['mobile'] },
  'smartphone':   { category: 'electronics_phones', keywords: ['smartphone'] },
  'computer':     { category: 'electronics_phones', keywords: ['computer'] },
  'pc':           { category: 'electronics_phones', keywords: ['computer'] },
  'tablet':       { category: 'electronics_phones', keywords: ['tablet'] },
  'iphone':       { category: 'electronics_phones', keywords: ['iphone'] },
  'samsung':      { category: 'electronics_phones', keywords: ['samsung'] },
  'nfc':          { category: 'electronics_phones', keywords: ['nfc'] },
  'accessory':    { category: 'electronics_phones', keywords: ['accessory'] },
  'accessories':  { category: 'electronics_phones', keywords: ['accessory'] },
  'charger':      { category: 'electronics_phones', keywords: ['charger'] },
  // Printing & Signage
  'print':        { category: 'printing_signage', keywords: ['print'] },
  'printing':     { category: 'printing_signage', keywords: ['printing'] },
  'printer':      { category: 'printing_signage', keywords: ['printer'] },
  'banner':       { category: 'printing_signage', keywords: ['banner'] },
  'banners':      { category: 'printing_signage', keywords: ['banner'] },
  'flyer':        { category: 'printing_signage', keywords: ['flyer'] },
  'flyers':       { category: 'printing_signage', keywords: ['flyer'] },
  'sticker':      { category: 'printing_signage', keywords: ['sticker'] },
  'stickers':     { category: 'printing_signage', keywords: ['sticker'] },
  'signage':      { category: 'printing_signage', keywords: ['signage'] },
  'billboard':    { category: 'printing_signage', keywords: ['billboard'] },
  // Branding & Design
  'logo':         { category: 'branding_design', keywords: ['logo'] },
  'logos':        { category: 'branding_design', keywords: ['logo'] },
  'branding':     { category: 'branding_design', keywords: ['branding'] },
  'brand':        { category: 'branding_design', keywords: ['brand'] },
  'design':       { category: 'branding_design', keywords: ['design'] },
  'designer':     { category: 'branding_design', keywords: ['design'] },
  'graphic':      { category: 'branding_design', keywords: ['graphic'] },
  // Restaurants & Cafes
  'restaurant':   { category: 'food_beverage', keywords: ['restaurant'] },
  'cafe':         { category: 'food_beverage', keywords: ['cafe'] },
  'coffee':       { category: 'food_beverage', keywords: ['coffee'] },
  'cake':         { category: 'food_beverage', keywords: ['cake'] },
  'juice':        { category: 'food_beverage', keywords: ['juice'] },
  'pastry':       { category: 'food_beverage', keywords: ['pastry'] },
  'bakery':       { category: 'food_beverage', keywords: ['bakery'] },
  // Catering & Food
  'catering':     { category: 'catering_food', keywords: ['catering'] },
  'cater':        { category: 'catering_food', keywords: ['catering'] },
  'injera':       { category: 'catering_food', keywords: ['injera'] },
  'buffet':       { category: 'catering_food', keywords: ['buffet'] },
  // Photography & Video
  'photographer': { category: 'photography_video', keywords: ['photographer'] },
  'photography':  { category: 'photography_video', keywords: ['photography'] },
  'photo':        { category: 'photography_video', keywords: ['photo'] },
  'video':        { category: 'photography_video', keywords: ['video'] },
  'videography':  { category: 'photography_video', keywords: ['video'] },
  'studio':       { category: 'photography_video', keywords: ['studio'] },
  // Clothing & Fashion
  'clothing':     { category: 'clothing_fashion', keywords: ['clothing'] },
  'fashion':      { category: 'clothing_fashion', keywords: ['fashion'] },
  'dress':        { category: 'clothing_fashion', keywords: ['dress'] },
  'uniform':      { category: 'clothing_fashion', keywords: ['uniform'] },
  'tailoring':    { category: 'clothing_fashion', keywords: ['tailoring'] },
  'tailor':       { category: 'clothing_fashion', keywords: ['tailor'] },
  'habesha':      { category: 'clothing_fashion', keywords: ['habesha'] },
  // Beauty & Wellness
  'salon':        { category: 'beauty_wellness', keywords: ['salon'] },
  'spa':          { category: 'beauty_wellness', keywords: ['spa'] },
  'beauty':       { category: 'beauty_wellness', keywords: ['beauty'] },
  'makeup':       { category: 'beauty_wellness', keywords: ['makeup'] },
  'hair':         { category: 'beauty_wellness', keywords: ['hair'] },
  'nails':        { category: 'beauty_wellness', keywords: ['nails'] },
  'barber':       { category: 'beauty_wellness', keywords: ['barber'] },
  // Construction & Interior
  'construction': { category: 'construction_interior', keywords: ['construction'] },
  'furniture':    { category: 'construction_interior', keywords: ['furniture'] },
  'renovation':   { category: 'construction_interior', keywords: ['renovation'] },
  'interior':     { category: 'construction_interior', keywords: ['interior'] },
  'contractor':   { category: 'construction_interior', keywords: ['contractor'] },
  'plumber':      { category: 'construction_interior', keywords: ['plumber'] },
  'electrician':  { category: 'construction_interior', keywords: ['electrician'] },
  // Transport & Delivery
  'delivery':     { category: 'transport_delivery', keywords: ['delivery'] },
  'courier':      { category: 'transport_delivery', keywords: ['courier'] },
  'moving':       { category: 'transport_delivery', keywords: ['moving'] },
  'transport':    { category: 'transport_delivery', keywords: ['transport'] },
  'shipping':     { category: 'transport_delivery', keywords: ['shipping'] },
  'logistics':    { category: 'transport_delivery', keywords: ['logistics'] },
  // Events & Entertainment
  'dj':           { category: 'events_entertainment', keywords: ['dj'] },
  'event':        { category: 'events_entertainment', keywords: ['event'] },
  'events':       { category: 'events_entertainment', keywords: ['event'] },
  'wedding':      { category: 'events_entertainment', keywords: ['wedding'] },
  'decoration':   { category: 'events_entertainment', keywords: ['decoration'] },
  'flowers':      { category: 'events_entertainment', keywords: ['flowers'] },
  'florist':      { category: 'events_entertainment', keywords: ['florist'] },
  'tent':         { category: 'events_entertainment', keywords: ['tent'] },
  // Training & Consulting
  'training':     { category: 'training_consulting', keywords: ['training'] },
  'consulting':   { category: 'training_consulting', keywords: ['consulting'] },
  'coaching':     { category: 'training_consulting', keywords: ['coaching'] },
  'tutor':        { category: 'training_consulting', keywords: ['tutor'] },
  'tutoring':     { category: 'training_consulting', keywords: ['tutoring'] },
  // Wholesale & Supply
  'wholesale':    { category: 'wholesale_supply', keywords: ['wholesale'] },
  'supply':       { category: 'wholesale_supply', keywords: ['supply'] },
  'supplier':     { category: 'wholesale_supply', keywords: ['supplier'] },
  'bulk':         { category: 'wholesale_supply', keywords: ['bulk'] },
  // IT & Tech
  'repair':       { category: 'it_tech', keywords: ['repair'] },
  'software':     { category: 'it_tech', keywords: ['software'] },
  'developer':    { category: 'it_tech', keywords: ['developer'] },
  'website':      { category: 'it_tech', keywords: ['website'] },
  'app':          { category: 'it_tech', keywords: ['app'] },
  'it':           { category: 'it_tech', keywords: ['it'] },
  'tech':         { category: 'it_tech', keywords: ['tech'] },
  // Amharic single-word shortcuts — keywords stay English (products are matched
  // in English + name_am ilike; the semantic fallback covers the rest).
  'ላፕቶፕ':        { category: 'electronics_phones', keywords: ['laptop'] },
  'ስልክ':          { category: 'electronics_phones', keywords: ['phone'] },
  'ሞባይል':        { category: 'electronics_phones', keywords: ['mobile'] },
  'ኮምፒውተር':     { category: 'electronics_phones', keywords: ['computer'] },
  'ማተሚያ':        { category: 'printing_signage', keywords: ['printing'] },
  'ህትመት':        { category: 'printing_signage', keywords: ['print'] },
  'ባነር':          { category: 'printing_signage', keywords: ['banner'] },
  'ሎጎ':           { category: 'branding_design', keywords: ['logo'] },
  'ዲዛይን':         { category: 'branding_design', keywords: ['design'] },
  'ብራንዲንግ':      { category: 'branding_design', keywords: ['branding'] },
  'ምግብ':          { category: 'food_beverage', keywords: ['restaurant'] },
  'ካፌ':           { category: 'food_beverage', keywords: ['cafe'] },
  'ቡና':           { category: 'food_beverage', keywords: ['coffee'] },
  'ኬክ':           { category: 'food_beverage', keywords: ['cake'] },
  'ዳቦ':           { category: 'food_beverage', keywords: ['bakery'] },
  'ኬተሪንግ':       { category: 'catering_food', keywords: ['catering'] },
  'እንጀራ':         { category: 'catering_food', keywords: ['injera'] },
  'ፎቶ':           { category: 'photography_video', keywords: ['photo'] },
  'ፎቶግራፍ':       { category: 'photography_video', keywords: ['photography'] },
  'ቪዲዮ':          { category: 'photography_video', keywords: ['video'] },
  'ስቱዲዮ':         { category: 'photography_video', keywords: ['studio'] },
  'ልብስ':          { category: 'clothing_fashion', keywords: ['clothing'] },
  'ቀሚስ':          { category: 'clothing_fashion', keywords: ['dress'] },
  'ሀበሻ':          { category: 'clothing_fashion', keywords: ['habesha'] },
  'ሐበሻ':          { category: 'clothing_fashion', keywords: ['habesha'] },
  'ውበት':          { category: 'beauty_wellness', keywords: ['beauty'] },
  'ፀጉር':          { category: 'beauty_wellness', keywords: ['hair'] },
  'ሳሎን':          { category: 'beauty_wellness', keywords: ['salon'] },
  'ሜካፕ':          { category: 'beauty_wellness', keywords: ['makeup'] },
  'ግንባታ':         { category: 'construction_interior', keywords: ['construction'] },
  'ፈርኒቸር':        { category: 'construction_interior', keywords: ['furniture'] },
  'ዲሊቨሪ':         { category: 'transport_delivery', keywords: ['delivery'] },
  'ትራንስፖርት':     { category: 'transport_delivery', keywords: ['transport'] },
  'ሰርግ':          { category: 'events_entertainment', keywords: ['wedding'] },
  'ዝግጅት':         { category: 'events_entertainment', keywords: ['event'] },
  'አበባ':          { category: 'events_entertainment', keywords: ['flowers'] },
  'ዲጄ':           { category: 'events_entertainment', keywords: ['dj'] },
  'ስልጠና':         { category: 'training_consulting', keywords: ['training'] },
  'አማካሪ':         { category: 'training_consulting', keywords: ['consulting'] },
  'ጅምላ':          { category: 'wholesale_supply', keywords: ['wholesale'] },
  'ጥገና':          { category: 'it_tech', keywords: ['repair'] },
  'ሶፍትዌር':        { category: 'it_tech', keywords: ['software'] },
  'ዌብሳይት':        { category: 'it_tech', keywords: ['website'] },
};

/**
 * Normalize a query for the keyword cache: lowercase, strip punctuation/emoji,
 * collapse whitespace, drop leading filler words. Turns "Laptop?", "  PRINTING."
 * and "find a laptop" into cache hits instead of GPT calls.
 */
const FILLER_WORDS = new Set(['a', 'an', 'the', 'any', 'some', 'find', 'need', 'want', 'looking', 'for', 'show', 'me', 'i', 'please']);
function normalizeQuery(text) {
  const words = String(text)
    .toLowerCase()
    // keep letters (any script) + digits; everything else (punctuation, emoji,
    // Amharic marks, symbols) becomes a space
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w && !FILLER_WORDS.has(w));
  return words.join(' ');
}

// Category labels with Amharic translations + emoji
const CATEGORY_LABELS = {
  branding_design:       { en: 'Branding & Design',        am: 'ብራንዲንግ እና ዲዛይን',    emoji: '🎨' },
  printing_signage:      { en: 'Printing & Signage',       am: 'ማተሚያ እና ምልክት',        emoji: '🖨️' },
  photography_video:     { en: 'Photography & Video',      am: 'ፎቶግራፊ እና ቪዲዮ',       emoji: '📸' },
  catering_food:         { en: 'Catering & Food',          am: 'ምግብ ዝግጅት',            emoji: '🍽️' },
  food_beverage:         { en: 'Restaurants & Cafes',      am: 'ምግብ ቤቶች እና ካፌ',      emoji: '☕' },
  it_tech:               { en: 'IT & Tech',                am: 'ቴክኖሎጂ',               emoji: '💻' },
  events_entertainment:  { en: 'Events & Entertainment',   am: 'ዝግጅት እና መዝናኛ',       emoji: '🎉' },
  clothing_fashion:      { en: 'Clothing & Fashion',       am: 'አልባሳት እና ፋሽን',        emoji: '👗' },
  beauty_wellness:       { en: 'Beauty & Wellness',        am: 'ውበት እና ጤና',           emoji: '💆' },
  construction_interior: { en: 'Construction & Interior',  am: 'ግንባታ እና ውስጠ-ማስዋብ',  emoji: '🏗️' },
  transport_delivery:    { en: 'Transport & Delivery',     am: 'ትራንስፖርት እና ዲሊቨሪ',   emoji: '🚚' },
  training_consulting:   { en: 'Training & Consulting',    am: 'ስልጠና እና አማካሪ',       emoji: '📋' },
  wholesale_supply:      { en: 'Wholesale & Supply',       am: 'ጅምላ አቅርቦት',           emoji: '📦' },
  electronics_phones:    { en: 'Electronics & Phones',     am: 'ኤሌክትሮኒክስ እና ስልክ',   emoji: '📱' },
  other:                 { en: 'Other',                    am: 'ሌላ',                   emoji: '🏢' },
};

function catLabel(id) {
  return CATEGORY_LABELS[id]?.en || id;
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j?.ok) console.warn(`[search-bot] tg ${method}:`, j?.description);
  return j;
}

/**
 * Answer a specific question about a business using its public knowledge.
 */
/** Build a contact URL for a business — custom bot or shared deep link.
 *  Exported: the Market catalog API reuses it for chat handoff links. */
export function contactUrlFor(business, trackingParam = 'minime_search') {
  if (business.telegram_bot_username) return `https://t.me/${business.telegram_bot_username}?start=${trackingParam}`;
  if (business.shop_code) return `https://t.me/MiniMeAgentBot?start=shop_${business.shop_code}`;
  return null;
}

async function answerBusinessQuestion(token, chatId, business, question) {
  const pub = business.search_public_info || {};
  const contactUrl = contactUrlFor(business);
  if (pub.ai_answers === false) {
    const buttons = contactUrl ? [[{ text: `💬 Ask ${business.name} directly`, url: contactUrl }]] : [];
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `For detailed questions about *${business.name}*, chat directly with their bot:`,
      reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
    });
    return;
  }

  tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const sb = supabase();
  const contextParts = [`Business: ${business.name}`, `Category: ${business.category || ''}`, `Location: ${business.location || 'Addis Ababa'}`];
  if (business.description) contextParts.push(`About: ${business.description}`);

  if (pub.products !== false) {
    try {
      const { data: products } = await sb.from('products')
        .select('name, description, price, currency, stock_quantity, name_am')
        .eq('business_id', business.id).eq('is_active', true).limit(20);
      if (products?.length) {
        const pList = products.map(p => {
          const price = (pub.prices !== false && p.price != null) ? ` — ${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
          const oos = p.stock_quantity != null && p.stock_quantity <= 0 ? ' (out of stock)' : '';
          return `• ${p.name}${p.name_am ? `/${p.name_am}` : ''}${price}${oos}`;
        }).join('\n');
        contextParts.push(`Products:\n${pList}`);
      }
    } catch {}
  }

  if (pub.faqs !== false) {
    try {
      const { data: biz } = await sb.from('businesses').select('sample_replies, owner_instructions').eq('id', business.id).single();
      if (biz?.sample_replies?.length) {
        const faqs = biz.sample_replies.slice(0, 10).map(r =>
          `Q: ${r.trigger || r.question || '?'}\nA: ${(r.reply || r.answer || '').slice(0, 200)}`
        ).filter(f => f.length > 10).join('\n\n');
        if (faqs) contextParts.push(`FAQs:\n${faqs}`);
      }
      if (biz?.owner_instructions?.length) {
        const inst = biz.owner_instructions.slice(0, 5).map(r => r.content || r.instruction || r.rule || '').filter(Boolean).join('\n');
        if (inst) contextParts.push(`Business rules:\n${inst}`);
      }
    } catch {}
  }

  if (pub.address !== false && (business.address || business.location)) contextParts.push(`Address: ${business.address || business.location}`);
  if (pub.phone === true && business.phone) contextParts.push(`Phone: ${business.phone}`);

  try {
    const res = await loggedCompletion({
      route: 'search_qa', model: MODEL_MINI, temperature: 0.3, max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant answering customer questions about a specific Ethiopian business.
Answer ONLY from the information provided. Be concise and helpful.
If information isn't available, say "I don't have that information — contact them directly."
Do NOT make up prices, addresses, or details not in the context.
Format nicely for Telegram (use *bold* for emphasis, no markdown headers).

Business context:\n${contextParts.join('\n')}`,
        },
        { role: 'user', content: question },
      ],
    });
    const answer = res.choices[0].message.content;
    const chatBtn = contactUrl ? { inline_keyboard: [[{ text: `💬 Chat with ${business.name}`, url: contactUrl }]] } : undefined;
    await tg(token, 'sendMessage', {
      chat_id: chatId, parse_mode: 'Markdown', disable_web_page_preview: true,
      text: `*${business.name}*\n\n${answer}`,
      reply_markup: chatBtn,
    });
  } catch (e) {
    console.warn('[search-bot] qa error:', e.message);
    const fallbackBtn = contactUrl ? { inline_keyboard: [[{ text: `💬 Ask ${business.name}`, url: contactUrl }]] } : undefined;
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: `For questions about ${business.name}, tap to chat:`,
      reply_markup: fallbackBtn,
    });
  }
}

/**
 * Parse a natural language search query into structured params.
 */
async function parseQuery(text) {
  try {
    const res = await loggedCompletion({
      route: 'search_parse', model: MODEL_MINI, temperature: 0.1, max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You parse business search queries for an Ethiopian SMB directory. Queries may be in English or Amharic.
Extract:
- intent: "find_product" | "find_service" | "browse_category" | "list_all" | "help" | "ask_business"
- category: one of these IDs (or null):
${Object.entries(CATEGORY_LABELS).map(([id, { en, am }]) => `  ${id} — ${en} / ${am}`).join('\n')}
- keywords: array of specific product/service terms (lowercase English, e.g. ["laptop", "repair"])
- location: city/area mentioned (e.g. "Bole", "Piazza", "Addis Ababa") or null
- budget: price constraint if mentioned (e.g. "under 30000") or null
- business_name: if asking about a SPECIFIC business by name, or null
Use intent "ask_business" when asking a question about a specific named business.
Return JSON only.`,
        },
        { role: 'user', content: text },
      ],
    });
    return JSON.parse(res.choices[0].message.content);
  } catch (e) {
    console.warn('[search-bot] parse error:', e.message);
    return { intent: 'find_service', category: null, keywords: [], location: null, budget: null };
  }
}

/**
 * Search businesses table + products + replies for matching results.
 * Exported: the Market catalog API reuses it for the "shops that can help"
 * fallback when few products match a query.
 */
export async function searchDirectory({ category, keywords = [], location, limit = 5, offset = 0 }) {
  const sb = supabase();
  let q = sb
    .from('businesses')
    .select('id, name, description, tagline, category, tags, location, address, telegram_bot_username, shop_code, search_count, logo_url, average_rating, total_reviews, verified')
    .eq('b2b_discoverable', true)
    .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)')
    .order('verified', { ascending: false, nullsFirst: false })
    .order('average_rating', { ascending: false, nullsFirst: false })
    .order('search_count', { ascending: false, nullsFirst: false })
    .limit(limit * 4);

  if (category) {
    // Match against both the legacy single-category field AND the new categories array
    // cs = "contains" — checks if the array contains this value.
    // ilike (not eq): stored categories vary in casing ("Electronics_Phones")
    // while GPT/cache emit lowercase ids — eq silently missed those rows.
    q = q.or(`category.ilike.${category},categories.cs.{${category}}`);
  }
  if (location) q = q.ilike('location', `%${location}%`);

  const { data, error } = await q;
  if (error) { console.error('[search-bot] query error:', error.message); return []; }
  if (!data?.length) return [];

  let results = data;
  // businessId → the exact product that matched the query (name/image/price),
  // so result cards can show THAT product's photo, not just the newest one.
  const matchedByBiz = {};

  if (keywords.length) {
    const kws = keywords.map(k => k.toLowerCase());

    const profileMatches = results.filter(b => {
      const hay = [b.name, b.description, b.tagline, b.category, ...(Array.isArray(b.tags) ? b.tags : [])].join(' ').toLowerCase();
      return kws.some(k => hay.includes(k));
    });

    let productMatchIds = new Set();
    try {
      const orFilter = kws.map(k => `name.ilike.%${k}%,description.ilike.%${k}%,name_am.ilike.%${k}%`).join(',');
      const { data: productHits } = await sb.from('products').select('business_id, name, name_am, image_url, price, currency').eq('is_active', true).or(orFilter).limit(20);
      if (productHits?.length) productHits.forEach(p => {
        productMatchIds.add(p.business_id);
        // Prefer a hit with a photo as "the" matched product for the card.
        if (!matchedByBiz[p.business_id] || (!matchedByBiz[p.business_id].image_url && p.image_url)) {
          matchedByBiz[p.business_id] = p;
        }
      });
    } catch (e) { console.warn('[search-bot] product search error:', e.message); }

    let replyMatchIds = new Set();
    try {
      const { data: bizWithReplies } = await sb.from('businesses').select('id, sample_replies, owner_instructions').in('id', results.map(b => b.id));
      bizWithReplies?.forEach(b => {
        const rt = [...(b.sample_replies || []).map(r => `${r.trigger || ''} ${r.reply || ''}`), ...(b.owner_instructions || []).map(r => r.content || '')].join(' ').toLowerCase();
        if (kws.some(k => rt.includes(k))) replyMatchIds.add(b.id);
      });
    } catch {}

    const extraIds = new Set([...productMatchIds, ...replyMatchIds]);
    const profileIds = new Set(profileMatches.map(b => b.id));
    const missingIds = [...extraIds].filter(id => !profileIds.has(id));

    let extraBusinesses = [];
    if (missingIds.length) {
      try {
        const { data: fetched } = await sb
          .from('businesses')
          .select('id, name, description, tagline, category, tags, location, address, telegram_bot_username, shop_code, search_count, logo_url, average_rating, total_reviews, verified')
          .eq('b2b_discoverable', true).or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)').in('id', missingIds);
        extraBusinesses = fetched || [];
      } catch {}
    }

    const inResultsExtras = results.filter(b => extraIds.has(b.id) && !profileIds.has(b.id));
    const merged = [...profileMatches, ...extraBusinesses, ...inResultsExtras];
    results = merged.length > 0 ? merged : data;
  }

  // Page the merged list. hasMore rides on the array (non-breaking for callers
  // that only iterate) so executeSearch can offer a "Show more" button.
  const page = results.slice(offset, offset + limit);
  page.hasMore = results.length > offset + limit;
  page.forEach(b => { if (matchedByBiz[b.id]) b._matched_product = matchedByBiz[b.id]; });

  const ids = page.map(b => b.id);
  if (ids.length) {
    sb.rpc('increment_search_count', { business_ids: ids }).then(() => {}, () => {
      ids.forEach(id => sb.from('businesses').update({ search_count: (results.find(b => b.id === id)?.search_count || 0) + 1 }).eq('id', id).then(() => {}).catch(() => {}));
    });
  }

  return page;
}

/**
 * Semantic search using pgvector embeddings.
 */
async function semanticSearch(queryText, limit = 5) {
  try {
    const r = await embedClient().embeddings.create({ model: EMBED_MODEL, input: [queryText.slice(0, 2000)] });
    const { data, error } = await supabase().rpc('match_businesses_by_search', {
      query_embedding: r.data[0].embedding,
      // 0.18 (was 0.25): embeddings are the typo/Amharic safety net — the
      // stricter cutoff dropped misspellings that keyword search already missed.
      match_threshold: 0.18,
      match_count: limit,
    });
    if (error) { console.warn('[search-bot] semantic error:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('[search-bot] semantic fail:', e.message);
    return [];
  }
}

function mergeResults(keywordResults, semanticResults, limit = 5) {
  const seen = new Set(keywordResults.map(b => b.id));
  const merged = [...keywordResults];
  for (const b of semanticResults) {
    if (!seen.has(b.id) && merged.length < limit) { seen.add(b.id); merged.push(b); }
  }
  return merged.slice(0, limit);
}

function getCacheKey(parsed) {
  return `${parsed.category || ''}:${(parsed.keywords || []).slice().sort().join(',')}:${parsed.location || ''}`;
}

async function getTopProducts(businessId, limit = 3) {
  try {
    const { data } = await supabase().from('products').select('name, price, currency, name_am, image_url').eq('business_id', businessId).eq('is_active', true).order('created_at', { ascending: false }).limit(limit);
    return data || [];
  } catch { return []; }
}

async function getBestPhoto(business) {
  if (business.logo_url) return business.logo_url;
  try {
    const { data } = await supabase().from('products').select('image_url').eq('business_id', business.id).eq('is_active', true).not('image_url', 'is', null).limit(1);
    return data?.[0]?.image_url || null;
  } catch { return null; }
}

/**
 * Format search results.
 * @param {Array} businesses
 * @param {string} queryText
 * @param {string|null} searchLogId — UUID for msearch deep-link tracking
 */
async function formatResults(businesses, queryText, searchLogId, { offset = 0, hasMore = false } = {}) {
  if (!businesses.length) return null;

  const lines = [];
  const keyboard = [];
  const photoCards = [];

  for (let i = 0; i < businesses.length; i++) {
    const b = businesses[i];
    const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][offset + i] || `${offset + i + 1}.`;
    const badge = b.verified ? ' ✅' : '';
    const loc = b.location ? `\n📍 ${b.location}` : '';
    const desc = b.tagline
      ? `\n💬 ${b.tagline}`
      : b.description
        ? `\n💬 ${b.description.slice(0, 100)}${b.description.length > 100 ? '…' : ''}`
        : '';
    const ratingLine = b.total_reviews > 0
      ? `\n⭐ ${b.average_rating}/5 (${b.total_reviews} review${b.total_reviews > 1 ? 's' : ''})`
      : '';

    const products = await getTopProducts(b.id, 3);
    const matched = b._matched_product || null;
    let productLine = '';
    let firstProductImage = null;
    if (matched) {
      // Lead with the product that actually matched the query.
      const mPrice = matched.price != null ? ` — ${Number(matched.price).toLocaleString()} ${matched.currency || 'ETB'}` : '';
      productLine = `\n🎯 ${matched.name}${mPrice}`;
      const rest = products.filter(p => p.name !== matched.name).slice(0, 2).map(p => {
        const price = p.price != null ? ` — ${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
        return `${p.name}${price}`;
      }).join(', ');
      if (rest) productLine += `\n🛍️ ${rest}`;
    } else if (products.length) {
      firstProductImage = products.find(p => p.image_url)?.image_url || null;
      const pList = products.map(p => {
        const price = p.price != null ? ` — ${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
        return `${p.name}${price}`;
      }).join(', ');
      productLine = `\n🛍️ ${pList}`;
    } else if (Array.isArray(b.tags) && b.tags.length) {
      productLine = `\n🏷️ ${b.tags.slice(0, 4).join(', ')}`;
    }

    // Deep link with msearch tracking
    const trackingParam = searchLogId ? `msearch_${searchLogId}` : 'minime_search';
    const deepLink = contactUrlFor(b, trackingParam);

    // The matched product's own photo wins — the searcher should see exactly
    // what they asked for, not the logo or whatever was uploaded last.
    const photoUrl = matched?.image_url || b.logo_url || firstProductImage || await getBestPhoto(b);

    if (photoUrl) {
      const caption = `${num} *${b.name}*${badge}${ratingLine}${loc}${desc}${productLine}`;
      const chatBtn = deepLink ? [{ text: `💬 Chat with ${b.name}`, url: deepLink }] : null;
      photoCards.push({ photoUrl, caption, keyboard: chatBtn ? [chatBtn] : [] });
    } else {
      lines.push(`${num} *${b.name}*${badge}${ratingLine}${loc}${desc}${productLine}`);
      if (deepLink) keyboard.push([{ text: `💬 Chat with ${b.name}`, url: deepLink }]);
    }
  }

  const total = businesses.length;
  const headerText = photoCards.length === total
    ? `🔍 *${total} business${total > 1 ? 'es' : ''}* for _"${queryText}"_ — tap to chat:`
    : `🔍 Found *${total} business${total > 1 ? 'es' : ''}* for _"${queryText}"_:${lines.length ? `\n\n${lines.join('\n\n')}` : ''}`;

  // Guide instead of going silent: one row of refine buttons under first-page
  // results ("want me to narrow it down?"). Callback carries the search_logs
  // UUID so the flow can be re-seeded from the DB on any lambda.
  if (searchLogId && offset === 0) {
    keyboard.push([
      { text: '💰 Budget', callback_data: `sq:rb:${searchLogId}` },
      { text: '📍 Area', callback_data: `sq:rl:${searchLogId}` },
    ]);
  }

  // Pagination: callback carries the search_logs UUID so any lambda can
  // rehydrate the query from the DB (in-memory state doesn't survive).
  if (hasMore && searchLogId) {
    keyboard.push([{ text: '➕ Show more', callback_data: `sb:more:${searchLogId}:${offset + businesses.length}` }]);
  }

  return { text: headerText, reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined, photoCards };
}

async function sendResults(token, chatId, reply) {
  if (!reply) return;
  const { text, reply_markup, photoCards = [] } = reply;

  for (const card of photoCards) {
    try {
      await tg(token, 'sendPhoto', {
        chat_id: chatId, photo: card.photoUrl, caption: card.caption, parse_mode: 'Markdown',
        reply_markup: card.keyboard.length ? { inline_keyboard: card.keyboard } : undefined,
      });
    } catch (e) {
      console.warn('[search-bot] photo send failed:', e.message);
      await tg(token, 'sendMessage', {
        chat_id: chatId, text: card.caption, parse_mode: 'Markdown',
        reply_markup: card.keyboard.length ? { inline_keyboard: card.keyboard } : undefined,
      }).catch(() => {});
    }
  }

  if (text) {
    await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup });
  }
}

/**
 * Core search execution — used by direct search + clarification callback flow.
 * Handles: result cache, DB search, semantic fallback, logging, formatting, sending.
 */
async function executeSearch(token, chatId, { text, parsed, senderId, usedGPT = false, searchLogId, offset = 0 }) {
  const cacheKey = `${getCacheKey(parsed)}:${offset}`;
  const cachedEntry = resultCache.get(cacheKey);

  let results;
  let hasMore = false;
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL) {
    results = cachedEntry.results;
    hasMore = !!cachedEntry.hasMore;
  } else {
    results = await searchDirectory({
      category: parsed.category,
      keywords: parsed.keywords || [],
      location: parsed.location,
      limit: 5,
      offset,
    });
    hasMore = !!results.hasMore;
    // Semantic fallback only on the first page — later pages are explicit
    // "more of the same list" requests, not new searches.
    if (results.length < 3 && !offset) {
      let semantic = await semanticSearch(text, 5);
      // Category discipline: when the searcher's category is known, embeddings
      // must not smuggle in cross-category businesses (a salon under
      // "Electronics"). Uncategorized rows stay eligible.
      if (parsed.category && semantic.length) {
        const want = String(parsed.category).toLowerCase();
        semantic = semantic.filter(b => !b.category || String(b.category).toLowerCase() === want);
      }
      if (semantic.length) results = mergeResults(results, semantic, 5);
    }
    if (results.length) resultCache.set(cacheKey, { results, hasMore, timestamp: Date.now() });
  }

  // Log search (fire-and-forget). Only the first page — "Show more" taps reuse
  // the same searchLogId and must not inflate search volume.
  if (!offset) supabase().from('search_logs').insert({
    id: searchLogId || undefined,
    searcher_telegram_id: senderId,
    raw_query: text,
    parsed_intent: parsed,
    results_count: results.length,
    results_profile_ids: results.map(b => b.id),
    used_gpt: usedGPT,
    language: /[ሀ-፿]/.test(text) ? 'am' : 'en',
  }).then(() => {}).catch(() => {});

  if (!results.length && offset) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: "That's everything for this search — try a new one!" });
    return;
  }

  if (!results.length) {
    supabase().from('search_waitlist').insert({
      searcher_telegram_id: senderId,
      raw_query: text,
      parsed_category: parsed.category || null,
      keywords: parsed.keywords || [],
    }).then(() => {}).catch(() => {});

    const catHint = parsed.category ? ` in _${catLabel(parsed.category)}_` : '';
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `😔 I couldn't find any businesses matching *"${text}"*${catHint} on MiniMe yet.\n\nMiniMe is growing! I'll notify you when a matching business joins. 🔔\n\nIn the meantime, explore what's already here:`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 Browse categories', callback_data: 'sb:categories' }],
          [{ text: '🏢 See all businesses', callback_data: 'sb:all' }],
        ],
      },
    });
    return;
  }

  const reply = await formatResults(results, text, searchLogId, { offset, hasMore });
  if (reply) await sendResults(token, chatId, reply);

  // Cross-sell from the searcher's own history. Awaited (results are already
  // sent, and an unawaited promise can be frozen with the lambda) but errors
  // never surface — a failed recommendation must not fail the search.
  if (!offset && results.length && parsed.intent !== 'list_all') {
    await maybeRecommend(token, chatId, senderId, parsed, results.map(b => b.id), searchLogId)
      .catch(e => console.warn('[search-bot] recommend failed:', e.message));
  }
}

// ── Personalized recommendation ("you might also like") ────────────────────
// search_logs doubles as the searcher's interest profile: every search stores
// searcher_telegram_id + parsed category. After a successful search, suggest
// ONE business from their most-searched OTHER category — measured through the
// same msearch_<logId> deep link, so recommendation clicks show up in
// search_referrals (CTR/conversion on the admin dashboard) automatically.
const lastRecAt = new Map(); // senderId → ts (per-instance; resets on cold start)
const REC_COOLDOWN_MS = 24 * 3600 * 1000;

async function maybeRecommend(token, chatId, senderId, parsed, excludeIds, searchLogId) {
  if (!senderId) return;
  const last = lastRecAt.get(senderId);
  if (last && Date.now() - last < REC_COOLDOWN_MS) return;

  // Interest profile: categories from this searcher's recent history.
  const { data: history } = await supabase()
    .from('search_logs')
    .select('parsed_intent')
    .eq('searcher_telegram_id', senderId)
    .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  if (!history?.length) return;

  const counts = {};
  for (const h of history) {
    const cat = h.parsed_intent?.category;
    if (cat && cat !== parsed.category) counts[cat] = (counts[cat] || 0) + 1;
  }
  const topCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topCat || !CATEGORY_LABELS[topCat]) return;

  const candidates = await searchDirectory({ category: topCat, limit: 3 });
  const rec = candidates.find(b => !excludeIds.includes(b.id));
  if (!rec) return;

  const deepLink = contactUrlFor(rec, searchLogId ? `msearch_${searchLogId}` : 'minime_search');
  if (!deepLink) return;

  await tg(token, 'sendMessage', {
    chat_id: chatId,
    parse_mode: 'Markdown',
    text: `💡 Since you've also searched for _${CATEGORY_LABELS[topCat].en}_ — *${rec.name}*${rec.verified ? ' ✅' : ''} is popular there${rec.total_reviews > 0 ? ` (⭐ ${rec.average_rating}/5)` : ''}.`,
    reply_markup: { inline_keyboard: [[{ text: `💬 Chat with ${rec.name}`, url: deepLink }]] },
  });
  lastRecAt.set(senderId, Date.now());
}

/**
 * Main handler — called for every message to the search bot.
 */
export async function handleSearchBotUpdate(token, update) {
  const msg = update.message || update.edited_message;
  if (!msg?.text) return;

  const chatId = msg.chat.id;
  const senderId = String(msg.from?.id || '');
  const text = msg.text.trim();

  // ── /start ─────────────────────────────────────────────────────────────────
  if (/^\/start\b/i.test(text)) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `👋 Welcome to *MiniMe Search*!\n\nFind Ethiopian businesses with live AI bots — type what you need or browse a category below:\n\n_Examples: "laptop repair", "ብራንዲንግ ኩባንያ", "wedding catering Bole"_`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎨 Branding', callback_data: 'sb:cat:branding_design' }, { text: '📸 Photography', callback_data: 'sb:cat:photography_video' }],
          [{ text: '💻 IT & Tech', callback_data: 'sb:cat:it_tech' }, { text: '📱 Electronics', callback_data: 'sb:cat:electronics_phones' }],
          [{ text: '🍽️ Catering', callback_data: 'sb:cat:catering_food' }, { text: '☕ Restaurants', callback_data: 'sb:cat:food_beverage' }],
          [{ text: '👗 Fashion', callback_data: 'sb:cat:clothing_fashion' }, { text: '💆 Beauty', callback_data: 'sb:cat:beauty_wellness' }],
          [{ text: '🏗️ Construction', callback_data: 'sb:cat:construction_interior' }, { text: '🚚 Transport', callback_data: 'sb:cat:transport_delivery' }],
          [{ text: '🖨️ Printing', callback_data: 'sb:cat:printing_signage' }, { text: '🎉 Events', callback_data: 'sb:cat:events_entertainment' }],
          [{ text: '🏢 All businesses on MiniMe', callback_data: 'sb:all' }],
          [{ text: '🛍️ Browse MiniMe Market', web_app: { url: `${MINIAPP_BASE}/market` } }],
        ],
      },
    });
    return;
  }

  // ── /help ──────────────────────────────────────────────────────────────────
  if (/^\/help\b/i.test(text)) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `*MiniMe Search — Help*\n\n🔍 *Search examples:*\n• "Find a printer in Piazza"\n• "Catering for 50 people"\n• "Laptop repair near Mexico"\n• "ብራንዲንግ ኩባንያ"\n\n📂 *Browse categories:*\n• "Show all photographers"\n• "List electronics shops"\n\n💡 Each result links directly to the business bot — tap to chat instantly!`,
    });
    return;
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const hourlyCheck = rateLimit(senderId, 'search-hourly', 10, 3600);
  const dailyCheck  = rateLimit(senderId, 'search-daily',  30, 86400);
  if (!hourlyCheck.ok || !dailyCheck.ok) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: "⏳ You've searched a lot today! Take a break and try again in a bit.",
    });
    return;
  }

  // ── Check for pending review comment ──────────────────────────────────────
  const pendingReview = pendingReviews.get(chatId);
  if (pendingReview && !/^\//.test(text)) {
    const comment = text.slice(0, 500);
    pendingReviews.delete(chatId);
    try {
      await supabase().from('reviews')
        .update({ comment })
        .eq('business_id', pendingReview.businessId)
        .eq('reviewer_telegram_id', senderId);
    } catch {}
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: '✅ Review saved! Thanks for helping others find great businesses 🙏',
    });
    return;
  }

  // ── Chatter detection ──────────────────────────────────────────────────────
  const CHATTER_PATTERN = /^(hi+|hello+|hey+|how are you|what'?s up|who are you|tell me a joke|good morning|good evening|what can you do|thank(s| you)?|bye|ok(ay)?|yes|no|sure|lol|haha|😂|❤️?|👍|🙏|sup)$/i;
  if (CHATTER_PATTERN.test(text)) {
    const streak = (chatterStreaks.get(senderId) || 0) + 1;
    chatterStreaks.set(senderId, streak);
    if (streak >= 3) return; // silent after 3 chatter messages
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: "I'm *MiniMe Search* — I help you find Ethiopian businesses! 🇪🇹\n\nJust tell me what you're looking for:\n_\"laptop repair\", \"branding in Bole\", \"catering for 100\"_",
    });
    return;
  }
  chatterStreaks.delete(senderId); // reset on real search

  // ── Show categories ────────────────────────────────────────────────────────
  if (/categor|what.*there|browse|list all|ምድብ/i.test(text) || text === 'categories') {
    const catText = Object.entries(CATEGORY_LABELS).map(([, { en, am }]) => `• ${en} / ${am}`).join('\n');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `📂 *MiniMe Categories:*\n\n${catText}\n\nJust tell me which one you need!`,
    });
    return;
  }

  // ── Natural language search ────────────────────────────────────────────────
  tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  // Pre-generate search log ID for msearch deep-link tracking
  const searchLogId = crypto.randomUUID();

  // Keyword cache check (skip GPT for simple single-word queries)
  const kwCacheKey = normalizeQuery(text);
  const keywordHit = KEYWORD_CACHE[kwCacheKey];
  let parsed;
  let usedGPT = false;

  if (keywordHit) {
    parsed = {
      intent: 'find_product',
      category: keywordHit.category,
      keywords: keywordHit.keywords,
      location: null, budget: null, business_name: null,
    };
  } else {
    parsed = await parseQuery(text);
    usedGPT = true;
  }

  // ── Ask about a specific business ──────────────────────────────────────────
  if (parsed.intent === 'ask_business' && parsed.business_name) {
    try {
      const { data: matches } = await supabase()
        .from('businesses')
        .select('id, name, description, category, location, address, phone, telegram_bot_username, shop_code, search_public_info')
        .eq('b2b_discoverable', true)
        .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)')
        .ilike('name', `%${parsed.business_name}%`)
        .limit(1);
      if (matches?.length) {
        await answerBusinessQuestion(token, chatId, matches[0], text);
        supabase().from('search_logs').insert({
          id: searchLogId, searcher_telegram_id: senderId, raw_query: text,
          parsed_intent: parsed, results_count: 1, results_profile_ids: [matches[0].id],
          used_gpt: usedGPT, language: /[ሀ-፿]/.test(text) ? 'am' : 'en',
        }).then(() => {}).catch(() => {});
        return;
      }
    } catch {}
  }

  // "who's on minime" / list all
  if (parsed.intent === 'list_all' || /who.*minime|all.*business|everyone/i.test(text)) {
    const results = await searchDirectory({ limit: 5 });
    const reply = await formatResults(results, 'MiniMe businesses', searchLogId);
    if (reply) await sendResults(token, chatId, reply);
    else await tg(token, 'sendMessage', { chat_id: chatId, text: 'No businesses are listed yet. Check back soon!' });
    return;
  }

  // ── Clarifying questions (budget + location) ───────────────────────────────
  // Only ask if query is NLP-parsed (not keyword cache hit) and lacks specifics
  const shouldClarify = usedGPT
    && (parsed.intent === 'find_product' || parsed.intent === 'find_service')
    && !parsed.budget
    && !parsed.location
    && !parsed.business_name;

  if (shouldClarify) {
    pendingClarifications.set(chatId, { text, parsed, senderId, usedGPT, searchLogId, step: 'budget' });
    const catEmoji = CATEGORY_LABELS[parsed.category]?.emoji || '🔍';
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `${catEmoji} Looking for *${text}*!\n\nWhat's your budget?`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Under 5k',   callback_data: 'sq:b:5000' },
            { text: '5k – 15k',   callback_data: 'sq:b:15000' },
            { text: '15k – 30k',  callback_data: 'sq:b:30000' },
          ],
          [
            { text: '30k – 50k',  callback_data: 'sq:b:50000' },
            { text: '50k+',       callback_data: 'sq:b:999999' },
            { text: 'Any',        callback_data: 'sq:b:any' },
          ],
        ],
      },
    });
    return;
  }

  // ── Execute search directly ────────────────────────────────────────────────
  await executeSearch(token, chatId, { text, parsed, senderId, usedGPT, searchLogId });
}

/**
 * Handle inline button callbacks from the search bot.
 */
export async function handleSearchBotCallback(token, callbackQuery) {
  const { data, message, from } = callbackQuery;
  const chatId = message?.chat?.id;
  if (!chatId) return;

  await tg(token, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });

  // ── Review rating buttons: rv:BIZID:RATING ─────────────────────────────────
  if (data?.startsWith('rv:') && data !== 'rv:skip') {
    const parts = data.split(':');
    const rating = parseInt(parts[parts.length - 1]);
    // Business ID is everything between 'rv:' and the last ':RATING' segment
    const businessId = parts.slice(1, -1).join(':');
    if (!businessId || isNaN(rating) || rating < 1 || rating > 5) return;

    const sb = supabase();
    const { error } = await sb.from('reviews').upsert({
      business_id: businessId,
      reviewer_telegram_id: String(from?.id || ''),
      rating,
    }, { onConflict: 'business_id,reviewer_telegram_id' });

    if (!error) {
      sb.rpc('update_business_rating', { biz_id: businessId }).then(() => {}, () => {});
      pendingReviews.set(chatId, { businessId, rating });
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `Thanks for the ${'⭐'.repeat(rating)} rating!\n\nWant to add a short comment? It helps others find the right business. (optional)`,
        reply_markup: { inline_keyboard: [[{ text: 'Skip', callback_data: 'rv:skip' }]] },
      });
    } else {
      await tg(token, 'sendMessage', { chat_id: chatId, text: '✅ Thanks for your feedback!' });
    }
    return;
  }

  // ── Review skip ────────────────────────────────────────────────────────────
  if (data === 'rv:skip') {
    pendingReviews.delete(chatId);
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: '✅ Your review has been saved. Thanks for helping others find great businesses! 🙏',
    });
    return;
  }

  // ── Refine buttons under results: sq:rb:<logId> (budget) / sq:rl:<logId> ──
  // Re-seed the clarify flow from the persisted search_log so the user can
  // narrow an already-run search. (The follow-up tap uses the same in-memory
  // pendingClarifications as the original clarify flow — same warm-lambda
  // assumption; on a cold miss the user just types the search again.)
  if (data?.startsWith('sq:rb:') || data?.startsWith('sq:rl:')) {
    const logId = data.slice(6);
    try {
      const { data: log } = await supabase()
        .from('search_logs')
        .select('raw_query, parsed_intent, searcher_telegram_id, used_gpt')
        .eq('id', logId)
        .maybeSingle();
      if (!log) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: 'That search has expired — just type what you need again!' });
        return;
      }
      pendingClarifications.set(chatId, {
        text: log.raw_query,
        parsed: { ...(log.parsed_intent || {}) },
        senderId: log.searcher_telegram_id || String(from?.id || ''),
        usedGPT: !!log.used_gpt,
        searchLogId: crypto.randomUUID(), // the refined run logs as its own search
        step: data.startsWith('sq:rb:') ? 'budget' : 'location',
      });
      if (data.startsWith('sq:rb:')) {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          parse_mode: 'Markdown',
          text: `💰 What's your budget for *${log.raw_query}*?`,
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Under 5k', callback_data: 'sq:b:5000' }, { text: '5k – 15k', callback_data: 'sq:b:15000' }, { text: '15k – 30k', callback_data: 'sq:b:30000' }],
              [{ text: '30k – 50k', callback_data: 'sq:b:50000' }, { text: '50k+', callback_data: 'sq:b:999999' }, { text: 'Any', callback_data: 'sq:b:any' }],
            ],
          },
        });
      } else {
        await tg(token, 'sendMessage', {
          chat_id: chatId,
          text: '📍 Where in Addis?',
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Bole', callback_data: 'sq:l:Bole' }, { text: 'Piazza', callback_data: 'sq:l:Piazza' }, { text: 'Mexico', callback_data: 'sq:l:Mexico' }],
              [{ text: 'Kazanchis', callback_data: 'sq:l:Kazanchis' }, { text: 'CMC', callback_data: 'sq:l:CMC' }, { text: 'Anywhere', callback_data: 'sq:l:any' }],
            ],
          },
        });
      }
    } catch (e) { console.warn('[search-bot] refine failed:', e.message); }
    return;
  }

  // ── Budget clarification ───────────────────────────────────────────────────
  if (data?.startsWith('sq:b:')) {
    const pending = pendingClarifications.get(chatId);
    if (!pending) return;
    const budgetVal = data.replace('sq:b:', '');
    if (budgetVal !== 'any') pending.parsed.budget = `under ${budgetVal}`;

    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: '📍 Where in Addis?',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Bole', callback_data: 'sq:l:Bole' }, { text: 'Piazza', callback_data: 'sq:l:Piazza' }, { text: 'Mexico', callback_data: 'sq:l:Mexico' }],
          [{ text: 'Kazanchis', callback_data: 'sq:l:Kazanchis' }, { text: 'CMC', callback_data: 'sq:l:CMC' }, { text: 'Anywhere', callback_data: 'sq:l:any' }],
        ],
      },
    });
    return;
  }

  // ── Location clarification ─────────────────────────────────────────────────
  if (data?.startsWith('sq:l:')) {
    const pending = pendingClarifications.get(chatId);
    if (!pending) return;
    const loc = data.replace('sq:l:', '');
    if (loc !== 'any') pending.parsed.location = loc;
    pendingClarifications.delete(chatId);
    tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    await executeSearch(token, chatId, pending);
    return;
  }

  // ── "Show more" pagination: sb:more:<searchLogId>:<offset> ────────────────
  // Rehydrate the query from search_logs (persisted at first send) — the tap
  // may land on a different lambda, so in-memory state can't be trusted.
  if (data?.startsWith('sb:more:')) {
    const [, , logId, offsetStr] = data.split(':');
    const offset = parseInt(offsetStr, 10) || 0;
    try {
      const { data: log } = await supabase()
        .from('search_logs')
        .select('raw_query, parsed_intent, searcher_telegram_id, used_gpt')
        .eq('id', logId)
        .maybeSingle();
      if (!log) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: 'That search has expired — just type what you need again!' });
        return;
      }
      tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      await executeSearch(token, chatId, {
        text: log.raw_query,
        parsed: log.parsed_intent || {},
        senderId: log.searcher_telegram_id || String(from?.id || ''),
        usedGPT: !!log.used_gpt,
        searchLogId: logId,
        offset,
      });
    } catch (e) {
      console.warn('[search-bot] show-more failed:', e.message);
    }
    return;
  }

  // ── Category list ──────────────────────────────────────────────────────────
  if (data === 'sb:categories') {
    const catText = Object.entries(CATEGORY_LABELS).map(([, { en, am }]) => `• ${en} / ${am}`).join('\n');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `📂 *Categories on MiniMe:*\n\n${catText}\n\nJust type what you're looking for!`,
    });
    return;
  }

  // ── Category quick-tap ─────────────────────────────────────────────────────
  // Routed through executeSearch so browses are logged (they were invisible in
  // search analytics before) and get the same "Show more" pagination.
  if (data?.startsWith('sb:cat:')) {
    const catId = data.replace('sb:cat:', '');
    const catInfo = CATEGORY_LABELS[catId];
    if (!catInfo) return;
    tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    await executeSearch(token, chatId, {
      text: catInfo.en,
      parsed: { intent: 'find_product', category: catId, keywords: [] },
      senderId: String(from?.id || ''),
      usedGPT: false,
      searchLogId: crypto.randomUUID(),
    });
    return;
  }

  if (data === 'sb:start') {
    await tg(token, 'sendMessage', { chat_id: chatId, text: "Type what you're looking for, or use /start to see categories." });
    return;
  }

  if (data === 'sb:all') {
    tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    await executeSearch(token, chatId, {
      text: 'all businesses',
      parsed: { intent: 'list_all', keywords: [] },
      senderId: String(from?.id || ''),
      usedGPT: false,
      searchLogId: crypto.randomUUID(),
    });
    return;
  }
}

/**
 * Handle inline queries — @MiniMeSearchBot typed in any Telegram chat.
 * Returns up to 5 business results as inline article cards.
 * Uses keyword cache only (no GPT) to keep latency under 200ms.
 */
export async function handleSearchBotInline(token, inlineQuery) {
  const query = (inlineQuery.query || '').trim();
  const inlineQueryId = inlineQuery.id;

  async function answer(results) {
    await tg(token, 'answerInlineQuery', {
      inline_query_id: inlineQueryId,
      results,
      cache_time: 60,
      is_personal: false,
    });
  }

  // Empty query — show top-rated businesses
  let businesses = [];
  if (!query || query.length < 2) {
    businesses = await searchDirectory({ limit: 5 });
  } else {
    // Try keyword cache first (instant, no GPT)
    const kwCacheKey = normalizeQuery(query);
    const keywordHit = KEYWORD_CACHE[kwCacheKey];
    const parsed = keywordHit
      ? { category: keywordHit.category, keywords: keywordHit.keywords, location: null }
      : { category: null, keywords: [query.toLowerCase()], location: null };

    businesses = await searchDirectory({
      category: parsed.category,
      keywords: parsed.keywords,
      limit: 5,
    });

    // Semantic fallback if few results
    if (businesses.length < 2 && query.length >= 4) {
      const semantic = await semanticSearch(query, 5);
      if (semantic.length) businesses = mergeResults(businesses, semantic, 5);
    }
  }

  if (!businesses.length) {
    return answer([{
      type: 'article',
      id: 'no_results',
      title: 'No businesses found',
      description: `Nothing matched "${query}" yet — try @MiniMeSearchBot for more options`,
      input_message_content: {
        message_text: `🔍 Search "${query}" on MiniMe Search:\nt.me/MiniMeSearchBot`,
      },
    }]);
  }

  const articles = await Promise.all(businesses.map(async (biz, i) => {
    const catInfo = CATEGORY_LABELS[biz.category] || { emoji: '🏢', en: 'Business' };
    const ratingText = biz.total_reviews > 0
      ? `⭐ ${biz.average_rating}/5 (${biz.total_reviews})`
      : '⭐ New on MiniMe';
    const tagline = biz.tagline || (biz.description ? biz.description.slice(0, 80) : '');
    const loc = biz.location ? `📍 ${biz.location}` : '';
    const deepLink = contactUrlFor(biz, 'minime_search');

    const messageText =
      `${catInfo.emoji} *${biz.name}*${biz.verified ? ' ✅' : ''}\n` +
      (loc ? `${loc}\n` : '') +
      (tagline ? `💬 ${tagline}\n` : '') +
      `${ratingText}\n\n` +
      (deepLink ? `[💬 Chat now](${deepLink})` : '');

    const article = {
      type: 'article',
      id: biz.id || String(i),
      title: `${biz.name}${biz.verified ? ' ✅' : ''}`,
      description: `${catInfo.emoji} ${catInfo.en}${loc ? ' · ' + biz.location : ''}${tagline ? ' — ' + tagline : ''}`,
      input_message_content: {
        message_text: messageText,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      },
      reply_markup: deepLink ? {
        inline_keyboard: [[{
          text: `💬 Chat with ${biz.name}`,
          url: deepLink,
        }]],
      } : undefined,
    };

    const thumb = biz._matched_product?.image_url || biz.logo_url;
    if (thumb) article.thumbnail_url = thumb;

    return article;
  }));

  return answer(articles);
}
