/**
 * POST /api/onboarding/interview
 * Body: { message?: string }
 *
 * The conversational onboarding that lives inside the mini-app wizard.
 *
 * Persona: **Selam, a fictional first-time customer** texting the owner's
 * shop for the first time. The owner replies naturally to a "customer".
 * MiniMe watches in the background and:
 *   - Pipes each owner reply through `teachFromText` (products + brief)
 *   - Extracts voice signals from the owner's REAL customer-facing tone
 *     and merges them into `businesses.voice_embedding`
 *   - Returns short "captured items" tags that the UI renders as mint chips
 *     under the owner's just-sent reply (the live "MiniMe is learning"
 *     affordance — owner sees their catalog populating as they type)
 *
 * Why a fictional customer (not MiniMe-as-interviewer): even a warm
 * "tell me about your business" prompt is structurally a survey — the owner
 * senses the AI and never gets the "wow this works" hit. By having Selam
 * drive the chat, the owner literally DOES their job (reply to a customer),
 * so what we capture is exactly what production needs.
 *
 * State lives in `businesses.notification_prefs.onboarding_chat`:
 *   { turn, history: [{q,a}], captured, started_at, completed_at }
 *
 * Cap: MAX_TURNS total (the LLM can end earlier with done:true).
 *
 * Prerequisite: the shop name must already be set on `businesses.name` via
 * the wizard's pre-step (`StepShopName`). If the placeholder is still in
 * place we fall back to "your shop" in Selam's opener.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { teachFromText } from '../../../../lib/server/teaching';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';
import { MODEL_MINI } from '../../../../lib/server/constants';
import { supabase } from '../../../../lib/server/db';
import { str, ValidationError } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 4;

// Last-resort fallback if Selam's LLM call returns garbage. Stays in-character.
const FALLBACK_REPLY = "ok, and how about delivery — do you deliver?";

// Detect the auto-placeholder we set at lazy-create time so the opener can
// degrade gracefully if the owner skipped the shop-name pre-step somehow.
function isPlaceholderName(name) {
  if (!name) return true;
  const n = String(name).trim();
  if (!n) return true;
  if (n === 'My Business') return true;
  if (/'s Business$/.test(n)) return true; // "Phil's Business"
  return false;
}

/**
 * Selam's opening line on first mount. She references the shop name verbatim
 * (lowercased to feel like a real text). No emoji, casual, curious.
 */
function selamOpener(shopName) {
  if (!isPlaceholderName(shopName)) {
    return `hi! is this ${shopName}? what do you have?`;
  }
  return `hi! is this your shop? what do you have?`;
}

function getInterviewState(business) {
  return business?.notification_prefs?.onboarding_chat || null;
}

async function saveInterviewState(business, state) {
  const prefs = { ...(business.notification_prefs || {}), onboarding_chat: state };
  await supabase().from('businesses').update({ notification_prefs: prefs }).eq('id', business.id);
  business.notification_prefs = prefs;
}

async function countProducts(businessId) {
  const { count } = await supabase()
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);
  return count || 0;
}

/**
 * Merge new voice signals into business.voice_embedding (JSONB).
 *
 * Now the source is the owner's REAL customer-facing voice (they're replying
 * to Selam exactly the way they'd reply to a real shopper), so what lands
 * here is gold for `replyEngine.buildSystemPrompt` on day one.
 *
 * Schema (consumed by replyEngine.buildSystemPrompt):
 *   { tone: string, uniquePhrases: string[], greeting: { opener }, closings: string[], character: string }
 */
