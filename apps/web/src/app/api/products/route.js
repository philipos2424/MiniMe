/**
 * GET  /api/products  — the caller's catalogue (active + archived)
 * POST /api/products  — add one item
 *
 * ProductsPage used to run these straight from the browser with the anon key.
 * 047_lock_down_anon_access.sql revoked every anon grant (RLS on, no policies),
 * so the reads came back empty and the inserts silently did nothing. Both now
 * run under the service role, scoped to the business the verified Telegram
 * initData belongs to.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';
import { listProducts, createProduct } from '../../../lib/server/productCrud.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveOwner(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listProducts(supabase(), { businessId: business.id }));
  } catch (error) {
    console.error('[/api/products] list failed:', error);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }
}

export async function POST(request) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const product = await createProduct(supabase(), { businessId: business.id, fields: body });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    // A missing/blank name is the caller's mistake, not a server fault.
    if (/name/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[/api/products] create failed:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
