/**
 * POST /api/onboarding/preview
 * Body: { message, customer_name? }
 *
 * The "Try it" step of the onboarding wizard — the owner messages as their own
 * customer and sees MiniMe reply using their real catalog + brief. No DB writes
 * touch the live conversations/messages tables: we go through `draftReply` with
 * `preview: true`, the same trick `ownerInterview.autoPreviewFirstItem` uses.
 *
 * Returns the draft + a short-lived `conversation_id` (server-issued token) that
 * the edit-reply endpoint uses to bind a correction to the question that was
 * just asked. The token never touches the DB — it's just a UUID we hand back so
 * the client can echo it on edit, which lets us look the question/draft pair up
 * in our in-memory map.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { draftReply } from '../../../../lib/server/replyEngine';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';
import { str, ValidationError } from '../../../../lib/server/sanitize';
import { storePreviewSession } from '../../../../lib/server/onboardingPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  // Rate limit: preview calls hit the heaviest path in the system (draftReply).
  // 20/min/IP is enough for testing 1–2 messages per few seconds; spam gets shed.
  const { ok: rl, retryAfter } = rateLimit(getIP(request), 'onboarding_preview', 20, 60);
  if (!rl) return NextResponse.json({ error: 'too_many_requests', retryAfter }, { status: 429 });

  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let message, customerName;
  try {
    message = str(body.message, { field: 'message', min: 1, max: 1000, required: true });
    customerName = str(body.customer_name, { field: 'customer_name', max: 60, required: false }) || 'Customer';
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  // Synthetic customer + conversation, same shape as ownerInterview's preview.
  // Both must have null ids so downstream history lookups return empty (there's
  // nothing in the messages table for null) — i.e. the AI replies from products
  // + brief alone, not invented prior chat. preview:true skips writes.
  const syntheticCustomer = { id: null, name: customerName };
  const syntheticConversation = { id: null, metadata: {} };

  const t0 = Date.now();
  let draft, confidence;
  try {
    ({ draft, confidence } = await draftReply(
      business, syntheticCustomer, syntheticConversation, message,
      { isSecretary: false, preview: true }
    ));
  } catch (e) {
    console.error('[onboarding/preview] draftReply:', e.message);
    return NextResponse.json({ error: 'draft_failed' }, { status: 500 });
  }

  if (!draft) {
    return NextResponse.json({
      error: 'no_draft',
      hint: 'Add some products and try again — MiniMe needs something to quote.',
    }, { status: 200 });
  }

  // Mint a token the client can echo back if the owner edits this draft. Keeps
  // the question/draft pair retrievable without binding it to a DB row.
  const conversation_id = storePreviewSession(tg.id, {
    business_id: business.id,
    question: message,
    draft,
  });

  return NextResponse.json({
    reply: draft,
    confidence,
    conversation_id,
    latency_ms: Date.now() - t0,
  });
}