async function mergeVoiceSignals(business, signals) {
  if (!signals || typeof signals !== 'object') return;
  const cur = business.voice_embedding || {};
  const merged = { ...cur };

  if (signals.tone && typeof signals.tone === 'string') {
    merged.tone = signals.tone.slice(0, 120);
  }
  if (Array.isArray(signals.uniquePhrases)) {
    const existing = Array.isArray(cur.uniquePhrases) ? cur.uniquePhrases : [];
    const incoming = signals.uniquePhrases.filter(p => typeof p === 'string' && p.length > 0 && p.length < 80);
    const seen = new Set(existing.map(p => p.toLowerCase()));
    const out = [...existing];
    for (const p of incoming) {
      if (!seen.has(p.toLowerCase())) { out.push(p); seen.add(p.toLowerCase()); }
    }
    merged.uniquePhrases = out.slice(-12);
  }
  if (signals.character && typeof signals.character === 'string') {
    const prev = cur.character || '';
    const incoming = signals.character.slice(0, 200);
    if (!prev.toLowerCase().includes(incoming.toLowerCase().slice(0, 40))) {
      merged.character = (prev ? prev + ' · ' : '') + incoming;
      if (merged.character.length > 600) merged.character = merged.character.slice(-600);
    }
  }
  // The owner's FIRST greeting to a customer is precious — capture it once.
  if (signals.opener && typeof signals.opener === 'string' && !cur?.greeting?.opener) {
    merged.greeting = { ...(cur.greeting || {}), opener: signals.opener.slice(0, 80) };
  }
  // Sign-offs ("thanks", "welcome anytime") — accumulate the short ones.
  if (Array.isArray(signals.closings)) {
    const existing = Array.isArray(cur.closings) ? cur.closings : [];
    const incoming = signals.closings.filter(p => typeof p === 'string' && p.length > 0 && p.length < 40);
    const seen = new Set(existing.map(p => p.toLowerCase()));
    const out = [...existing];
    for (const p of incoming) {
      if (!seen.has(p.toLowerCase())) { out.push(p); seen.add(p.toLowerCase()); }
    }
    merged.closings = out.slice(-8);
  }

  if (JSON.stringify(merged) === JSON.stringify(cur)) return;
  await supabase().from('businesses').update({ voice_embedding: merged }).eq('id', business.id);
  business.voice_embedding = merged;
}

/**
 * Pull the most recently taught products so Selam's LLM call knows what the
 * owner has said so far — lets her acknowledge specifics ("ohh the brown
 * tote — what sizes?") and avoid asking about things already mentioned.
 */
async function recentProducts(businessId, limit = 8) {
  const { data } = await supabase()
    .from('products')
    .select('name, price_amount, currency, attributes')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []).map(p => ({
    name: (p.name || '').trim(),
    price: p.price_amount != null ? `${p.price_amount} ${p.currency || 'birr'}` : null,
  })).filter(p => p.name);
}

/**
 * One LLM call that does THREE things at once:
 *   1. Writes Selam's next message (in-character, casual, one thing per turn).
 *   2. Extracts captured-item tags from the owner's last reply for the UI chips.
 *   3. Extracts voice signals from the owner's last reply.
 *
 * Returns: { reply, captured_items, voice_signals, done }
 */
