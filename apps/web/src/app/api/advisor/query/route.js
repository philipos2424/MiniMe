/**
 * POST /api/advisor/query
 * Body: { question }
 * Returns: { response, suggestedActions, stats, pipeline }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { generateAdvisorResponse } from '../../../../lib/server/advisor';
import { isProServer, PRO_REQUIRED } from '../../../../lib/server/planGuard';

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

  // Advisor is Pro-only. The UI already gates this, but the route is the
  // authoritative check — a stale client must not get free advice.
  if (!isProServer(business)) return NextResponse.json(PRO_REQUIRED, { status: 403 });

  let body = {};
  try { body = await request.json(); } catch {}
  const question = (body.question || '').trim();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  try {
    const result = await generateAdvisorResponse(business.id, question);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message || 'advisor failed' }, { status: 500 });
  }
}
