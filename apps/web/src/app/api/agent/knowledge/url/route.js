/**
 * POST /api/agent/knowledge/url
 * Body: { url, tag? }
 *
 * Fetches the URL, extracts text, embeds chunks into the business's KB.
 * Used by the /agent/knowledge "Teach from URL" form.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { ingestUrl } from '../../../../../lib/server/webIngest';
import { url as urlVal, str, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let url, tag;
  try {
    url = urlVal(body.url, { field: 'url', required: true });
    tag = str(body.tag, { field: 'tag', max: 50, required: false }) || 'website';
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const result = await ingestUrl({ businessId: business.id, url, tag });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
