/**
 * GET /api/admin/engagement — platform-wide Market engagement analytics.
 *
 * Favorites/follows/shares/reviews/shop-views were all being logged already
 * (market_events, market_favorites, market_follows) with nowhere on the
 * admin to see them. Daily EAT buckets (30d) + DAU/WAU/MAU + top favorited
 * products + most-followed shops.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows, dayKeyEAT, lastNDaysEAT } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENGAGEMENT_TYPES = ['favorite', 'unfavorite', 'follow', 'unfollow', 'share', 'view_shop', 'write_review'];

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const sb = supabase();

  const [{ data: events }, { data: favRows }, { data: followRows }] = await Promise.all([
    fetchAllRows(() => sb.from('market_events')
      .select('event_type, business_id, product_id, tg_user_id, created_at')
      .gte('created_at', since30)
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('market_favorites')
      .select('product_id')
      .gte('created_at', since30)),
    fetchAllRows(() => sb.from('market_follows')
      .select('business_id')
      .gte('created_at', since30)),
  ]);

  const allEvents = events || [];

  // ── Totals by type (30d) ──────────────────────────────────────────────────
  const totals = Object.fromEntries(ENGAGEMENT_TYPES.map(t => [t, 0]));
  totals.view_product = 0;
  totals.click_chat = 0;
  for (const e of allEvents) {
    if (e.event_type in totals) totals[e.event_type]++;
  }

  // ── Daily buckets (EAT) ────────────────────────────────────────────────────
  const days = lastNDaysEAT(30);
  const daily = Object.fromEntries(days.map(d => [d, { day: d, favorites: 0, follows: 0, shares: 0, viewShop: 0, reviews: 0 }]));
  for (const e of allEvents) {
    const b = daily[dayKeyEAT(e.created_at)];
    if (!b) continue;
    if (e.event_type === 'favorite') b.favorites++;
    else if (e.event_type === 'follow') b.follows++;
    else if (e.event_type === 'share') b.shares++;
    else if (e.event_type === 'view_shop') b.viewShop++;
    else if (e.event_type === 'write_review') b.reviews++;
  }
  const dailyOut = days.map(k => daily[k]);

  // ── DAU / WAU / MAU (Market interactions, any event type, distinct user) ──
  const uniq = (rows, since) => new Set(
    rows.filter(e => !since || e.created_at >= since).map(e => e.tg_user_id).filter(Boolean)
  ).size;
  const today = dayKeyEAT(new Date());
  const dau = new Set(allEvents.filter(e => dayKeyEAT(e.created_at) === today).map(e => e.tg_user_id).filter(Boolean)).size;
  const wau = uniq(allEvents, since7);
  const mau = uniq(allEvents, since30);

  // ── Top favorited products / most-followed shops (30d) ───────────────────
  const favCounts = {};
  for (const f of favRows || []) if (f.product_id) favCounts[f.product_id] = (favCounts[f.product_id] || 0) + 1;
  const topFavProductIds = Object.entries(favCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const followCounts = {};
  for (const f of followRows || []) if (f.business_id) followCounts[f.business_id] = (followCounts[f.business_id] || 0) + 1;
  const topFollowedBizIds = Object.entries(followCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const [{ data: favProducts }, { data: followedBiz }] = await Promise.all([
    topFavProductIds.length
      ? sb.from('products').select('id, name, business_id, businesses(name)').in('id', topFavProductIds.map(([id]) => id))
      : Promise.resolve({ data: [] }),
    topFollowedBizIds.length
      ? sb.from('businesses').select('id, name').in('id', topFollowedBizIds.map(([id]) => id))
      : Promise.resolve({ data: [] }),
  ]);

  const favById = new Map((favProducts || []).map(p => [p.id, p]));
  const topFavorited = topFavProductIds.map(([id, count]) => ({
    id, count, name: favById.get(id)?.name || '(deleted product)', business_name: favById.get(id)?.businesses?.name || null,
  }));

  const bizById = new Map((followedBiz || []).map(b => [b.id, b]));
  const topFollowed = topFollowedBizIds.map(([id, count]) => ({
    id, count, name: bizById.get(id)?.name || '(deleted business)',
  }));

  return NextResponse.json({
    totals,
    daily: dailyOut,
    dau, wau, mau,
    topFavorited,
    topFollowed,
  });
}
