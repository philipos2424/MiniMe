/**
 * /api/market/follows — follow shops inside the Market.
 *
 * Same public trust model as favorites (shape-validated tg_user_id + IP
 * rate limit). Following persists the relationship now; later it can power
 * "shop you follow posted something new" notifications.
 *
 * GET  ?tg_user_id=...               → { business_ids, shops } (hydrated)
 * POST { tg_user_id, business_id, action: 'add'|'remove' }
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { rateLimit } from '../../../../lib/server/rateLimit';
import { contactUrlFor } from '../../../../lib/server/searchBot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const uid = v => (/^\d{1,32}$/.test(String(v || '')) ? String(v) : null);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const tgUserId = uid(searchParams.get('tg_user_id'));
  if (!tgUserId) return NextResponse.json({ business_ids: [], shops: [] });

  const sb = supabase();
  const { data: follows } = await sb.from('market_follows')
    .select('business_id, created_at')
    .eq('tg_user_id', tgUserId)
    .order('created_at', { ascending: false })
    .limit(100);

  const ids = (follows || []).map(f => f.business_id);
  if (!ids.length) return NextResponse.json({ business_ids: [], shops: [] });

  const { data: bizRows } = await sb.from('businesses')
    .select('id, name, verified, tagline, logo_url, average_rating, total_reviews, telegram_bot_username, shop_code, b2b_discoverable')
    .in('id', ids.slice(0, 100))
    .eq('b2b_discoverable', true);

  const byId = new Map((bizRows || []).map(b => [b.id, {
    id: b.id,
    name: b.name,
    verified: !!b.verified,
    tagline: b.tagline || null,
    logo_url: b.logo_url || null,
    average_rating: b.average_rating || null,
    total_reviews: b.total_reviews || 0,
    chat_url: contactUrlFor(b, 'market'),
  }]));
  const shops = ids.map(id => byId.get(id)).filter(Boolean);

  return NextResponse.json({ business_ids: ids, shops });
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'market-follow', 60, 60);
  if (!rl.ok) return NextResponse.json({ ok: true });

  let body = {};
  try { body = await request.json(); } catch {}

  const tgUserId = uid(body.tg_user_id);
  const businessId = UUID_RE.test(body.business_id || '') ? body.business_id : null;
  const action = body.action === 'remove' ? 'remove' : 'add';
  if (!tgUserId || !businessId) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const sb = supabase();

  if (action === 'add') {
    const { error } = await sb.from('market_follows')
      .upsert({ tg_user_id: tgUserId, business_id: businessId }, { onConflict: 'tg_user_id,business_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: 'failed' }, { status: 500 });
  } else {
    await sb.from('market_follows').delete().eq('tg_user_id', tgUserId).eq('business_id', businessId);
  }

  sb.from('market_events').insert({
    event_type: action === 'add' ? 'follow' : 'unfollow',
    business_id: businessId,
    tg_user_id: tgUserId,
  }).then(() => {}, e => console.warn('[market] follow event failed:', e.message));

  return NextResponse.json({ ok: true });
}
