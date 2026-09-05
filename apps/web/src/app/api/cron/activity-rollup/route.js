/**
 * GET /api/cron/activity-rollup — nightly: keep businesses.last_shop_activity_date
 * true, so "is this shop alive" stops being answered by a column almost nothing
 * could write.
 *
 * The bug this closes: last_active_date is bumped in exactly one place —
 * gamification.updateStreak(), reached only when an OWNER messages their OWN
 * shop bot. 21 shops have ever linked a shop bot, so the column was NULL for
 * 732 shops that had been exchanging messages for weeks. Two modules read it as
 * liveness anyway: b2bAudience.activityTier(), which buckets a NULL as 'never'
 * and drops the shop from every outreach list, and browseRank.activityLabel(),
 * which drives directory rank. b2bAudience's own header reports "686 of 887
 * businesses have never been active" — that figure is this bug, not the market.
 *
 * Migration 051 added last_shop_activity_date and backfilled it from message
 * history. This keeps it current without touching last_active_date, which stays
 * the owner's streak (updateStreak derives its day gap from it, so writing shop
 * traffic there would silently inflate every streak on the platform).
 *
 * Bounded by design: it reads a rolling window of recent messages rather than
 * the whole table, and writes only the rows whose stored date is actually
 * behind. Scheduled in vercel.json at 03:10 UTC.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, fetchAllRowsForIds } from '../../../../lib/server/fetch-all.mjs';
import { pendingActivityUpdates } from '../../../../lib/server/activityRollup.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Wider than the 30/90-day buckets the readers care about, so a few missed
// runs still heal rather than leaving a permanent hole.
const WINDOW_DAYS = 45;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const sb = supabase();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  // Paged: Supabase caps every response at 1000 rows whatever .limit() asks
  // for, and a busy week already exceeds that.
  const { data: msgs, error } = await fetchAllRows(() => sb.from('messages')
    .select('business_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false }));

  if (error) {
    console.error('[cron/activity-rollup] messages query failed:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const businessIds = [...new Set((msgs || []).map(m => m?.business_id).filter(Boolean))];
  if (!businessIds.length) {
    return NextResponse.json({ ok: true, scanned_messages: msgs?.length || 0, updated: 0 });
  }

  // Chunked: a plain .in() over hundreds of ids serializes into a URL PostgREST
  // rejects outright — see fetch-all.mjs for the incident that rule comes from.
  const { data: current, error: bizErr } = await fetchAllRowsForIds(businessIds, batch =>
    sb.from('businesses')
      .select('id, last_shop_activity_date')
      .in('id', batch)
      .order('id', { ascending: true }));

  if (bizErr) {
    console.error('[cron/activity-rollup] businesses query failed:', bizErr.message);
    return NextResponse.json({ ok: false, error: bizErr.message }, { status: 500 });
  }

  const stored = {};
  for (const b of current || []) stored[b.id] = b.last_shop_activity_date;

  // The whole decision — which shops actually moved — is pendingActivityUpdates(),
  // unit-tested in __tests__/activityRollup.test.mjs.
  const updates = pendingActivityUpdates(msgs || [], stored);

  if (dryRun) {
    return NextResponse.json({
      ok: true, dry_run: true,
      scanned_messages: msgs.length,
      businesses_seen: businessIds.length,
      would_update: updates.length,
    });
  }

  let updated = 0;
  const failures = [];
  // One write per shop: each carries a different date, so there is no batch
  // form of this update. Only the shops that moved are written.
  for (const u of updates) {
    const { error: upErr } = await sb.from('businesses')
      .update({ last_shop_activity_date: u.last_shop_activity_date })
      .eq('id', u.id);
    if (upErr) { failures.push(upErr.message); continue; }
    updated++;
  }

  if (failures.length) {
    console.error(`[cron/activity-rollup] ${failures.length} updates failed, first: ${failures[0]}`);
  }

  return NextResponse.json({
    ok: failures.length === 0,
    scanned_messages: msgs.length,
    businesses_seen: businessIds.length,
    updated,
    failed: failures.length,
  });
}
