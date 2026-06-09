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

// The universal opening message — warm, human, no survey vibe.
const SEED_QUESTION = "Hey! 👋 I'm MiniMe — I'll be handling your customer messages when you're busy. Let me learn a few things about your business first. What do you sell or offer?";

// Warm sign-off when the conversation is done — used instead of returning null.
const COMPLETION_REPLY = "Got it, I think I have everything I need! 🙌 Now let me show you what I can do — message me like one of your customers and see how I reply.";

// Last-resort fallback if the LLM returns garbage.
const FALLBACK_REPLY = "Interesting! What else would a customer typically ask you about?";

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
 * Ask the LLM for the next conversational reply (warm reaction + tailored question).
 * Returns: { reply, captured_delta, done }
 */
async function generateNextReply(business, history, turn) {
  const system = `You are MiniMe, an AI assistant learning from a small-business owner in Ethiopia so you can handle their customer chats.

Write SHORT, WARM, CONVERSATIONAL messages — like a sharp friendly colleague, not a survey form.

Each message has two natural parts combined into 1-2 sentences:
  1. A brief genuine reaction to their last answer — specific, use their actual words. E.g. "Love it, leather bags are always in demand!" or "A full catering menu — nice!"
  2. The single most useful follow-up question to help you answer their customers.

HARD RULES:
- Max 2 sentences total. No bullet points. No "Great!" filler. No "As an AI". No multi-part questions.
- TAILOR every question to the specific business. Leather bags → ask materials/custom orders/prices. Food → menu/delivery. NEVER ask about unrelated products.
- Never repeat ground already covered.
- Use simple, clear English (owners may not be fully fluent).
- When you know enough to serve customers (catalog + prices + delivery + what makes them different), set done=true.
- Turn budget: ${MAX_TURNS} total, this is turn ${turn}.

Coverage priority:
  1. Products/services WITH PRICES (customers need to know what to buy and how much)
  2. Delivery / ordering method
  3. What makes them different from competitors
  4. Common FAQs (hours, location, customization)

Return ONLY valid JSON:
{"reply": "Warm reaction + next question in natural language.", "captured_delta": ["catalog"|"delivery"|"voice"|"faq"], "done": false}`;

  const lastAnswer = history.length > 0 ? history[history.length - 1] : null;
  const userMessage = `Conversation so far:\n${history.map((h, i) => `MiniMe: ${h.q}\nOwner: ${h.a}`).join('\n\n')}\n\nThe owner just said: "${lastAnswer?.a || ''}"\n\nWrite your next conversational reply (or set done=true if you have enough info).`;

  try {
    const res = await loggedCompletion({
      route: 'onboarding_interview',
      business_id: business.id,
      model: MODEL_MINI,
      temperature: 0.55,
      max_tokens: 200,
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

    // Reject empty / near-duplicate replies.
    const priorReplies = history.map(h => (h.q || '').trim().toLowerCase().slice(0, 40));
    if (!reply || reply.length < 10 || priorReplies.includes(reply.toLowerCase().slice(0, 40))) {
      return { reply: FALLBACK_REPLY, captured_delta, done };
    }
    return { reply, captured_delta, done };
  } catch (e) {
    console.warn('[onboarding/interview] LLM failed, using fallback:', e.message);
    return { reply: FALLBACK_REPLY, captured_delta: [], done: false };
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

  // ── First call: no message → return the seed greeting, do NOT teach. ────────
  if (!message.trim()) {
    if (state.turn === 0 && state.history.length === 0) {
      state = { ...state, turn: 0, started_at: Date.now() };
      await saveInterviewState(business, state);
    }
    const total_products = await countProducts(business.id);
    // On resume, re-show the last unanswered MiniMe message if any.
    const pendingReply = state.history.length > 0 && !state.history[state.history.length - 1]?.a
      ? state.history[state.history.length - 1].q
      : null;
    return NextResponse.json({
      reply: pendingReply || SEED_QUESTION,
      // Legacy alias so old clients still work
      question: pendingReply || SEED_QUESTION,
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

  // Reached the cap → finish with a warm sign-off.
  if (nextTurn >= MAX_TURNS) {
    state = { ...state, turn: nextTurn, history, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: COMPLETION_REPLY,
      question: COMPLETION_REPLY, // legacy alias
      captured: state.captured,
      products_added,
      total_products,
      turn: nextTurn,
      max_turns: MAX_TURNS,
      done: true,
    });
  }

  // Otherwise ask the LLM for the next conversational reply (reaction + question).
  const { reply, captured_delta, done } = await generateNextReply(business, history, nextTurn + 1);

  // Merge captured deltas into the persisted set.
  const captured = { ...(state.captured || {}) };
  for (const tag of captured_delta) captured[tag] = true;

  if (done) {
    state = { ...state, turn: nextTurn, history, captured, completed_at: Date.now() };
    await saveInterviewState(business, state);
    const total_products = await countProducts(business.id);
    return NextResponse.json({
      reply: COMPLETION_REPLY,
      question: COMPLETION_REPLY, // legacy alias
      captured, products_added, total_products,
      turn: nextTurn, max_turns: MAX_TURNS, done: true,
    });
  }

  // Append the new reply as the next pending entry.
  history.push({ q: reply, a: null });
  state = { ...state, turn: nextTurn, history, captured };
  await saveInterviewState(business, state);
  const total_products = await countProducts(business.id);

  return NextResponse.json({
    reply,
    question: reply, // legacy alias
    captured,
    products_added,
    total_products,
    turn: nextTurn,
    max_turns: MAX_TURNS,
    done: false,
  });
}
