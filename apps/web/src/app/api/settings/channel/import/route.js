/**
 * POST /api/settings/channel/import
 * Body: { username? }
 *
 * One-tap back-catalog import: pull the owner's existing channel posts from the
 * public t.me/s/<username> preview into their product catalog. Falls back to the
 * business's linked source_channel_username when no username is given.
 * Rate-limited — it hits the LLM extractor per post.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { importChannelBackCatalog } from '../../../../../lib/server/channelBackfill';
import { rateLimit, getIP } from '../../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  // One import scans ~20 posts through the extractor — a few per hour is plenty.
  const { ok: rl, retryAfter } = rateLimit(getIP(request), 'channel_import', 5, 300);
  if (!rl) return NextResponse.json({ error: 'too_many_requests', retryAfter }, { status: 429 });

  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const username = (body.username || business.source_channel_username || '').trim();
  if (!username) {
    return NextResponse.json({ error: 'no_channel', hint: 'Add your channel @username first.' }, { status: 400 });
  }

  const result = await importChannelBackCatalog({ business, username });
  if (!result.ok) {
    // private_or_empty → the channel has no public web preview; forwarding works.
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 });
  }
  return NextResponse.json({ ok: true, ...result });
}
