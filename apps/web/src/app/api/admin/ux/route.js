/**
 * GET /api/admin/ux?days=7 — behavioural analytics for the Agent Mini App.
 *
 * Reads the views defined in ux_feature_map.sql / ux_intent_views.sql and
 * returns the four things the raw ux_events stream exists to answer:
 *
 *   1. featureUsage  — WHICH SCREENS ARE ACTUALLY USED. Ranked by unique
 *      businesses, not clicks: ranking by clicks would put a screen that needs
 *      six taps to do one thing above a screen that needs one, i.e. reward the
 *      exact thing we want to fix.
 *   2. deadFeatures  — the removal-candidate tail of the ~50 Mini App screens.
 *   3. agentFunnel / searchFunnel — is the agent trusted, does search convert.
 *   4. friction      — rage and dead clicks, so a "popular" screen that is
 *      popular because it's confusing doesn't read as a success.
 *
 * Admin-only, same guard as the other /api/admin routes.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sum the per-day view rows into one leaderboard row per feature. */
function rollUp(rows) {
  const byFeature = new Map();
  for (const r of rows || []) {
    const cur = byFeature.get(r.feature) || {
      feature: r.feature,
      area: r.area,
      clicks: 0,
      views: 0,
      sessions: 0,
      unique_businesses: 0,
      unique_users: 0,
      median_dwell_ms: null,
    };
    cur.clicks += Number(r.clicks || 0);
    cur.views += Number(r.views || 0);
    cur.sessions += Number(r.sessions || 0);
    // Distinct counts can't be summed across days without double-counting a
    // business active on two days. Max-of-days is a deliberate LOWER BOUND —
    // honest and stable, where a sum would silently inflate the ranking.
    cur.unique_businesses = Math.max(cur.unique_businesses, Number(r.unique_businesses || 0));
    cur.unique_users = Math.max(cur.unique_users, Number(r.unique_users || 0));
    if (r.median_dwell_ms != null) {
      cur.median_dwell_ms =
        cur.median_dwell_ms == null
          ? Number(r.median_dwell_ms)
          : Math.round((cur.median_dwell_ms + Number(r.median_dwell_ms)) / 2);
    }
    byFeature.set(r.feature, cur);
  }
  return [...byFeature.values()].sort(
    (a, b) => b.unique_businesses - a.unique_businesses || b.clicks - a.clicks
  );
}

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const sb = supabase();

  // Explicit high limits: these views are per-day (and ux_agent_funnel is per-day
  // PER-BUSINESS), so 90 days x ~60 features easily clears PostgREST's default
  // 1000-row cap. Silent truncation here would not error — it would quietly
  // undercount the leaderboard, which is the one number this page exists to show.
  const [usage, adoption, dead, navTabs, agent, search, rage, deadClicks] = await Promise.all([
    sb.from('ux_feature_usage').select('*').gte('day', since).limit(20000),
    sb.from('ux_feature_adoption').select('*').limit(2000),
    sb.from('ux_dead_features').select('*').limit(2000),
    sb.from('ux_nav_tabs').select('*').gte('day', since).limit(2000),
    sb.from('ux_agent_funnel').select('*').gte('day', since).limit(50000),
    sb.from('ux_search_funnel').select('*').gte('day', since).limit(2000),
    sb.from('ux_rage_clicks').select('route, target, intent').gte('created_at', since).limit(500),
    sb.from('ux_dead_clicks').select('route, target, intent').gte('created_at', since).limit(500),
  ]);

  // Surface a missing view rather than rendering a confidently empty dashboard.
  // Before the migrations are run every query fails, and "no data yet" and "the
  // tables don't exist" look identical on screen otherwise.
  const failed = Object.entries({
    ux_feature_usage: usage, ux_feature_adoption: adoption, ux_dead_features: dead,
    ux_nav_tabs: navTabs, ux_agent_funnel: agent, ux_search_funnel: search,
    ux_rage_clicks: rage, ux_dead_clicks: deadClicks,
  }).filter(([, r]) => r.error).map(([name]) => name);

  // Adoption % is a per-feature property, not a per-day one — attach rather than
  // re-derive so the leaderboard and the adoption view can never disagree.
  const adoptionBy = new Map((adoption.data || []).map(a => [a.feature, a]));
  const leaderboard = rollUp(usage.data).map(f => ({
    ...f,
    adoption_pct: adoptionBy.get(f.feature)?.adoption_pct ?? null,
  }));

  const tally = rows => {
    const m = new Map();
    for (const r of rows || []) {
      const key = `${r.route || '?'} · ${r.intent || r.target || '?'}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  };

  return NextResponse.json({
    days,
    missingViews: failed,
    featureUsage: leaderboard,
    deadFeatures: dead.data || [],
    navTabs: navTabs.data || [],
    agentFunnel: agent.data || [],
    searchFunnel: search.data || [],
    friction: { rageClicks: tally(rage.data), deadClicks: tally(deadClicks.data) },
  });
}
