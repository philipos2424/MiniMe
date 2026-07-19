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

    // Category filter. `categories` (plural, array) only exists on some
    // deployments — referencing it in a .or() 500s the whole search where it's
    // absent. Try the richer filter first, then fall back to the scalar column.
    const catValid = cat && ALLOWED_CATEGORIES.includes(cat);
    if (catValid) {
      query = query.or(`category.eq.${cat},categories.cs.{${cat}}`);
    }

    let { data, error } = await query;
    if (error && catValid) {
      console.warn('[directory/search] category filter failed, retrying scalar:', error.message);
      let retry = sb
        .from('businesses')
        .select('id, name, description, tagline, category, tags, location, telegram_bot_username, shop_code, search_count, logo_url, average_rating, total_reviews')
        .eq('b2b_discoverable', true)
        .or('telegram_bot_username.not.is.null,and(shop_code.not.is.null,onboarding_completed.eq.true)')
        .eq('category', cat)
        .order('average_rating', { ascending: false, nullsFirst: false })
        .order('search_count', { ascending: false, nullsFirst: false })
        .limit(limit * 3);
      ({ data, error } = await retry);
    }
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

    // ── Log the search (fire-and-forget) ────────────────────────────────────
    // Feeds demand.js: unmetDemand() reads rows with results_count = 0 ("people
    // searched for this and found nothing — stock it"), searchAbandonment()
    // reads results_count > 0. Until now only the Telegram search bot logged,
    // so web searches were invisible to owners. Mirrors the bot's column shape
    // (lib/server/searchBot.js) with searcher_telegram_id null for anonymous web.
    if (q) {
      // Only columns guaranteed by supabase/migrations/minime_search.sql. The
      // source marker lives inside parsed_intent (JSONB) rather than a `via`
      // column so this keeps working whether or not migration 028 has run —
      // searchBot.js's insert of the non-existent used_gpt/via columns is
      // exactly why search logging was silently dead.
      sb.from('search_logs').insert({
        searcher_telegram_id: null,
        raw_query: q,
        parsed_intent: { source: 'web', ...(cat ? { category: cat } : {}) },
        results_count: results.length,
        results_profile_ids: results.map(b => b.id),
        language: /[ሀ-፿]/.test(q) ? 'am' : 'en',
      }).then(({ error: logErr }) => {
        // Don't fail the search over telemetry — but do surface it, otherwise a
        // schema mismatch would silently starve the demand panel forever.
        if (logErr) console.warn('[directory/search] search_logs insert failed:', logErr.message);
      }).catch(e => console.warn('[directory/search] search_logs insert threw:', e?.message));
    }

    return NextResponse.json({
      businesses: results,
      total: results.length,
      query: q || null,
      category: cat || null,
    }, {
      headers: {
        // Only cache browse (no-query) responses. Caching keyed searches would
        // let the CDN serve them without ever reaching this route, silently
        // dropping the demand signal above.
        'Cache-Control': q
          ? 'private, no-store'
          : 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    console.error('[directory/search] error:', e.message);
    return NextResponse.json({ businesses: [], error: 'search_failed' }, { status: 500 });
  }
}
