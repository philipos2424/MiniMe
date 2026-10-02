/**
 * GET /api/billing/subscription
 * Returns subscription data, credit remaining, monthly usage, and payment logs for the authenticated user/business.
 */
import { NextResponse } from 'next/server';
import { authenticate, requireOwner } from '../../../../lib/server/auth';
import { getBillingOverview } from '../../../../lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (!requireOwner(auth.business, auth.tgUser)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const businessId = auth.business.id;
    const overview = await getBillingOverview(businessId);
    return NextResponse.json({ ok: true, ...overview });
  } catch (e) {
    console.error('[api/billing/subscription] GET error:', e.message);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
