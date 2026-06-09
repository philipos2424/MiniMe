/**
 * POST /api/onboarding/interview
 * Body: { message?: string }
 *
 * The conversational onboarding interview that lives inside the mini-app wizard.
 *
 * Each turn:
 *   - If the body has no message, this is the FIRST turn — return the seed question.
 *   - Otherwise, pipe the owner's answer through `teachFromText` (creates real
 *     `products` rows + business brief), then ask the LLM for the next question.
 *     The LLM is instructed to TAILOR the question to whatever business type the
 *     prior turns reveal — never a generic catch-all. ("Don't ask about honey for
 *     a leather shop.")
 *
 * State lives in `businesses.notification_prefs.onboarding_chat` so it survives
 * across HTTP calls and is a sibling of the bot's `interview` slot (the two flows
 * never collide):
 *   { turn, history: [{q,a}], captured: {category,has_catalog,has_voice,has_delivery,has_faq},
 *     started_at, completed_at }
 *
 * Cap: 5 turns total (the LLM can choose to end earlier with done:true).
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

const MAX_TURNS = 5;

// The universal opening question — every onboarding starts here so we have
// something to tailor from. We never generate this with the LLM; it's free.
const SEED_QUESTION = "Hi! 👋 I'm MiniMe — I'll be answering your customers when you're busy. Tell me about your business — what do you sell or do?";

// Last-resort fallback if the LLM returns garbage. Generic enough to never
// embarrass us, vague enough that it's only used when the model misbehaves.
const FALLBACK_QUESTION = "What else should customers know about you?";

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
 * Ask the LLM for the next tailored question.
 * Inputs: prior Q/A history, the latest answer.
 * Returns: { question, captured_delta, done }
 */
