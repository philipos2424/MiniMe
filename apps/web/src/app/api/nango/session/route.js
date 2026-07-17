/**
 * POST /api/nango/session — create a Nango Connect UI session token.
 * Body: { platforms?: ['facebook'|'instagram'|'whatsapp'] }
 * Auth: x-telegram-init-data header (same gate as /api/settings/channels).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { createSessionToken, nangoConfigured } from '../../../../lib/server/nango';
import { rateLimit, getIP } from '../../../../lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { ok } = rateLimit(getIP(request), 'nango-session', 20, 60);
  if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  if (!nangoConfigured()) {
    return NextResponse.json({ error: 'Nango not configured' }, { status: 500 });
  }

  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'business not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  // WhatsApp is deferred this phase — only Facebook + Instagram can be connected.
  const platforms = Array.isArray(body.platforms) && body.platforms.length
    ? body.platforms.filter(p => ['facebook', 'instagram'].includes(p))
    : ['facebook', 'instagram'];

  try {
    const sessionToken = await createSessionToken(business, platforms);
    if (!sessionToken) throw new Error('No token returned');
    return NextResponse.json({ sessionToken });
  } catch (e) {
    console.error('[nango-session]', e.message);
    return NextResponse.json({ error: 'Could not create session' }, { status: 502 });
  }
}
