/**
 * Admin Billing API Endpoint
 * GET /api/admin/billing: Return platform-wide subscription analytics, Claude usage, & revenue
 * POST /api/admin/billing: Perform admin actions (add_credits, reset_credits, suspend)
 */
import { NextResponse } from 'next/server';
import { getAdminBillingAnalytics, adminManageSubscription } from '../../../../lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const analytics = await getAdminBillingAnalytics();
    return NextResponse.json({ ok: true, analytics });
  } catch (e) {
    console.error('[admin/billing] GET error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { businessId, action, extraCredits, resetCredits, suspend } = body;

    if (!businessId || !action) {
      return NextResponse.json({ error: 'Missing businessId or action' }, { status: 400 });
    }

    const updated = await adminManageSubscription(businessId, {
      action,
      extraCredits,
      resetCredits,
      suspend,
    });

    return NextResponse.json({ ok: true, subscription: updated });
  } catch (e) {
    console.error('[admin/billing] POST error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
