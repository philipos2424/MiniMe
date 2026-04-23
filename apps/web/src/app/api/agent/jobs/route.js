/**
 * GET  /api/agent/jobs         → list jobs for the authenticated business
 * POST /api/agent/jobs/seed    → (dev-only) seed a demo job so the UI has data
 *
 * Auth: uses x-telegram-init-data (same as /api/bot/*).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { listJobs } from '../../../../lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return null;
  return findByOwnerTelegramId(tg.id);
}

export async function GET(request) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const jobs = await listJobs(business.id, { status });
  return NextResponse.json({ jobs });
}
