/**
 * MiniMe Search Bot — natural language business directory search.
 *
 * Handles messages from @MiniMeSearchBot (a single public bot, not per-tenant).
 * Any customer can search for businesses on the MiniMe network.
 *
 * Flow: parse query → match businesses → return formatted results with deep links
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { loggedCompletion } from './openai-wrapper';
import { MODEL_MINI, EMBED_MODEL } from './constants';

const MINIAPP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app';

let _embedClient;
function embedClient() {
  if (!_embedClient) _embedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });
  return _embedClient;
}

// Category labels with Amharic translations for better search parsing
const CATEGORY_LABELS = {
  branding_design:       { en: 'Branding & Design',        am: 'ብራንዲንግ እና ዲዛይን' },
  printing_signage:      { en: 'Printing & Signage',       am: 'ማተሚያ እና ምልክት' },
  photography_video:     { en: 'Photography & Video',      am: 'ፎቶግራፊ እና ቪዲዮ' },
  catering_food:         { en: 'Catering & Food',          am: 'ምግብ ዝግጅት' },
  food_beverage:         { en: 'Restaurants & Cafés',      am: 'ምግብ ቤቶች እና ካፌ' },
  it_tech:               { en: 'IT & Tech',                am: 'ቴክኖሎጂ' },
  events_entertainment:  { en: 'Events & Entertainment',   am: 'ዝግጅት እና መዝናኛ' },
  clothing_fashion:      { en: 'Clothing & Fashion',       am: 'አልባሳት እና ፋሽን' },
  beauty_wellness:       { en: 'Beauty & Wellness',        am: 'ውበት እና ጤና' },
  construction_interior: { en: 'Construction & Interior',  am: 'ግንባታ እና ውስጠ-ማስዋብ' },
  transport_delivery:    { en: 'Transport & Delivery',     am: 'ትራንስፖርት እና ዲሊቨሪ' },
  training_consulting:   { en: 'Training & Consulting',    am: 'ስልጠና እና አማካሪ' },
  wholesale_supply:      { en: 'Wholesale & Supply',       am: 'ጅምላ አቅርቦት' },
  electronics_phones:    { en: 'Electronics & Phones',     am: 'ኤሌክትሮኒክስ እና ስልክ' },
  other:                 { en: 'Other',                    am: 'ሌላ' },
};

// Helper to get English label
function catLabel(id) {
  return CATEGORY_LABELS[id]?.en || id;
}

const CATEGORY_LIST = Object.entries(CATEGORY_LABELS)
  .map(([id, { en, am }]) => `${id} — ${en} (${am})`)
  .join('\n');

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
 * Parse a natural language search query into structured params.
 * Returns { intent, category, keywords, location, budget }
 */
