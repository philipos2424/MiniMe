/**
 * GET /api/market/for-you?tg_user_id=… — personal recommendations for the Market.
 *
 * The profile is THIS user's own activity (never global popularity):
 *   - market_events view_product / click_chat (30d) → categories they browse
 *     (clicks weighted over views)
 *   - search_logs (30d, same Telegram id) → categories they searched for
 * Returns up to 8 products from their top 2 categories with a human reason
 * ("Because you looked at Electronics & Phones") — new users get an empty
 * list and the page hides the section; nothing generic pretends to be personal.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { contactUrlFor } from '../../../../lib/server/searchBot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORY_EN = {
  branding_design: 'Branding & Design', printing_signage: 'Printing & Signage',
  photography_video: 'Photography & Video', catering_food: 'Catering & Food',
  food_beverage: 'Restaurants & Cafés', it_tech: 'IT & Tech',
  events_entertainment: 'Events & Entertainment', clothing_fashion: 'Clothing & Fashion',
  beauty_wellness: 'Beauty & Wellness', construction_interior: 'Construction & Interior',
  transport_delivery: 'Transport & Delivery', training_consulting: 'Training & Consulting',
  wholesale_supply: 'Wholesale & Supply', electronics_phones: 'Electronics & Phones',
};
const label = c => CATEGORY_EN[c] || (c || '').replace(/_/g, ' ');

// Product-carrying deep link — same scheme as the catalog API: the bot opens
// on THIS product instead of a cold welcome.
function productChatUrl(biz, productId) {
  if (biz?.telegram_bot_username) return `https://t.me/${biz.telegram_bot_username}?start=mp-${productId}`;
  if (biz?.shop_code) return `https://t.me/MiniMeAgentBot?start=shop_${biz.shop_code}__${productId}`;
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tgUserId = (searchParams.get('tg_user_id') || '').trim().slice(0, 32);
  if (!tgUserId || !/^\d+$/.test(tgUserId)) return NextResponse.json({ items: [], shops: [] });

  const sb = supabase();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();

  const [{ data: events }, { data: searches }] = await Promise.all([
    sb.from('market_events')
      .select('event_type, business_id, product_id, created_at')
      .eq('tg_user_id', tgUserId).gte('created_at', since30)
      .in('event_type', ['view_product', 'click_chat'])
      .order('created_at', { ascending: false }).limit(100),
    sb.from('search_logs')
      .select('parsed_intent')
      .eq('searcher_telegram_id', tgUserId).gte('created_at', since30)
      .order('created_at', { ascending: false }).limit(50),
  ]);

  // Map browsed businesses → their categories (one lookup).
  const browsedBizIds = [...new Set((events || []).map(e => e.business_id).filter(Boolean))];
  let bizCat = {};
  if (browsedBizIds.length) {
    const { data: bizRows } = await sb.from('businesses').select('id, category').in('id', browsedBizIds);
    bizCat = Object.fromEntries((bizRows || []).map(b => [b.id, b.category]));
  }

  // Weighted interest score per category: click 3, view 2, search 1.
  // Track the strongest signal so the reason line reflects what they actually did.
  const score = {}; // cat → { pts, signal: 'looked at'|'searched for' }
  const bump = (cat, pts, signal) => {
    if (!cat) return;
    const s = score[cat] || (score[cat] = { pts: 0, signal });
    s.pts += pts;
    if (signal === 'looked at') s.signal = 'looked at'; // browsing beats searching for the reason
  };
  for (const e of events || []) bump(bizCat[e.business_id], e.event_type === 'click_chat' ? 3 : 2, 'looked at');
  for (const s of searches || []) bump(s.parsed_intent?.category, 1, 'searched for');

  const topCats = Object.entries(score).sort((a, b) => b[1].pts - a[1].pts).slice(0, 2);
  if (!topCats.length) return NextResponse.json({ items: [], shops: [] });

  // Products they already reached out about are done — don't re-suggest them.
  const clickedProducts = new Set((events || []).filter(e => e.event_type === 'click_chat' && e.product_id).map(e => e.product_id));

  const items = [];
  for (const [cat, info] of topCats) {
    const { data: prods } = await sb.from('products')
      .select(`id, name, name_am, price, currency, image_url, business_id, businesses!inner(name, verified, category, telegram_bot_username, shop_code, logo_url, b2b_discoverable, onboarding_completed)`)
      .eq('is_active', true)
      .eq('businesses.b2b_discoverable', true)
      .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)', { foreignTable: 'businesses' })
      .ilike('businesses.category', cat)
      .order('created_at', { ascending: false })
      .limit(8);
    for (const p of prods || []) {
      if (clickedProducts.has(p.id) || items.length >= 8) continue;
      items.push({
        id: p.id, name: p.name, name_am: p.name_am || null,
        price: p.price, currency: p.currency || 'ETB', image_url: p.image_url || null,
        business_id: p.business_id, business_name: p.businesses?.name || '',
        verified: !!p.businesses?.verified,
        reason: `Because you ${info.signal} ${label(cat)}`,
        chat_url: productChatUrl(p.businesses, p.id),
      });
    }
    // Verified first within the row
    items.sort((a, b) => b.verified - a.verified);
  }

  // "Shops you might like": a category they searched but haven't browsed yet.
  let shops = [];
  const searchedOnly = Object.entries(score).find(([cat, s]) => s.signal === 'searched for' && !topCats.some(([c]) => c === cat));
  if (searchedOnly) {
    const { data: bizRows } = await sb.from('businesses')
      .select('id, name, verified, tagline, logo_url, average_rating, total_reviews, telegram_bot_username, shop_code')
      .eq('b2b_discoverable', true)
      .or('telegram_bot_username.not.is.null,shop_code.not.is.null')
      .ilike('category', searchedOnly[0])
      .order('verified', { ascending: false })
      .order('average_rating', { ascending: false, nullsFirst: false })
      .limit(2);
    shops = (bizRows || []).map(b => ({
      id: b.id, name: b.name, verified: !!b.verified,
      tagline: b.tagline || null, logo_url: b.logo_url || null,
      average_rating: b.average_rating || null, total_reviews: b.total_reviews || 0,
      reason: `Because you searched for ${label(searchedOnly[0])}`,
      chat_url: contactUrlFor(b, 'market'),
    }));
  }

  return NextResponse.json({ items, shops });
}
