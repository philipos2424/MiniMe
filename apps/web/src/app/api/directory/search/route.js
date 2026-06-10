/**
 * GET /api/directory/search?q=...&cat=...&limit=20
 *
 * Public search API — no auth required.
 * Returns businesses matching the query from the directory.
 * Used by the web directory page and any future integrations.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CATEGORIES = [
  'branding_design', 'printing_signage', 'photography_video', 'catering_food',
  'food_beverage', 'it_tech', 'events_entertainment', 'clothing_fashion',
  'beauty_wellness', 'construction_interior', 'transport_delivery',
  'training_consulting', 'wholesale_supply', 'electronics_phones', 'other',
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q     = (searchParams.get('q')     || '').trim().slice(0, 200);
  const cat   = (searchParams.get('cat')   || '').trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
    );

    let query = sb
      .from('businesses')
      .select('id, name, description, tagline, category, tags, location, telegram_bot_username, shop_code, search_count, logo_url, average_rating, total_reviews')
      .eq('b2b_discoverable', true)
      .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)')
      .order('average_rating', { ascending: false, nullsFirst: false })
      .order('search_count', { ascending: false, nullsFirst: false })
      .limit(limit * 3); // over-fetch for client-side keyword filter

    if (cat && ALLOWED_CATEGORIES.includes(cat)) {
      query = query.or(`category.eq.${cat},categories.cs.{${cat}}`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[directory/search]', error.message);
      return NextResponse.json({ businesses: [], error: error.message });
    }

    let results = data || [];

    // Keyword filter
    if (q) {
      const kws = q.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = results.map(b => {
        const haystack = [
          b.name, b.description, b.category,
          ...(Array.isArray(b.tags) ? b.tags : []),
          b.location,
        ].join(' ').toLowerCase();
        const hits = kws.filter(k => haystack.includes(k)).length;
        return { ...b, _score: hits };
      });
      results = scored
        .filter(b => b._score > 0)
        .sort((a, b) => b._score - a._score);
    }

    results = results.slice(0, limit).map(({ _score, ...b }) => b);

    // Attach first product image for businesses without a logo
    for (const biz of results) {
      if (!biz.logo_url) {
        try {
          const { data: p } = await sb.from('products').select('image_url')
            .eq('business_id', biz.id).eq('is_active', true)
            .not('image_url', 'is', null).limit(1);
          biz.first_product_image = p?.[0]?.image_url || null;
        } catch { biz.first_product_image = null; }
      }
    }

    return NextResponse.json({
      businesses: results,
      total: results.length,
      query: q || null,
      category: cat || null,
    }, {
      headers: {
        // Allow public caching — results update every 60s max
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    console.error('[directory/search] error:', e.message);
    return NextResponse.json({ businesses: [], error: 'search_failed' }, { status: 500 });
  }
}
