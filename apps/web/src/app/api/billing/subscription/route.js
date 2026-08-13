/**
 * GET /api/billing/subscription
 * Returns subscription data, credit remaining, monthly usage, and payment logs for the authenticated user/business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { getBillingOverview } from '../../../../lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const initData = request.headers.get('x-telegram-init-data');
    let businessId = null;

    if (initData && verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      const tgUser = parseTelegramUser(initData);
      if (tgUser?.id) {
        const biz = await findBusinessForUser(tgUser.id);
        businessId = biz?.id;
      }
    }

    // Fallback: check query parameter or authorization header in dev/web session
    if (!businessId) {
      const url = new URL(request.url);
      businessId = url.searchParams.get('businessId') || request.headers.get('x-business-id');
    }

    if (!businessId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const overview = await getBillingOverview(businessId);
    return NextResponse.json({ ok: true, ...overview });
  } catch (e) {
    console.error('[api/billing/subscription] GET error:', e.message);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
