/**
 * POST /api/onboarding/edit-reply
 * Body: { conversation_id, corrected_text }
 *
 * When the owner edits a draft during the Try-It step of onboarding, this turns
 * the correction into a durable lesson — same shape as the production
 * `learnFromOwnerEdit` flow uses, but bound to our in-memory preview-session
 * map (no real `messages` row exists in preview mode, which is what
 * learnFromOwnerEdit requires).
 *
 * Effect:
 *   - The {customer-question, corrected-answer} pair is saved as an FAQ entry
 *     on `owner_instructions` (so a paraphrase of the same question retrieves
 *     it via the brain), AND embedded as a learned document (so RAG finds it).
 *   - Next time a real customer asks something close to that question, MiniMe
 *     uses the corrected answer.
 *
 * Notes:
 *   - We don't run suppressWrongAnswer here: in preview mode the rejected draft
 *     was never written to `owner_instructions` in the first place, so there's
 *     nothing to suppress.
 *   - The conversation_id is the token minted by /api/onboarding/preview; we
 *     look it up in the same in-memory TTL map.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { saveFaqPair } from '../../../../lib/server/replyEngine';
import { getPreviewSession } from '../../../../lib/server/onboardingPreview';
import { str, ValidationError } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let conversation_id, corrected;
  try {
    conversation_id = str(body.conversation_id, { field: 'conversation_id', min: 8, max: 64, required: true });
    corrected = str(body.corrected_text, { field: 'corrected_text', min: 4, max: 1500, required: true });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const session = getPreviewSession(conversation_id, tg.id);
  if (!session) {
    return NextResponse.json({
      error: 'session_expired',
      hint: 'Re-send the question and edit the new reply.',
    }, { status: 410 });
  }

  // Confirm the business is still owned by this Telegram user. (The preview
  // session is keyed by tg.id already, so this is paranoia for the case where
  // an owner reassigns or deletes a business mid-session.)
  const business = await findByOwnerTelegramId(tg.id);
  if (!business || business.id !== session.business_id) {
    return NextResponse.json({ error: 'no_business' }, { status: 404 });
  }

  try {
    await saveFaqPair(business.id, session.question, corrected);
  } catch (e) {
    console.error('[onboarding/edit-reply] saveFaqPair:', e.message);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    lesson: `Saved — next time someone asks "${session.question.slice(0, 80)}", MiniMe will use your wording.`,
  });
}
