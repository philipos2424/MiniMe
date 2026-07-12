/**
 * /api/market/reviews — read + write shop reviews from the Market.
 *
 * GET  ?business_id=...  → { average_rating, total_reviews, reviews } (public)
 * POST { business_id, rating, comment } — WRITES require verified Telegram
 *   initData (header x-telegram-init-data). The Market can be launched from
 *   either the shared agent bot or @MiniMeSearchBot, so we accept a signature
 *   from either token. The reviewer id always comes from the VERIFIED
 *   payload, never the body.
 *
 * Write gate: the user must have actually talked to the shop first — a
 * click_chat market event or a search referral. Otherwise 403 'chat_first'.
 * One review per (business, reviewer): the reviews table's unique index
 * makes repeat submissions an update, and update_business_rating() keeps
 * businesses.average_rating/total_reviews in sync.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { rateLimit } from '../../../../lib/server/rateLimit';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id') || '';
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const sb = supabase();
  const [{ data: b }, { data: reviews }] = await Promise.all([
    sb.from('businesses').select('average_rating, total_reviews').eq('id', businessId).maybeSingle(),
    sb.from('reviews')
      .select('rating, comment, created_at')
      .eq('business_id', businessId)
      .eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    average_rating: b?.average_rating || null,
    total_reviews: b?.total_reviews || 0,
    reviews: reviews || [],
  });
}

function verifiedUser(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData) return null;
  const tokens = [process.env.TELEGRAM_BOT_TOKEN, process.env.SEARCH_BOT_TOKEN].filter(Boolean);
  for (const token of tokens) {
    if (verifyTelegramInitData(initData, token)) return parseTelegramUser(initData);
  }
  return null;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'market-review', 5, 60);
  if (!rl.ok) return NextResponse.json({ error: 'slow_down' }, { status: 429 });

  const tg = verifiedUser(request);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const reviewerId = String(tg.id);

  let body = {};
  try { body = await request.json(); } catch {}

  const businessId = UUID_RE.test(body.business_id || '') ? body.business_id : null;
  const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null;
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';
  if (!businessId || !rating) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const sb = supabase();

  // Gate: reviewer must have actually interacted with this shop.
  const [{ data: clickEvent }, { data: referral }] = await Promise.all([
    sb.from('market_events').select('id')
      .eq('event_type', 'click_chat').eq('business_id', businessId).eq('tg_user_id', reviewerId)
      .limit(1).maybeSingle(),
    sb.from('search_referrals').select('id')
      .eq('business_id', businessId).eq('customer_telegram_id', reviewerId)
      .limit(1).maybeSingle(),
  ]);
  if (!clickEvent && !referral) {
    return NextResponse.json({ error: 'chat_first' }, { status: 403 });
  }

  const { error } = await sb.from('reviews').upsert({
    business_id: businessId,
    reviewer_telegram_id: reviewerId,
    rating,
    comment: comment || null,
    visible: true,
  }, { onConflict: 'business_id,reviewer_telegram_id' });
  if (error) {
    console.error('[market] review upsert failed:', error.message);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }

  // Keep businesses.average_rating / total_reviews in sync.
  await sb.rpc('update_business_rating', { biz_id: businessId }).then(() => {}, e =>
    console.warn('[market] update_business_rating failed:', e.message));

  sb.from('market_events').insert({
    event_type: 'write_review',
    business_id: businessId,
    tg_user_id: reviewerId,
    meta: { rating },
  }).then(() => {}, () => {});

  const { data: b } = await sb.from('businesses')
    .select('average_rating, total_reviews').eq('id', businessId).maybeSingle();

  return NextResponse.json({ ok: true, average_rating: b?.average_rating || null, total_reviews: b?.total_reviews || 0 });
}
