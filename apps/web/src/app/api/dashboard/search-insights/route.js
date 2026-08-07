/**
 * GET /api/dashboard/search-insights?days=30
 *
 * Per-business search & market analytics for the OWNER dashboard
 * (Settings → MiniMe Search). Everything is scoped to the business derived
 * from the verified Telegram initData — never from a query param.
 *
 * Aggregation lives in lib/server/searchInsights.js, shared with the
 * platform admin's per-business drill-down
 * (api/admin/businesses/[id]/insights).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { buildSearchInsights } from '../../../../lib/server/searchInsights';
import { isProServer } from '../../../../lib/server/planGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10) || 30));

  const insights = await buildSearchInsights(business, { days });

  // "Market insights" (PRO_FEATURES.market_insights) — what shoppers in the
  // category searched for that nobody stocked — is a Pro feature. A shop's own
  // performance stays free. Stripped here, not just hidden in the UI, so the
  // data doesn't ship to a Free client that could read it off the wire.
  if (!isProServer(business)) {
    const { missedDemand, waitlistCount, ...free } = insights;
    return NextResponse.json({ ...free, missedDemandLocked: true });
  }

  return NextResponse.json(insights);
}
