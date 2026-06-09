/**
 * POST /api/onboarding/interview
 * Body: { message?: string }
 *
 * The conversational onboarding interview that lives inside the mini-app wizard.
 *
 * Flow (human, not survey):
 *   - Turn 0 (seed)        → MiniMe says hi and asks the owner's BUSINESS NAME.
 *   - Turn 1 (name → save) → Extract the name, save it to `businesses.name`,
 *                            warmly acknowledge it, then ask the first real
 *                            question about what they sell.
 *   - Turns 2..MAX_TURNS   → Tailored conversation. Each turn pipes the answer
 *                            through `teachFromText` AND extracts voice signals
 *                            (tone, signature phrases, character notes) which
 *                            are merged into `businesses.voice_embedding` so the
 *                            production reply engine can mirror the owner's
 *                            real personality.
 *
 * State lives in `businesses.notification_prefs.onboarding_chat`:
 *   { turn, history: [{q,a}], captured, started_at, completed_at, name_set }
 *
 * Cap: MAX_TURNS total (the LLM can choose to end earlier with done:true).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, update as updateBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { teachFromText } from '../../../../lib/server/teaching';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';
import { MODEL_MINI } from '../../../../lib/server/constants';
import { supabase } from '../../../../lib/server/db';
import { str, ValidationError } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 6;

// Warm sign-off when the conversation is done.
const COMPLETION_REPLY = "Perfect — I think I've got a real feel for you and your business now 🙌 Let's see me in action — message me like one of your customers on the next screen.";

// Last-resort fallback if the LLM returns garbage.
const FALLBACK_REPLY = "Tell me more — what else should your customers know?";

// Seed greeting. We use the owner's first name (from Telegram) when we have it,
// so it doesn't feel like talking to a kiosk. Always asks for business name.
function seedGreeting(ownerFirstName) {
  const hi = ownerFirstName
    ? `Hey ${ownerFirstName}! 👋`
    : `Hey there! 👋`;
  return `${hi} I'm MiniMe — I'll be the one chatting to your customers when you can't. Before we start, what's the name of your business?`;
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
 * Schema (consumed by replyEngine.buildSystemPrompt):
 *   { tone: string, uniquePhrases: string[], greeting: { opener }, closings: string[], character: string }
 */
async function mergeVoiceSignals(business, signals) {
  if (!signals || typeof signals !== 'object') return;
  const cur = business.voice_embedding || {};
  const merged = { ...cur };

  if (signals.tone && typeof signals.tone === 'string') {
    // Latest tone wins (it's a short descriptor; accumulating doesn't help).
    merged.tone = signals.tone.slice(0, 120);
  }
  if (Array.isArray(signals.uniquePhrases)) {
    const existing = Array.isArray(cur.uniquePhrases) ? cur.uniquePhrases : [];
    const incoming = signals.uniquePhrases.filter(p => typeof p === 'string' && p.length > 0 && p.length < 80);
    // De-dupe (case-insensitive), cap at 12 to keep prompt sane.
    const seen = new Set(existing.map(p => p.toLowerCase()));
    const out = [...existing];
    for (const p of incoming) {
      if (!seen.has(p.toLowerCase())) { out.push(p); seen.add(p.toLowerCase()); }
    }
    merged.uniquePhrases = out.slice(-12);
  }
  if (signals.character && typeof signals.character === 'string') {
    // Append (with a separator) so we accumulate personality notes over the convo.
    const prev = cur.character || '';
    const incoming = signals.character.slice(0, 200);
    if (!prev.toLowerCase().includes(incoming.toLowerCase().slice(0, 40))) {
      merged.character = (prev ? prev + ' · ' : '') + incoming;
      // Hard cap so this doesn't grow unbounded.
      if (merged.character.length > 600) merged.character = merged.character.slice(-600);
    }
  }
  if (signals.opener && typeof signals.opener === 'string' && !cur?.greeting?.opener) {
    merged.greeting = { ...(cur.greeting || {}), opener: signals.opener.slice(0, 80) };
  }

  // Only write if something changed.
  if (JSON.stringify(merged) === JSON.stringify(cur)) return;
  await supabase().from('businesses').update({ voice_embedding: merged }).eq('id', business.id);
  business.voice_embedding = merged;
}

/**
 * Extract a clean business name from the owner's free-text answer.
 * Returns null if we can't confidently get one (so we don't overwrite with garbage).
 */
async function extractBusinessName(business, rawAnswer) {
  const trimmed = rawAnswer.trim();
  // Fast path: if the answer is short and looks like a name, use it as-is.
  if (trimmed.length > 0 && trimmed.length <= 40 && !/[?!.,;:]$/.test(trimmed) && trimmed.split(/\s+/).length <= 6) {
    return trimmed;
  }
  // Otherwise ask the LLM to pull just the name out ("My shop is called Habesha Leather" → "Habesha Leather").
  try {
    const res = await loggedCompletion({
      route: 'onboarding_name_extract',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract ONLY the business / shop / brand name from the owner\'s message. If the message has no clear name, return "". Return JSON: {"name": "..."}' },
        { role: 'user', content: rawAnswer.slice(0, 500) },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name && name.length <= 60) return name;
  } catch (e) {
    console.warn('[onboarding/interview] name extract failed:', e.message);
  }
  return null;
}

