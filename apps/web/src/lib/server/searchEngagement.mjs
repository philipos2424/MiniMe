/**
 * MiniMe Search customer engagement for the Pulse dashboard.
 *
 * Pulse's headline cards (messages, new customers, orders, GMV) are platform
 * totals: a merchant's own walk-in customer messaging their bot and a shopper
 * who found them through MiniMe Search land in the same number. This module
 * isolates the second group so "is MiniMe Search actually delivering
 * customers to merchants" has an answer that doesn't have to be inferred.
 *
 * Two halves, deliberately measured differently:
 *
 *  - ARRIVALS (`landed`, `talking`) are same-day events. A shopper "landed"
 *    when they opened a merchant bot from a search/market deep link
 *    (search_referrals row, written in replyEngine's /start handler), and
 *    "started talking" when they sent a real non-command message
 *    (first_message_at, stamped in replyEngine).
 *
 *  - ORDERS / GMV use permanent attribution: once a customer arrived via
 *    search, every later order they place is credited to search. This shows
 *    the compounding value the directory delivers, not just same-day
 *    conversions — most shoppers don't buy the day they arrive.
 *
 * Everything is counted per distinct (business_id, customer_telegram_id)
 * pair, never per row: search_referrals has no unique constraint on that
 * pair, so a shopper who taps the link three times writes three rows and raw
 * row counts overstate people.
 *
 * Pure and dependency-free so it can be unit-tested with plain `node --test`
 * (see __tests__/searchEngagement.test.mjs). The queries that feed it live in
 * api/admin/pulse/route.js, matching how computeSellFunnel is wired up.
 */

const PAID = ['paid', 'fulfilled', 'completed'];

const TOP_RECEIVERS = 3;

/**
 * Identity of a search-attributed shopper: the same telegram id at two
 * different shops is two distinct leads, and a lead at one shop must never
 * credit another. Both halves are stringified — customer_telegram_id is TEXT
 * in search_referrals but customers.telegram_id is numeric, so the two sides
 * arrive with different types.
 */
export function pairKey(businessId, telegramId) {
  return `${businessId}:${telegramId}`;
}

const inWindow = (at, from, to) => !!at && at >= from && at < to;

export function aggregateSearchEngagement({
  referrals = [],
  orders = [],
  customers = [],
  attributedPairs = [],
  businessNames = {},
  todayStart,
  yesterdayStart,
  nowIso,
} = {}) {
  // ── Arrivals: collapse duplicate referral rows down to one per shopper ────
  // Earliest landing and earliest conversion win, so a repeat tap can't move
  // a shopper into a later day than the one they actually arrived in.
  const shoppers = new Map(); // pairKey -> { businessId, landedAt, talkingAt }
  for (const r of referrals) {
    if (!r?.business_id || r.customer_telegram_id == null) continue;
    const key = pairKey(r.business_id, r.customer_telegram_id);
    const prev = shoppers.get(key);
    if (!prev) {
      shoppers.set(key, {
        businessId: r.business_id,
        landedAt: r.created_at || null,
        talkingAt: r.first_message_at || null,
      });
      continue;
    }
    if (r.created_at && (!prev.landedAt || r.created_at < prev.landedAt)) prev.landedAt = r.created_at;
    if (r.first_message_at && (!prev.talkingAt || r.first_message_at < prev.talkingAt)) {
      prev.talkingAt = r.first_message_at;
    }
  }

  let landedToday = 0, landedYesterday = 0, talkingToday = 0, talkingYesterday = 0;
  const receiversToday = new Map(); // business_id -> distinct arrivals today
  for (const s of shoppers.values()) {
    if (inWindow(s.landedAt, todayStart, nowIso)) {
      landedToday++;
      receiversToday.set(s.businessId, (receiversToday.get(s.businessId) || 0) + 1);
    } else if (inWindow(s.landedAt, yesterdayStart, todayStart)) {
      landedYesterday++;
    }
    if (inWindow(s.talkingAt, todayStart, nowIso)) talkingToday++;
    else if (inWindow(s.talkingAt, yesterdayStart, todayStart)) talkingYesterday++;
  }

  // ── Orders: resolve each order back to a (business, shopper) pair and keep
  // only the ones search introduced. The customer row is authoritative for
  // the business — an order's own business_id is never used to build the key.
  const attributed = new Set(
    attributedPairs
      .filter(p => p?.business_id && p.customer_telegram_id != null)
      .map(p => pairKey(p.business_id, p.customer_telegram_id)),
  );
  const customerById = new Map(customers.filter(c => c?.id).map(c => [c.id, c]));

  let ordersToday = 0, ordersYesterday = 0, gmvToday = 0, gmvYesterday = 0;
  for (const o of orders) {
    const c = customerById.get(o?.customer_id);
    if (!c || !attributed.has(pairKey(c.business_id, c.telegram_id))) continue;

    const isToday = inWindow(o.created_at, todayStart, nowIso);
    const isYesterday = !isToday && inWindow(o.created_at, yesterdayStart, todayStart);
    if (!isToday && !isYesterday) continue;

    // Orders counts every order; GMV counts only money that actually landed —
    // the same split the Pulse cards above this block already use.
    const paid = PAID.includes(String(o.status || '').toLowerCase());
    const total = Number(o.total) || 0;
    if (isToday) { ordersToday++; if (paid) gmvToday += total; }
    else { ordersYesterday++; if (paid) gmvYesterday += total; }
  }

  // A business that no longer exists has no name, and Pulse's rule is that no
  // row may ever name one — so it drops off this list while still counting
  // toward the arrival total above.
  const topReceivers = [...receiversToday.entries()]
    .filter(([id]) => businessNames[id])
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RECEIVERS)
    .map(([id, landed]) => ({ business_id: id, name: businessNames[id], landed }));

  return {
    today: { landed: landedToday, talking: talkingToday, orders: ordersToday, gmv_etb: gmvToday },
    yesterday: { landed: landedYesterday, talking: talkingYesterday, orders: ordersYesterday, gmv_etb: gmvYesterday },
    topReceivers,
  };
}