async function parseQuery(text) {
  try {
    const res = await loggedCompletion({
      route: 'search_parse',
      model: MODEL_MINI,
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You parse business search queries for an Ethiopian SMB directory.
Queries may be in English or Amharic.
Extract:
- intent: "find_product" | "find_service" | "browse_category" | "list_all" | "help"
- category: one of these IDs (or null):
${Object.entries(CATEGORY_LABELS).map(([id, { en, am }]) => `  ${id} — ${en} / ${am}`).join('\n')}
- keywords: array of specific product/service terms (lowercase English, e.g. ["laptop", "repair"])
- location: city/area mentioned (e.g. "Bole", "Piazza", "Addis Ababa", "ቦሌ") or null
- budget: price constraint if mentioned (e.g. "under 30000") or null
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
 * Search the businesses table for matching visible businesses.
 * Also searches the products table so queries like "leather bag" or
 * "injera catering" match businesses even if the product name isn't
 * in the business description or tags.
 */
async function searchDirectory({ category, keywords = [], location, limit = 5 }) {
  const sb = supabase();
  let q = sb
    .from('businesses')
    .select('id, name, description, category, tags, location, address, telegram_bot_username, search_count')
    .eq('b2b_discoverable', true)
    .not('telegram_bot_username', 'is', null)
    .order('search_count', { ascending: false })
    .limit(limit * 4); // over-fetch for product-match merging

  if (category) q = q.eq('category', category);
  if (location) q = q.ilike('location', `%${location}%`);

  const { data, error } = await q;
  if (error) { console.error('[search-bot] query error:', error.message); return []; }
  if (!data?.length) return [];

  let results = data;

  if (keywords.length) {
    const kws = keywords.map(k => k.toLowerCase());

    // 1. Match against business profile fields
    const profileMatches = results.filter(b => {
      const haystack = [
        b.name, b.description, b.category,
        ...(Array.isArray(b.tags) ? b.tags : []),
      ].join(' ').toLowerCase();
      return kws.some(k => haystack.includes(k));
    });

    // 2. Match against products table — catches "I need injera" → catering business
    let productMatchIds = new Set();
    try {
      // Only search name + description (no category column on products table)
      const orFilter = kws.map(k => `name.ilike.%${k}%,description.ilike.%${k}%,name_am.ilike.%${k}%`).join(',');
      const { data: productHits } = await sb
        .from('products')
        .select('business_id')
        .eq('is_active', true)
        .or(orFilter)
        .limit(20);
      if (productHits?.length) {
        productHits.forEach(p => productMatchIds.add(p.business_id));
      }
    } catch (e) { console.warn('[search-bot] product search error:', e.message); }

    // 3. Also match against sample_replies triggers for businesses in our set
    // (handles "do you deliver?" → business with delivery in sample_replies)
    let replyMatchIds = new Set();
    try {
      const businessIds = results.map(b => b.id);
      const { data: bizWithReplies } = await sb
        .from('businesses')
        .select('id, sample_replies, owner_instructions')
        .in('id', businessIds);
      if (bizWithReplies?.length) {
        bizWithReplies.forEach(b => {
          const replyText = [
            ...(b.sample_replies || []).map(r => `${r.trigger || ''} ${r.reply || ''} ${r.question || ''}`),
            ...(b.owner_instructions || []).map(r => r.content || r.instruction || r.rule || ''),
          ].join(' ').toLowerCase();
          if (kws.some(k => replyText.includes(k))) replyMatchIds.add(b.id);
        });
      }
    } catch {}

    // Merge: profile matches first, then product/reply matches
    const extraIds = new Set([...productMatchIds, ...replyMatchIds]);
    const profileIds = new Set(profileMatches.map(b => b.id));

    // Fetch businesses matched via products that weren't in the initial pull
    // (they might have been outside the initial LIMIT or category filter)
    const missingIds = [...extraIds].filter(id => !profileIds.has(id));
    let extraBusinesses = [];
    if (missingIds.length) {
      try {
        const { data: fetched } = await sb
          .from('businesses')
          .select('id, name, description, category, tags, location, address, telegram_bot_username, search_count')
          .eq('b2b_discoverable', true)
          .not('telegram_bot_username', 'is', null)
          .in('id', missingIds);
        extraBusinesses = fetched || [];
      } catch {}
    }

    // Also include in-results extras (matched by reply scan)
    const inResultsExtras = results.filter(b => extraIds.has(b.id) && !profileIds.has(b.id));
    const merged = [...profileMatches, ...extraBusinesses, ...inResultsExtras];
    results = merged.length > 0 ? merged : data; // fall back to all if nothing matched
  }

  // Increment search_count for matched businesses (fire-and-forget)
  const ids = results.slice(0, limit).map(b => b.id);
  if (ids.length) {
    sb.rpc('increment_search_count', { business_ids: ids }).catch(() => {
      // Fallback: individual updates if RPC not available
      ids.forEach(id => {
        sb.from('businesses')
          .update({ search_count: (results.find(b => b.id === id)?.search_count || 0) + 1 })
          .eq('id', id)
          .then(() => {}).catch(() => {});
      });
    });
  }

  return results.slice(0, limit);
}

/**
 * Semantic search using pgvector embeddings.
 * Falls back gracefully if embeddings aren't set up yet.
 */
async function semanticSearch(queryText, limit = 5) {
  try {
    const r = await embedClient().embeddings.create({
      model: EMBED_MODEL,
      input: [queryText.slice(0, 2000)],
    });
    const { data, error } = await supabase().rpc('match_businesses_by_search', {
      query_embedding: r.data[0].embedding,
      match_threshold: 0.25,
      match_count: limit,
    });
    if (error) { console.warn('[search-bot] semantic error:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('[search-bot] semantic fail:', e.message);
    return [];
  }
}

/**
 * Merge keyword results with semantic results, deduplicating by ID.
 * Keyword results come first (they matched explicitly), then semantic extras.
 */
function mergeResults(keywordResults, semanticResults, limit = 5) {
  const seen = new Set(keywordResults.map(b => b.id));
  const merged = [...keywordResults];
  for (const b of semanticResults) {
    if (!seen.has(b.id) && merged.length < limit) {
      seen.add(b.id);
      merged.push(b);
    }
  }
  return merged.slice(0, limit);
}

/**
 * Fetch top products for a business (for display in search results).
 */
async function getTopProducts(businessId, limit = 3) {
  try {
    const { data } = await supabase()
      .from('products')
      .select('name, price, currency, name_am')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  } catch { return []; }
}

/**
 * Format a list of businesses as a Telegram message with inline "Chat" buttons.
 * Each business gets its own message card for clean formatting on mobile.
 */
async function formatResults(businesses, queryText) {
  if (!businesses.length) return null;

  // Build a single message with all businesses + one inline keyboard row per business
  const lines = [];
  const keyboard = [];

  for (let i = 0; i < businesses.length; i++) {
    const b = businesses[i];
    const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i] || `${i + 1}.`;
    const loc  = b.location ? `\n   📍 ${b.location}` : '';
    const desc = b.description
      ? `\n   💬 ${b.description.slice(0, 90)}${b.description.length > 90 ? '…' : ''}`
      : '';

    // Top products with prices
    let productLine = '';
    const products = await getTopProducts(b.id, 3);
    if (products.length) {
      const pList = products.map(p => {
        const price = p.price != null ? ` — ${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
        return `${p.name}${price}`;
      }).join(', ');
      productLine = `\n   🛍️ ${pList}`;
    } else if (Array.isArray(b.tags) && b.tags.length) {
      productLine = `\n   🏷️ ${b.tags.slice(0, 4).join(', ')}`;
    }

    lines.push(`${num} *${b.name}*${loc}${desc}${productLine}`);

    // Inline button for each business — deep link tracks referral
    if (b.telegram_bot_username) {
      keyboard.push([{
        text: `💬 Chat with ${b.name}`,
        url: `https://t.me/${b.telegram_bot_username}?start=minime_search`,
      }]);
    }
  }

  return {
    text: `🔍 Found *${businesses.length}* business${businesses.length > 1 ? 'es' : ''} for _"${queryText}"_:\n\n${lines.join('\n\n')}`,
    reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
  };
}

/**
 * Main handler — called for every message to the search bot.
 */
export async function handleSearchBotUpdate(token, update) {
  const msg = update.message || update.edited_message;
  if (!msg?.text) return; // ignore non-text updates

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
          [
            { text: '🎨 Branding',       callback_data: 'sb:cat:branding_design' },
            { text: '📸 Photography',    callback_data: 'sb:cat:photography_video' },
          ],
          [
            { text: '💻 IT & Tech',      callback_data: 'sb:cat:it_tech' },
            { text: '📱 Electronics',    callback_data: 'sb:cat:electronics_phones' },
          ],
          [
            { text: '🍽️ Catering',      callback_data: 'sb:cat:catering_food' },
            { text: '☕ Restaurants',    callback_data: 'sb:cat:food_beverage' },
          ],
          [
            { text: '👗 Fashion',        callback_data: 'sb:cat:clothing_fashion' },
            { text: '💆 Beauty',         callback_data: 'sb:cat:beauty_wellness' },
          ],
          [
            { text: '🏗️ Construction', callback_data: 'sb:cat:construction_interior' },
            { text: '🚚 Transport',      callback_data: 'sb:cat:transport_delivery' },
          ],
          [
            { text: '🖨️ Printing',      callback_data: 'sb:cat:printing_signage' },
            { text: '🎉 Events',         callback_data: 'sb:cat:events_entertainment' },
          ],
          [{ text: '🏢 All businesses on MiniMe', callback_data: 'sb:all' }],
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
      text: `*MiniMe Search — Help*\n\n🔍 *Search examples:*\n• "Find a printer in Piazza"\n• "Catering for 50 people"\n• "Laptop repair near Mexico"\n• "ብራንዲንግ ኩባንያ"\n\n📂 *Browse categories:*\n• "Show all photographers"\n• "List electronics shops"\n• "What categories are there?"\n\n💡 Results include a direct link to each business bot — tap to chat instantly!`,
    });
    return;
  }

  // ── Show categories ────────────────────────────────────────────────────────
  if (/categor|what.*there|browse|list all|ምድብ/i.test(text) || text === 'categories') {
    const catText = Object.entries(CATEGORY_LABELS)
      .map(([, { en, am }]) => `• ${en} / ${am}`)
      .join('\n');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `📂 *MiniMe Categories:*\n\n${catText}\n\nJust tell me which one you need!`,
    });
    return;
  }

  // ── Natural language search ────────────────────────────────────────────────
  // Show typing indicator
  tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  // Log search (fire-and-forget)
  const logSearch = async (parsed, resultsCount, profileIds) => {
    try {
      await supabase().from('search_logs').insert({
        searcher_telegram_id: senderId,
        raw_query: text,
        parsed_intent: parsed,
        results_count: resultsCount,
        results_profile_ids: profileIds,
        language: /[ሀ-፿]/.test(text) ? 'am' : 'en',
      });
    } catch {} // table may not exist yet
  };

  const parsed = await parseQuery(text);

  // "who's on minime" / list all
  if (parsed.intent === 'list_all' || /who.*minime|all.*business|everyone/i.test(text)) {
    const results = await searchDirectory({ limit: 5 });
    const reply = await formatResults(results, 'MiniMe businesses');
    if (reply) {
      await tg(token, 'sendMessage', { chat_id: chatId, parse_mode: 'Markdown', disable_web_page_preview: true, ...reply });
      await logSearch(parsed, results.length, results.map(b => b.id));
    } else {
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'No businesses are listed yet. Check back soon!' });
    }
    return;
  }

  let results = await searchDirectory({
    category: parsed.category,
    keywords: parsed.keywords || [],
    location: parsed.location,
    limit: 5,
  });

  // If keyword search returned few results, enhance with semantic search
  if (results.length < 3) {
    const semantic = await semanticSearch(text, 5);
    if (semantic.length) results = mergeResults(results, semantic, 5);
  }

  await logSearch(parsed, results.length, results.map(b => b.id));

  if (!results.length) {
    const catHint = parsed.category ? ` in _${catLabel(parsed.category)}_` : '';
    // Save to waitlist so we can notify when a matching business joins
    try {
      await supabase().from('search_waitlist').insert({
        searcher_telegram_id: senderId,
        raw_query: text,
        parsed_category: parsed.category || null,
        keywords: parsed.keywords || [],
      });
    } catch {} // table may not exist yet — non-blocking

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

  const reply = await formatResults(results, text);
  await tg(token, 'sendMessage', {
    chat_id: chatId,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...(reply || { text: 'Something went wrong. Try again!' }),
  });
}

