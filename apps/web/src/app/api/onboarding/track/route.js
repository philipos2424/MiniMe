/**
 * POST /api/onboarding/track
 * Body: { step: string, meta?: object }
 *
 * Fire-and-forget funnel telemetry for the onboarding wizard. Each screen
 * advance (welcome → sell → demo → teach → connect → connected_*) writes one
 * row. This is the ONLY way we can see WHERE owners abandon — the wizard is
 * pure client state and writes nothing else until the very end of the flow.
 *
 * Authenticated via Telegram initData so the funnel can't be spammed, and so
 * every event is tied to a real Telegram user id (the funnel's denominator).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whitelist of valid funnel steps — anything else is dropped so a bad/forged
// client can't pollute the funnel with arbitrary labels.
const VALID_STEPS = new Set([
  // Legacy form-based wizard steps — kept so historical funnel queries don't break.
  'app_open', 'welcome', 'sell', 'demo', 'teach',
  // Old conversational wizard names — kept as aliases for back-compat dashboards.
  'conversation_started', 'conversation_finished',
  // Selam-driven wizard pre-step + per-turn events.
  'shop_name', 'shop_name_saved',
  'customer_chat_started', 'customer_chat_reply', 'customer_chat_finished',
  // "Try it" — owner tests the AI on their real catalog before connecting.
  'tryit', 'tryit_sent', 'tryit_replied', 'tryit_edited',
  // In-flow teach-by-upload (paperclip) — captured in both Customer Chat + Try-It steps.
  'conversation_upload', 'tryit_upload',
  // Try-It reply that retrieved from an uploaded doc/photo — the "it worked" moment.
  'tryit_used_upload',
  // Connect + share.
  'connect', 'connect_custom', 'connect_shared',
  'connected_custom', 'connected_shared',
  'shared_share_tapped',
  // Personal-mode awareness card shown on the post-activation Share screen.
  // Lets us measure how many owners saw it vs how many later activate (via
  // webhook → telegram_biz_conn_id populated). The conversion delta tells us
  // if a simple awareness card is enough or if we need to add a CTA later.
  'personal_mode_card_shown',
]);

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    // Don't 401-noisily — telemetry must never break the flow. Just no-op.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  const tg = parseTelegramUser(initData);

  let body = {};
  try { body = await request.json(); } catch {}
  const step = String(body.step || '').trim();
  if (!VALID_STEPS.has(step)) return NextResponse.json({ ok: false }, { status: 200 });

  // Keep meta tiny and safe — cap to a small JSON blob.
  let meta = null;
  if (body.meta && typeof body.meta === 'object') {
    try {
      const s = JSON.stringify(body.meta).slice(0, 500);
      meta = JSON.parse(s);
    } catch { meta = null; }
  }

  try {
    await supabase().from('onboarding_events').insert({
      telegram_id: tg?.id ? Number(tg.id) : null,
      step,
      meta,
    });
  } catch {
    // Swallow — telemetry is best-effort and must never surface to the user.
  }
  return NextResponse.json({ ok: true });
}
