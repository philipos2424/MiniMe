/**
 * Admin Billing API Endpoint
 * GET /api/admin/billing: Return platform-wide subscription analytics, Claude usage, & revenue
 * POST /api/admin/billing: Perform admin actions (add_credits, reset_credits, suspend)
 */
import { NextResponse } from 'next/server';
import { getAdminBillingAnalytics, adminManageSubscription } from '../../../../lib/server/billing';
import { requireAdminRequest } from '../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This route had NO auth check while every other /api/admin/* route used
// requireAdminRequest. Unauthenticated GET returned every subscription joined
// to businesses(name, owner_name, email) — the PII of every shop on the
// platform — and POST could grant credits or suspend any account.
export async function GET(request) {
  try {
    if (!await requireAdminRequest(request)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const analytics = await getAdminBillingAnalytics();
    return NextResponse.json({ ok: true, analytics });
  } catch (e) {
    console.error('[admin/billing] GET error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!await requireAdminRequest(request)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
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
