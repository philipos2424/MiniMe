/**
 * /api/market/favorites — heart products in the Market (Saved tab).
 *
 * Public, same trust model as /api/market/event: the Mini App sends the
 * Telegram user id from initDataUnsafe and we validate shape + rate-limit.
 * Low stakes — a spoofed id can only heart products for that id.
 *
 * GET  ?tg_user_id=...              → { product_ids, items } (hydrated)
 * POST { tg_user_id, product_id, action: 'add'|'remove' }
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { rateLimit } from '../../../../lib/server/rateLimit';
import { PRODUCT_SELECT, onlyDiscoverable, mapProduct } from '../../../../lib/server/marketCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const uid = v => (/^\d{1,32}$/.test(String(v || '')) ? String(v) : null);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tgUserId = uid(searchParams.get('tg_user_id'));
  if (!tgUserId) return NextResponse.json({ product_ids: [], items: [] });

  const sb = supabase();
  const { data: favs } = await sb.from('market_favorites')
    .select('product_id, created_at')
    .eq('tg_user_id', tgUserId)
    .order('created_at', { ascending: false })
    .limit(200);

  const ids = (favs || []).map(f => f.product_id);
  if (!ids.length) return NextResponse.json({ product_ids: [], items: [] });

  // Hydrate through the shared catalog mapper — inactive/undiscoverable
  // products silently drop out of the Saved tab but keep their heart state.
  const { data: prods } = await onlyDiscoverable(
    sb.from('products').select(PRODUCT_SELECT).in('id', ids.slice(0, 100))
  );
  const byId = new Map((prods || []).map(p => [p.id, mapProduct(p)]));
  const items = ids.map(id => byId.get(id)).filter(Boolean);

  return NextResponse.json({ product_ids: ids, items });
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'market-fav', 60, 60);
  if (!rl.ok) return NextResponse.json({ ok: true }); // silently drop floods

  let body = {};
  try { body = await request.json(); } catch {}

  const tgUserId = uid(body.tg_user_id);
  const productId = UUID_RE.test(body.product_id || '') ? body.product_id : null;
  const action = body.action === 'remove' ? 'remove' : 'add';
  if (!tgUserId || !productId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const sb = supabase();

  if (action === 'add') {
    const { error } = await sb.from('market_favorites')
      .upsert({ tg_user_id: tgUserId, product_id: productId }, { onConflict: 'tg_user_id,product_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  } else {
    await sb.from('market_favorites').delete().eq('tg_user_id', tgUserId).eq('product_id', productId);
  }

  // Log into market_events so owner analytics see favorites per product.
  sb.from('products').select('business_id').eq('id', productId).maybeSingle()
    .then(({ data }) => sb.from('market_events').insert({
      event_type: action === 'add' ? 'favorite' : 'unfavorite',
      business_id: data?.business_id || null,
      product_id: productId,
      tg_user_id: tgUserId,
    }))
    .then(() => {}, e => console.warn('[market] favorite event failed:', e.message));

  return NextResponse.json({ ok: true });
}
