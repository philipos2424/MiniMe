/**
 * GET /api/cron/expire-orders — flips unpaid orders past their expires_at from
 * `pending_payment` to `expired`.
 *
 * Nothing did this before: orders have carried an expires_at (24h) since they
 * were introduced, and no code ever read it. Rows sat in pending_payment
 * forever, which was cosmetic while stock was only decremented on payment —
 * and stopped being cosmetic once an unpaid order started holding stock back
 * from other customers (see lib/server/availability.js).
 *
 * Availability itself does not depend on this run: held_quantities filters on
 * expires_at, so a lapsed hold frees its stock immediately. This keeps the
 * orders table honest — the owner's pipeline, /orders, and the revenue figures
 * should not show a day-old unpaid order as still awaiting payment.
 *
 * Scheduled hourly from .github/workflows/expire-orders-cron.yml rather than
 * vercel.json: Hobby plans allow daily crons only, and up to 24h of stale
 * "awaiting payment" rows is the thing this exists to prevent.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { invalidateHoldCache } from '../../../../lib/server/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authed = isCronAuthorized(request);
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const { data, error } = await sb
    .from('orders')
    .update({ status: 'expired' })
    .eq('status', 'pending_payment')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
    .select('id, business_id');

  if (error) {
    console.error('[expire-orders]', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Cached availability for these businesses is now wrong by exactly the stock
  // this run just released.
  for (const businessId of new Set((data || []).map(o => o.business_id).filter(Boolean))) {
    invalidateHoldCache(businessId);
  }

  return NextResponse.json({
    ok: true,
    expired: data?.length || 0,
    businesses: new Set((data || []).map(o => o.business_id)).size,
  });
}
