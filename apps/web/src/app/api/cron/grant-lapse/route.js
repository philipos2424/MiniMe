/**
 * GET /api/cron/grant-lapse — nightly: stop subscription_status from lying.
 *
 * Nothing in production has ever watched a trial or a grant end. There are 34
 * crons in vercel.json and not one of them owns expiry; the original
 * trial-checker.js still sits in the deprecated, undeployed apps/bot.
 *
 * What that cost: bulk-activate-trials comped 30 days of Pro by writing
 * subscription_status='active' with a dated subscription_expires_at. 543 of
 * those windows closed in the week of 3 August 2026. planStatus() read the
 * dates and correctly dropped the shops to Free — MiniMe stopped auto-sending
 * for 651 of them — while the status column went on saying 'active' forever.
 * Every dashboard, filter and outreach segment believed the column. 658 shops
 * are still in that state.
 *
 * This route reconciles the column to the dates, and nothing else:
 *
 *   • It does NOT change entitlement. planStatus() already treats these rows
 *     as Free; writing 'expired' tells the truth about a decision that was
 *     made weeks ago. No owner loses anything at the moment this first runs.
 *   • It does NOT send anything. The owner-facing message is staged by
 *     cron/outreach-rules through the trial_stage ladder, which reads dates
 *     via lib/server/trialStage.mjs and no longer needs this status at all.
 *
 * The decision itself lives in trialStage.shouldMarkExpired(), which asks
 * planStatus() rather than re-deriving entitlement — a second opinion on who
 * is Pro is exactly how 658 accounts got lost in the first place.
 *
 * `?dry_run=1` reports what it would change without writing. Scheduled in
 * vercel.json at 02:30 UTC, ahead of outreach-rules at 08:30 so a lapse and
 * its notice land in the right order.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { logSubscriptionEvent } from '../../../../lib/server/subscriptionEvents';
import { shouldMarkExpired } from '../../../../lib/server/trialStage.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// PostgREST serializes every id in an .in() filter into the request URL, and
// blows past the length limit somewhere in the high hundreds — silently, as a
// 400. Chunk the writes well under it. (See fetch-all.mjs for the incident
// this rule comes from.)
const UPDATE_CHUNK = 150;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const sb = supabase();

  // Paged, not .limit() — Supabase caps responses at 1000 rows regardless of
  // the limit asked for, and there are ~716 'active' rows today with no reason
  // to assume that stays under the cap.
  const { data: rows, error } = await fetchAllRows(() => sb.from('businesses')
    .select('id, name, plan_tier, subscription_plan, subscription_status, subscription_expires_at, trial_ends_at')
    .eq('subscription_status', 'active')
    .order('id', { ascending: true }));

  if (error) {
    console.error('[cron/grant-lapse] businesses query failed:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const lapsed = (rows || []).filter(shouldMarkExpired);

  if (dryRun) {
    return NextResponse.json({
      ok: true, dry_run: true,
      active_rows: rows?.length || 0,
      would_expire: lapsed.length,
      sample: lapsed.slice(0, 10).map(b => ({ id: b.id, name: b.name, ended: b.subscription_expires_at })),
    });
  }

  let expired = 0;
  const failures = [];
  for (let i = 0; i < lapsed.length; i += UPDATE_CHUNK) {
    const batch = lapsed.slice(i, i + UPDATE_CHUNK);
    const { error: upErr } = await sb.from('businesses')
      .update({ subscription_status: 'expired' })
      .in('id', batch.map(b => b.id))
      // Re-assert the precondition at write time: a payment confirmed between
      // the read above and this update must not be stomped back to expired.
      .eq('subscription_status', 'active');
    if (upErr) {
      console.error('[cron/grant-lapse] batch update failed:', upErr.message);
      failures.push(upErr.message);
      continue;
    }
    expired += batch.length;
    // The churn ledger /api/admin/economics reads. Until now a lapse left no
    // trace anywhere — which is why the August collapse had to be
    // reconstructed from message timestamps.
    for (const b of batch) {
      logSubscriptionEvent({
        businessId: b.id,
        event: 'expired',
        plan: b.plan_tier || b.subscription_plan || null,
        meta: { source: 'grant_lapse_cron', ended_at: b.subscription_expires_at || b.trial_ends_at || null },
      });
    }
  }

  await audit({
    actor_type: 'system',
    actor_id: 'cron/grant-lapse',
    action: 'subscription.reconciled_expired',
    resource_type: 'businesses',
    metadata: { active_rows: rows?.length || 0, expired, failed_batches: failures.length },
  }).catch(() => {});

  return NextResponse.json({
    ok: failures.length === 0,
    active_rows: rows?.length || 0,
    expired,
    failed_batches: failures.length,
  });
}
