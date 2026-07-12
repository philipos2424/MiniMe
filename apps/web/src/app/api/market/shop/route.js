/**
 * GET /api/market/shop?business_id=... — full shop view inside the Market.
 *
 * Public; only discoverable shops (same rule as the catalog). Returns the
 * shop profile, its active products (shared catalog mapper), and its latest
 * visible reviews — everything the in-Market ShopView needs in one call.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { contactUrlFor } from '../../../../lib/server/searchBot';
import { PRODUCT_SELECT, onlyDiscoverable, mapProduct } from '../../../../lib/server/marketCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id') || '';
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const sb = supabase();
  const { data: b } = await sb.from('businesses')
    .select('id, name, verified, tagline, description, logo_url, category, average_rating, total_reviews, telegram_bot_username, shop_code, onboarding_completed, b2b_discoverable')
    .eq('id', businessId)
    .eq('b2b_discoverable', true)
    .maybeSingle();

  const reachable = b && (b.telegram_bot_username || (b.shop_code && b.onboarding_completed));
  if (!reachable) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [{ data: prods }, { data: reviews }] = await Promise.all([
    onlyDiscoverable(
      sb.from('products').select(PRODUCT_SELECT).eq('business_id', businessId)
    ).order('created_at', { ascending: false }).limit(48),
    sb.from('reviews')
      .select('rating, comment, created_at')
      .eq('business_id', businessId)
      .eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return NextResponse.json({
    shop: {
      id: b.id,
      name: b.name,
      verified: !!b.verified,
      tagline: b.tagline || null,
      description: b.description ? String(b.description).slice(0, 300) : null,
      logo_url: b.logo_url || null,
      category: b.category || null,
      average_rating: b.average_rating || null,
      total_reviews: b.total_reviews || 0,
      chat_url: contactUrlFor(b, 'market'),
    },
    items: (prods || []).map(mapProduct),
    reviews: reviews || [],
  });
}
