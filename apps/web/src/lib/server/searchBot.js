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
 * Returns array of businesses with their bot username and key info.
 */
async function searchDirectory({ category, keywords = [], location, limit = 5 }) {
  const sb = supabase();
  let q = sb
    .from('businesses')
    .select('id, name, description, category, tags, location, address, telegram_bot_username, search_count')
    .eq('b2b_discoverable', true)
    .not('telegram_bot_username', 'is', null)
    .order('search_count', { ascending: false })
    .limit(limit * 3); // over-fetch for filtering

  if (category) q = q.eq('category', category);
  if (location) q = q.ilike('location', `%${location}%`);

  const { data, error } = await q;
  if (error) { console.error('[search-bot] query error:', error.message); return []; }
  if (!data?.length) return [];

  // Keyword filter: match tags or description (client-side for flexibility)
  let results = data;
  if (keywords.length) {
    const kws = keywords.map(k => k.toLowerCase());
    results = results.filter(b => {
      const haystack = [
        b.name, b.description, b.category,
        ...(Array.isArray(b.tags) ? b.tags : []),
      ].join(' ').toLowerCase();
      return kws.some(k => haystack.includes(k));
    });
    // If keyword filter leaves nothing, fall back to unfiltered
    if (!results.length) results = data;
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
      match_threshold: 0.3,
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
 * Format a list of businesses as a Telegram message.
 */
function formatResults(businesses, queryText) {
  if (!businesses.length) return null;
  const lines = [];
  businesses.forEach((b, i) => {
    const num = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i] || `${i + 1}.`;
    const loc = b.location ? `\n   📍 ${b.location}` : '';
    const desc = b.description ? `\n   💬 ${b.description.slice(0, 100)}${b.description.length > 100 ? '…' : ''}` : '';
    const tags = Array.isArray(b.tags) && b.tags.length
      ? `\n   🏷️ ${b.tags.slice(0, 4).join(', ')}`
      : '';
    const link = b.telegram_bot_username
      ? `\n   👉 @${b.telegram_bot_username}`
      : '';
    lines.push(`${num} *${b.name}*${loc}${desc}${tags}${link}`);
  });
  return `🔍 Found *${businesses.length}* business${businesses.length > 1 ? 'es' : ''} matching "${queryText}":\n\n${lines.join('\n\n')}\n\n_Tap any @username to chat with their bot instantly!_`;
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
      text: `👋 Welcome to *MiniMe Search*!\n\nI help you find Ethiopian businesses with AI-powered bots. Just tell me what you're looking for:\n\n• *"I need a laptop under 30k"*\n• *"Branding company in Bole"*\n• *"Best caterer for my wedding"*\n• *"Show me all photographers"*\n\nType anything — English or Amharic — and I'll find the right business for you! 🚀`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 Browse all categories', callback_data: 'sb:categories' }],
          [{ text: '🏢 Who\'s on MiniMe?', callback_data: 'sb:all' }],
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
    const reply = formatResults(results, 'MiniMe businesses');
    if (reply) {
      await tg(token, 'sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: reply });
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
    // Log failed search — tells us what to recruit next
    const catHint = parsed.category
      ? ` in _${catLabel(parsed.category)}_`
      : '';
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `😔 I couldn't find any businesses matching *"${text}"*${catHint} on MiniMe yet.\n\nMiniMe is growing — we'll have more businesses soon! Want to explore other categories?`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📂 Browse categories', callback_data: 'sb:categories' }],
        ],
      },
    });
    return;
  }

  const reply = formatResults(results, text);
  await tg(token, 'sendMessage', {
    chat_id: chatId,
    parse_mode: 'Markdown',
    text: reply,
    disable_web_page_preview: true,
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

  if (data === 'sb:all') {
    const results = await searchDirectory({ limit: 5 });
    const reply = formatResults(results, 'all businesses');
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: reply || 'No businesses listed yet. Check back soon!',
      disable_web_page_preview: true,
    });
  }
}
