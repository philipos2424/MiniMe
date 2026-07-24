/**
 * GET /api/market/product-views?id=<uuid> — public "N viewed this product"
 * count for the Market product sheet. Counts view_product market_events for one
 * product. Cached so opening product sheets doesn't hammer the DB.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return NextResponse.json({ count: 0 });

  let count = 0;
  try {
    const { count: c, error } = await supabase()
      .from('market_events')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id)
      .eq('event_type', 'view_product');
    if (error) throw new Error(error.message);
    count = c || 0;
  } catch (e) {
    console.warn('[market/product-views]', e.message);
  }
  return NextResponse.json({ count }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=180' },
  });
}