async function generateSelamReply(business, history, turn, shopName, products) {
  const shopLabel = isPlaceholderName(shopName) ? 'the shop' : shopName;
  const productList = products.length
    ? products.map(p => `  - ${p.name}${p.price ? ` (${p.price})` : ''}`).join('\n')
    : '  (none yet)';

  // Per-turn intent ramp. Selam is a real first-time customer — her questions
  // get more specific as she learns what the shop offers.
  const intent = (() => {
    if (turn <= 1) return 'opener — ask what they sell / what they have';
    if (turn === 2) return 'product specifics — colors, sizes, materials, prices, variants of something the owner just mentioned';
    if (turn === 3) return 'logistics — delivery zone, payment options, or hours';
    return 'warm close — say something like "ok perfect i\'ll come by" or "great, i\'ll order tomorrow" and SET done=true';
  })();

  const system = `You are **Selam**, a casual first-time customer in Addis Ababa who just opened a chat with ${shopLabel}. You are NOT an AI. You are NOT MiniMe. You never break character.

You are texting the shop the way a real shopper would on Telegram — short, lowercase ok, friendly, curious, never formal.

## How you talk
- 1 sentence per message, sometimes 2. Short. Casual.
- Lowercase is fine. No exclamation marks unless you're genuinely reacting.
- Words you might use naturally: "ohh", "nice", "ok", "great", "hmm", "got it", "actually", "wait".
- NO emoji. NO "as a customer". NO survey-style questions. NO "tell me about your business".
- NEVER say "AI", "MiniMe", "assistant", "bot", or hint that you're not a real person.
- NEVER repeat a question. NEVER ask about something the owner already told you.
- React to what the owner JUST said before asking your next thing. Use their own words.

## Your intent this turn (turn ${turn} of ${MAX_TURNS})
${intent}

Ask ONE thing. Just one. The kind of thing a real customer would actually want to know based on what's been said so far.

## What you already know about the shop
Shop name: ${shopLabel}
Products taught so far:
${productList}

If the products list is empty, you don't know what they sell yet — your reply should be the opener.

## Examples of good Selam messages (study the vibe)
- "hi! is this habesha leather? what do you have?"
- "ohh leather totes nice. what colors do you have?"
- "ok and how much is the brown one?"
- "do you deliver to bole? how much for that?"
- "can i pay on delivery or only cash?"
- "perfect, i'll come by tomorrow then. thanks!"

## Examples of BAD messages (never do this)
- "Tell me about your business." ← survey-style
- "What makes you different from competitors?" ← no real customer asks this
- "I'm a customer interested in learning about your offerings." ← robot
- "Great! Amazing!" ← cheerleader / AI tell
- "🛍️" ← emoji
- "As a first-time customer, I'd love to..." ← breaks character

## Also extract (silently, for the UI — never mention in your reply)
On EVERY turn analyse the OWNER's last reply (not yours) and return:

1. **captured_items**: 0–3 SHORT tags summarising what the owner just revealed, in plain customer-language. Examples:
   - ["Leather tote – 3200 birr", "Brown / black"]
   - ["Delivers to Bole – 100 birr"]
   - ["Pay on delivery"]
   Each tag max ~30 chars. Empty array if nothing new.

2. **voice_signals** — to mirror the owner's voice in production replies:
   - "tone": one short descriptor of their texting vibe ("warm and casual, mixes amharic", "professional and concise", "playful, uses lots of welcome")
   - "uniquePhrases": 0-3 short verbatim phrases or signature words they actually used you'd want to mirror (max ~6 words each)
   - "opener": their very first greeting word/phrase if they used one (e.g. "welcome", "hi dear"), empty otherwise
   - "closings": any sign-off words ("thanks", "welcome anytime"), 0-2
   - "character": one short personality note if something stands out, empty string otherwise

## When to end
On turn ${MAX_TURNS} OR when you've learned enough (catalog + prices + delivery + a small trust signal), set done=true AND make your reply a warm in-character close ("perfect, i'll come by tomorrow then. thanks!").

## Output — return ONLY valid JSON
{
  "reply": "your short in-character text",
  "captured_items": ["...", "..."],
  "voice_signals": { "tone": "...", "uniquePhrases": [...], "opener": "...", "closings": [...], "character": "..." },
  "done": false
}`;

  const transcript = history
    .map(h => `Selam: ${h.q}\nOwner: ${h.a || '(no reply yet)'}`)
    .join('\n\n');
  const lastAnswer = history.length > 0 ? history[history.length - 1]?.a : '';
  const userMessage = `Chat so far:\n${transcript}\n\nThe owner just replied: "${lastAnswer || ''}"\n\nWrite Selam's next short in-character message AND extract captured_items + voice_signals from the owner's reply.`;

  try {
    const res = await loggedCompletion({
      route: 'onboarding_interview',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0.75,
      max_tokens: 320,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const reply = typeof raw.reply === 'string' ? raw.reply.trim() : '';
    const done = raw.done === true;
    const captured_items = Array.isArray(raw.captured_items)
      ? raw.captured_items.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().slice(0, 60)).slice(0, 3)
      : [];
    const voice_signals = raw.voice_signals && typeof raw.voice_signals === 'object' ? raw.voice_signals : {};

    // Guard: don't repeat a previous Selam message verbatim.
    const priorReplies = history.map(h => (h.q || '').trim().toLowerCase().slice(0, 40));
    if (!reply || reply.length < 3 || priorReplies.includes(reply.toLowerCase().slice(0, 40))) {
      return { reply: FALLBACK_REPLY, captured_items, voice_signals, done };
    }
    return { reply, captured_items, voice_signals, done };
  } catch (e) {
    console.warn('[onboarding/interview] LLM failed, using fallback:', e.message);
    return { reply: FALLBACK_REPLY, captured_items: [], voice_signals: {}, done: false };
  }
}

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let message;
  try {
    message = str(body.message, { field: 'message', max: 3000, required: false }) || '';
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Find or lazily create the business (idempotent). The shop name is set
  // separately by the wizard's pre-step (`StepShopName`) — but we still need
  // a row to exist so state writes work, so we lazy-create with a placeholder
  // that the pre-step overwrites.
  let business = await findByOwnerTelegramId(tg.id);
  if (!business) {
    const ownerName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null;
    business = await createBusiness({
      owner_telegram_id: tg.id,
      owner_name: ownerName,
      name: tg.first_name ? `${tg.first_name}'s Business` : 'My Business',
      workspace_type: 'business',
      onboarding_completed: false,
      brain_mode: true,
      trust_level: 2,
      shop_code: generateShopCode(),
    });
    if (!business) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  const opener = selamOpener(business.name);

  let state = getInterviewState(business) || {
    turn: 0,
    history: [],
    captured: {},
    started_at: Date.now(),
  };

  // ── First call: no message → return Selam's opener, do NOT teach. ───────────
  if (!message.trim()) {
    if (state.turn === 0 && state.history.length === 0) {
      state = { ...state, turn: 0, started_at: Date.now(), history: [{ q: opener, a: null }] };
      await saveInterviewState(business, state);
    }
    const pendingQ = state.history.length > 0 && !state.history[state.history.length - 1]?.a
      ? state.history[state.history.length - 1].q
      : opener;
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: pendingQ,
      question: pendingQ,
      captured: state.captured || {},
      captured_items: [],
      products_added: 0,
      total_products,
      business_name: isPlaceholderName(business.name) ? null : business.name,
      turn: state.turn,
      max_turns: MAX_TURNS,
      done: false,
    });
  }

  // ── Subsequent calls: owner just replied to Selam. ──────────────────────────
  const lastQuestion = state.history.length > 0 && !state.history[state.history.length - 1]?.a
    ? state.history[state.history.length - 1].q
    : (state.history[state.history.length - 1]?.q || opener);

  // Record this Q/A.
  const history = [...state.history];
  if (history.length > 0 && !history[history.length - 1]?.a) {
    history[history.length - 1] = { q: lastQuestion, a: message.slice(0, 1000) };
  } else {
    history.push({ q: lastQuestion, a: message.slice(0, 1000) });
  }

  const nextTurn = state.turn + 1;

  // SPEED: previously we ran teachFromText FIRST (one LLM call, sometimes 2),
  // THEN generated Selam's reply (another LLM call) — two sequential round
  // trips per owner turn = 6-10 seconds on Addis mobile networks, and the
  // single biggest reason owners bailed mid-Selam (36% drop measured in the
  // last 24h). The two calls are independent, so run them in parallel.
  // Products list for Selam reflects state BEFORE this turn — close enough
  // for the next question; the new product shows up on turn N+1.
  const productsBeforeTurn = await recentProducts(business.id, 8);

  const [teachRes, selamRes] = await Promise.all([
    teachFromText(business.id, `Customer: ${lastQuestion}\nShop: ${message}`).catch(e => {
      console.warn('[onboarding/interview] teachFromText failed:', e.message);
      return null;
    }),
    generateSelamReply(business, history, nextTurn, business.name, productsBeforeTurn),
  ]);
  const products_added = teachRes?.products_added || 0;
  let { reply, captured_items, voice_signals, done } = selamRes;

  // Force-end if we hit the turn cap (LLM should have ended already; safety net).
  if (nextTurn >= MAX_TURNS) done = true;

  // Merge voice signals into businesses.voice_embedding. Fire-and-forget —
  // production replies only need it next turn at the earliest, no reason to
  // make the owner wait for this DB round-trip.
  mergeVoiceSignals(business, voice_signals).catch(e =>
    console.warn('[onboarding/interview] mergeVoiceSignals failed:', e.message)
  );

  // Merge captured tags into the long-lived strip state.
  const captured = { ...(state.captured || {}) };
  if (products_added > 0 || captured_items.length > 0) captured.catalog = true;
  if (voice_signals && (voice_signals.tone || voice_signals.uniquePhrases?.length)) captured.voice = true;
  // Lightweight keyword sniff on the captured_items so the chips strip can
  // surface delivery/FAQ without needing a separate classifier round-trip.
  for (const tag of captured_items) {
    const t = tag.toLowerCase();
    if (t.includes('deliver') || t.includes('bole') || t.includes('birr') && t.includes('delivery')) captured.delivery = true;
    if (t.includes('pay') || t.includes('hour') || t.includes('open') || t.includes('return')) captured.faq = true;
  }

  if (done) {
    state = { ...state, turn: nextTurn, history, captured, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply,
      question: reply,
      captured,
      captured_items,
      products_added,
      total_products,
      business_name: isPlaceholderName(business.name) ? null : business.name,
      turn: nextTurn,
      max_turns: MAX_TURNS,
      done: true,
    });
  }

  history.push({ q: reply, a: null });
  state = { ...state, turn: nextTurn, history, captured };
  await saveInterviewState(business, state);
  const total_products = await countProducts(business.id);

  return NextResponse.json({
    reply,
    question: reply,
    captured,
    captured_items,
    products_added,
    total_products,
    business_name: isPlaceholderName(business.name) ? null : business.name,
    turn: nextTurn,
    max_turns: MAX_TURNS,
    done: false,
  });
}
