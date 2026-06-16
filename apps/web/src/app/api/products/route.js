/**
 * /api/products
 *
 * GET  — list this business's products.
 *        ?status=active   (default) → { products }   active only, ordered by name
 *        ?status=archived          → { products }   inactive, ordered by name, limit 20
 *        ?status=all               → { active, archived }
 * POST — create one or many products.
 *        Body: { product: {...} }   → { product }
 *              { products: [...] }  → { products, count }
 *
 * SECURITY: the dashboard's anon key can't touch `products` after the RLS
 * lockdown. This route uses the service role, verifies Telegram initData, and
 * ALWAYS forces business_id to the caller's own business — a client-supplied
 * business_id is ignored. Writable columns are whitelisted.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Columns a client may set on a product. Everything else (id, business_id,
// image_url, timestamps) is server-controlled or set via dedicated endpoints.
const ALLOWED_FIELDS = new Set([
  'name', 'name_am', 'description', 'description_am', 'category',
  'price', 'cost_price', 'currency', 'stock_quantity', 'low_stock_threshold',
  'bulk_discount_threshold', 'bulk_discount_percent', 'max_negotiable_discount',
  'is_active',
]);

function clean(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

async function authBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? await findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await authBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const status = new URL(request.url).searchParams.get('status') || 'active';
  const sb = supabase();
  const base = () => sb.from('products').select('*').eq('business_id', business.id);

  if (status === 'all') {
    const [{ data: active }, { data: archived }] = await Promise.all([
      base().eq('is_active', true).order('name'),
      base().eq('is_active', false).order('name').limit(20),
    ]);
    return NextResponse.json({ active: active || [], archived: archived || [] });
  }

  let q = base().order('name');
  if (status === 'archived') q = q.eq('is_active', false).limit(20);
  else q = q.eq('is_active', true);
  const { data } = await q;
  return NextResponse.json({ products: data || [] });
}

export async function POST(request) {
  const business = await authBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const sb = supabase();

  // Batch insert (CSV import)
  if (Array.isArray(body.products)) {
    const rows = body.products
      .map(p => ({ ...clean(p), business_id: business.id }))
      .filter(p => p.name); // name is required
    if (!rows.length) return NextResponse.json({ error: 'no_valid_products' }, { status: 400 });
    const { data, error } = await sb.from('products').insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ products: data || [], count: data?.length || 0 });
  }

  // Single insert
  const product = { ...clean(body.product), business_id: business.id };
  if (!product.name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
  const { data, error } = await sb.from('products').insert(product).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}
