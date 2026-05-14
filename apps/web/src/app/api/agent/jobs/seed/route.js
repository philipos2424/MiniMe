/**
 * POST /api/agent/jobs/seed — idempotent: creates (or returns) the demo job
 * so the owner can see the UI working before a real client message comes in.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { seedDemoJob } from '../../../../../lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = await seedDemoJob(business.id);
  return NextResponse.json({ id });
}