/**
 * One LLM call that does TWO things at once:
 *   1. Writes MiniMe's next conversational reply (warm reaction + tailored question).
 *   2. Extracts voice signals from the owner's most recent answer.
 *
 * Returns: { reply, captured_delta, voice_signals, done }
 */
async function generateNextReply(business, history, turn, businessName) {
  const nameLabel = businessName ? `"${businessName}"` : 'their business';
  const system = `You are MiniMe, an AI assistant getting to know a small-business owner in Ethiopia. The business is called ${nameLabel}.

Your job is to learn them WELL enough that you can text their customers tomorrow and sound exactly like them.

## How to talk
Write like a sharp, warm friend — NEVER like a survey form.

Each reply has two natural parts blended into 1-2 short sentences:
  1. A SPECIFIC genuine reaction to what they just said (use their own words; refer to the business name when it fits naturally). Examples:
     - "Habesha Leather — I love that name! ✨"
     - "Ohh, a catering service — that's such a nice vibe!"
     - "Honey from Tigray, beautiful. People go wild for raw honey."
  2. The single most useful follow-up question, tailored to THIS specific business.

## Hard rules
- 1-2 sentences MAX. No bullet points. No "Great!" filler. No corporate phrases.
- Use the owner's actual words and emoji style. If they're casual, be casual. If they use Amharic words, sprinkle one back when natural.
- TAILOR every question. Leather → materials/custom/sizes/prices. Food → menu/delivery zones/prices. Never ask about unrelated products.
- Don't repeat ground already covered.
- When you have enough to chat with their customers (catalog + prices + delivery + their vibe), set done=true.
- Turn ${turn} of ${MAX_TURNS}. The earlier you can finish, the better.

## Coverage priority
  1. Products/services WITH PRICES
  2. Delivery / how customers order & pay
  3. What makes them different
  4. Common FAQs (hours, location, custom orders)

## Voice signals (mandatory)
On EVERY turn, also analyse the owner's last message for tone & personality and return:
  - "tone": one short descriptor of their vibe so far (e.g. "warm, casual, uses emojis", "professional and concise", "playful, mixes Amharic")
  - "uniquePhrases": 0-3 short phrases or signature words they actually used you'd want to mirror (verbatim, max ~6 words each, no full sentences)
  - "character": one short note on their personality if anything stands out this turn (e.g. "proud of craftsmanship", "family-business warmth"). Empty string if nothing new.

## Output
Return ONLY valid JSON:
{
  "reply": "Your warm 1-2 sentence message.",
  "captured_delta": ["catalog"|"delivery"|"voice"|"faq"],
  "voice_signals": { "tone": "...", "uniquePhrases": [...], "character": "..." },
  "done": false
}`;

  const lastAnswer = history.length > 0 ? history[history.length - 1] : null;
  const userMessage = `Conversation so far:\n${history.map(h => `MiniMe: ${h.q}\nOwner: ${h.a || '(no answer yet)'}`).join('\n\n')}\n\nThe owner just said: "${lastAnswer?.a || ''}"\n\nWrite your next reply AND extract voice signals from their last message.`;

  try {
    const res = await loggedCompletion({
      route: 'onboarding_interview',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0.6,
      max_tokens: 280,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const reply = typeof raw.reply === 'string' ? raw.reply.trim() : '';
    const done = raw.done === true;
    const captured_delta = Array.isArray(raw.captured_delta) ? raw.captured_delta.filter(s => typeof s === 'string') : [];
    const voice_signals = raw.voice_signals && typeof raw.voice_signals === 'object' ? raw.voice_signals : {};

    const priorReplies = history.map(h => (h.q || '').trim().toLowerCase().slice(0, 40));
    if (!reply || reply.length < 10 || priorReplies.includes(reply.toLowerCase().slice(0, 40))) {
      return { reply: FALLBACK_REPLY, captured_delta, voice_signals, done };
    }
    return { reply, captured_delta, voice_signals, done };
  } catch (e) {
    console.warn('[onboarding/interview] LLM failed, using fallback:', e.message);
    return { reply: FALLBACK_REPLY, captured_delta: [], voice_signals: {}, done: false };
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

  // Find or lazily create the business (idempotent).
  let business = await findByOwnerTelegramId(tg.id);
  if (!business) {
    const ownerName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null;
    business = await createBusiness({
      owner_telegram_id: tg.id,
      owner_name: ownerName,
      // Placeholder name — replaced as soon as the owner tells us in turn 1.
      name: tg.first_name ? `${tg.first_name}'s Business` : 'My Business',
      workspace_type: 'business',
      onboarding_completed: false,
      brain_mode: true,
      trust_level: 2,
      shop_code: generateShopCode(),
    });
    if (!business) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  const SEED = seedGreeting(tg.first_name);

  let state = getInterviewState(business) || {
    turn: 0,
    history: [],
    captured: {},
    name_set: false,
    started_at: Date.now(),
  };

  // ── First call: no message → return the seed greeting, do NOT teach. ────────
  if (!message.trim()) {
    if (state.turn === 0 && state.history.length === 0) {
      state = { ...state, turn: 0, started_at: Date.now() };
      await saveInterviewState(business, state);
    }
    const total_products = await countProducts(business.id);
    const pendingReply = state.history.length > 0 && !state.history[state.history.length - 1]?.a
      ? state.history[state.history.length - 1].q
      : null;
    return NextResponse.json({
      reply: pendingReply || SEED,
      question: pendingReply || SEED,
      captured: state.captured,
      products_added: 0,
      total_products,
      business_name: state.name_set ? business.name : null,
      turn: state.turn,
      max_turns: MAX_TURNS,
      done: false,
    });
  }

  // ── Subsequent calls: owner just answered the last question. ────────────────
  const lastQuestion = state.history.length > 0 && !state.history[state.history.length - 1]?.a
    ? state.history[state.history.length - 1].q
    : (state.turn === 0 ? SEED : state.history[state.history.length - 1]?.q || SEED);

  // Special case: this is the answer to "what's your business name?".
  // Save it to businesses.name and reply warmly. Don't teach this one.
  if (!state.name_set) {
    const extractedName = await extractBusinessName(business, message);
    if (extractedName) {
      try {
        const updated = await updateBusiness(business.id, { name: extractedName });
        if (updated) business = updated;
      } catch (e) {
        console.warn('[onboarding/interview] name update failed:', e.message);
      }
    }
    const newName = extractedName || business.name;

    // Record this Q/A.
    const history = [...state.history];
    if (history.length > 0 && !history[history.length - 1]?.a) {
      history[history.length - 1] = { q: lastQuestion, a: message.slice(0, 1000) };
    } else {
      history.push({ q: lastQuestion, a: message.slice(0, 1000) });
    }

    // Warm acknowledgement + first real question.
    const nextReply = `${newName} — love it! 💛 So tell me, what do you sell or offer at ${newName}?`;
    history.push({ q: nextReply, a: null });

    const nextTurn = state.turn + 1;
    state = { ...state, turn: nextTurn, history, name_set: true };
    await saveInterviewState(business, state);

    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: nextReply,
      question: nextReply,
      captured: state.captured,
      products_added: 0,
      total_products,
      business_name: newName,
      turn: nextTurn,
      max_turns: MAX_TURNS,
      done: false,
    });
  }

  // Regular turn: pipe answer through the teaching pipeline.
  let products_added = 0;
  try {
    const r = await teachFromText(business.id, `${lastQuestion}\n${message}`);
    products_added = r?.products_added || 0;
  } catch (e) {
    console.warn('[onboarding/interview] teachFromText failed:', e.message);
  }

  // Record this Q/A in history.
  const history = [...state.history];
  if (history.length > 0 && !history[history.length - 1]?.a) {
    history[history.length - 1] = { q: lastQuestion, a: message.slice(0, 1000) };
  } else {
    history.push({ q: lastQuestion, a: message.slice(0, 1000) });
  }

  const nextTurn = state.turn + 1;

  // Reached cap → finish.
  if (nextTurn >= MAX_TURNS) {
    state = { ...state, turn: nextTurn, history, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: COMPLETION_REPLY,
      question: COMPLETION_REPLY,
      captured: state.captured,
      products_added,
      total_products,
      business_name: business.name,
      turn: nextTurn,
      max_turns: MAX_TURNS,
      done: true,
    });
  }

  // Ask the LLM for the next reply AND voice signals.
  const { reply, captured_delta, voice_signals, done } = await generateNextReply(business, history, nextTurn + 1, business.name);

  // Merge voice signals into businesses.voice_embedding so the real reply engine picks them up.
  await mergeVoiceSignals(business, voice_signals);

  // Merge captured deltas.
  const captured = { ...(state.captured || {}) };
  for (const tag of captured_delta) captured[tag] = true;
  if (voice_signals && (voice_signals.tone || voice_signals.uniquePhrases?.length)) {
    captured.voice = true;
  }

  if (done) {
    state = { ...state, turn: nextTurn, history, captured, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: COMPLETION_REPLY,
      question: COMPLETION_REPLY,
      captured, products_added, total_products,
      business_name: business.name,
      turn: nextTurn, max_turns: MAX_TURNS, done: true,
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
    products_added,
    total_products,
    business_name: business.name,
    turn: nextTurn,
    max_turns: MAX_TURNS,
    done: false,
  });
}