/**
 * Handle inline button callbacks from the search bot.
 */
export async function handleSearchBotCallback(token, callbackQuery) {
  const { data, message } = callbackQuery;
  const chatId = message?.chat?.id;
  if (!chatId) return;

  await tg(token, 'answerCallbackQuery', { callback_query_id: callbackQuery.id });

  if (data === 'sb:categories') {
    const catText = Object.entries(CATEGORY_LABELS).map(([, { en, am }]) => `• ${en} / ${am}`).join('\n');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `📂 *Categories on MiniMe:*\n\n${catText}\n\nJust type what you're looking for!`,
    });
    return;
  }

  // Category quick-tap from /start screen
  if (data?.startsWith('sb:cat:')) {
    const catId = data.replace('sb:cat:', '');
    const catInfo = CATEGORY_LABELS[catId];
    if (!catInfo) return;
    tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    const results = await searchDirectory({ category: catId, limit: 5 });
    const reply = await formatResults(results, catInfo.en);
    if (reply) {
      await tg(token, 'sendMessage', {
        chat_id: chatId, parse_mode: 'Markdown', disable_web_page_preview: true, ...reply,
      });
    } else {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        parse_mode: 'Markdown',
        text: `😔 No *${catInfo.en}* businesses on MiniMe yet.\n\nTry a different category or search by typing what you need!`,
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'sb:start' }]] },
      });
    }
    return;
  }

  // Back to start
  if (data === 'sb:start') {
    await tg(token, 'sendMessage', {
      chat_id: chatId, text: 'Type what you\'re looking for, or use /start to see categories.',
    });
    return;
  }

  if (data === 'sb:all') {
    const results = await searchDirectory({ limit: 5 });
    const reply = await formatResults(results, 'all businesses');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...(reply || { text: 'No businesses listed yet. Check back soon!' }),
    });
  }
}