async function generateNextQuestion(business, history, turn) {
  const system = `You are MiniMe, an AI assistant being trained by the owner of a small business in Ethiopia.
Your goal: ask the SINGLE most useful next question so you'll be able to answer THIS specific business's customers tomorrow.

HARD RULES:
- TAILOR the question to the business type that the prior turns reveal. NEVER ask generic questions if a specific one is available. (For a leather shop, ask about cowhide vs sheep or custom orders — NEVER about honey or unrelated products.)
- The question must be ONE short sentence. No multi-part questions, no preambles, no greetings.
- Do not repeat ground already covered in the history.
- If the business is well enough understood that further questions would be padding, set done=true.
- Total budget is ${MAX_TURNS} turns. This is turn ${turn} of ${MAX_TURNS}.

What we still need to cover, in rough priority:
  1. CATALOG — main items/services WITH PRICES (so we can quote customers).
  2. DELIVERY/PAYMENT — how customers receive it and how they pay.
  3. WHAT MAKES THEM DIFFERENT — for tone & positioning.
  4. FAQ — anything customers ask most that we haven't covered.

Return ONLY JSON: {"question": "...", "captured_delta": ["catalog"|"delivery"|"voice"|"faq"|...], "done": false}`;

  const userMessage = `History so far:\n${history.map((h, i) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`).join('\n\n')}\n\nNow ask the next tailored question (or set done=true if we have enough).`;

  try {
    const res = await loggedCompletion({
      route: 'onboarding_interview',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0.4,
      max_tokens: 180,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    const done = raw.done === true;
    const captured_delta = Array.isArray(raw.captured_delta) ? raw.captured_delta.filter(s => typeof s === 'string') : [];

    // Reject empty / duplicate questions — fall back rather than ship garbage.
    const priorQs = history.map(h => (h.q || '').trim().toLowerCase());
    if (!question || question.length < 6 || priorQs.includes(question.toLowerCase())) {
      return { question: FALLBACK_QUESTION, captured_delta, done };
    }
    return { question, captured_delta, done };
  } catch (e) {
    console.warn('[onboarding/interview] LLM failed, using fallback:', e.message);
    return { question: FALLBACK_QUESTION, captured_delta: [], done: false };
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

  // Find or lazily create the business. Idempotent — mirrors /api/onboarding/business.
  let business = await findByOwnerTelegramId(tg.id);
  if (!business) {
    const ownerName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null;
    business = await createBusiness({
      owner_telegram_id: tg.id,
      owner_name: ownerName,
      // Provisional name — replaced once the LLM extracts a real one from the convo,
      // or by the final connect step if not. Owners are never asked for it directly.
      name: tg.first_name ? `${tg.first_name}'s Business` : 'My Business',
      workspace_type: 'business',
      onboarding_completed: false,
      brain_mode: true,
      trust_level: 2,
      shop_code: generateShopCode(),
    });
    if (!business) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }

  let state = getInterviewState(business) || {
    turn: 0,
    history: [],
    captured: {},
    started_at: Date.now(),
  };

  // ── First call: no message → return the seed question, do NOT teach. ────────
  if (!message.trim()) {
    if (state.turn === 0 && state.history.length === 0) {
      state = { ...state, turn: 0, started_at: Date.now() };
      await saveInterviewState(business, state);
    }
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      question: state.history.length > 0 && state.history[state.history.length - 1]?.q
        ? state.history[state.history.length - 1].q       // resume: re-show the unanswered question
        : SEED_QUESTION,
      captured: state.captured,
      products_added: 0,
      total_products,
      turn: state.turn,
      max_turns: MAX_TURNS,
      done: false,
    });
  }

  // ── Subsequent calls: a message means the owner just answered the last question. ──
  // Figure out which question they're answering.
  const lastQuestion = state.history.length > 0 && !state.history[state.history.length - 1]?.a
    ? state.history[state.history.length - 1].q
    : (state.turn === 0 ? SEED_QUESTION : state.history[state.history.length - 1]?.q || SEED_QUESTION);

  // Pipe the answer through the teaching pipeline. This is what creates real
  // `products` rows and the business brief — the same path the dashboard's
  // /api/teach uses, so onboarding lands the owner with a populated catalog.
  let products_added = 0;
  try {
    const r = await teachFromText(business.id, `${lastQuestion}\n${message}`);
    products_added = r?.products_added || 0;
  } catch (e) {
    console.warn('[onboarding/interview] teachFromText failed:', e.message);
  }

  // Record this Q/A in history.
  const history = [...state.history];
  // If the last entry was the pending question, complete it; else append a new one.
  if (history.length > 0 && !history[history.length - 1]?.a) {
    history[history.length - 1] = { q: lastQuestion, a: message.slice(0, 1000) };
  } else {
    history.push({ q: lastQuestion, a: message.slice(0, 1000) });
  }

  const nextTurn = state.turn + 1;

  // Reached the cap → finish.
  if (nextTurn >= MAX_TURNS) {
    state = {
      ...state, turn: nextTurn, history,
      completed_at: Date.now(),
    };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      question: null,
      captured: state.captured,
      products_added,
      total_products,
      turn: nextTurn,
      max_turns: MAX_TURNS,
      done: true,
    });
  }

  // Otherwise ask the LLM for the next tailored question.
  const { question, captured_delta, done } = await generateNextQuestion(business, history, nextTurn + 1);

  // Merge captured deltas into the persisted set.
  const captured = { ...(state.captured || {}) };
  for (const tag of captured_delta) captured[tag] = true;

  if (done) {
    state = { ...state, turn: nextTurn, history, captured, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      question: null,
      captured, products_added, total_products,
      turn: nextTurn, max_turns: MAX_TURNS, done: true,
    });
  }

  // Append the new question as the next pending entry.
  history.push({ q: question, a: null });
  state = { ...state, turn: nextTurn, history, captured };
  await saveInterviewState(business, state);
  const total_products = await countProducts(business.id);

  return NextResponse.json({
    question,
    captured,
    products_added,
    total_products,
    turn: nextTurn,
    max_turns: MAX_TURNS,
    done: false,
  });
}
