/**
 * GET /api/onboarding/suggest-prompts
 *
 * The Try-It step shows three customer-style prompts so the owner has something
 * realistic to tap and see MiniMe answer. We build them from REAL products the
 * owner just taught — that's what makes the moment land ("look, it knows my
 * actual prices"). If there are no products yet, we fall back to a small set of
 * universal prompts so the step never goes blank.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Used only when the owner hasn't taught a catalog yet. Generic but never
// embarrassing — the answer will fall back to the business brief.
const GENERIC_PROMPTS = [
  'What do you sell?',
  'Where are you located?',
  'Do you deliver?',
];

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  const { data: products } = await supabase()
    .from('products')
    .select('name')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(6);

  const names = (products || [])
    .map(p => (p.name || '').trim())
    .filter(Boolean);

  if (!names.length) {
    return NextResponse.json({ prompts: GENERIC_PROMPTS });
  }

  // Build natural customer-style questions from the real product names. We mix
  // shapes so the owner sees that MiniMe handles multiple intents — price ask,
  // availability, and delivery — not just one phrasing.
  const prompts = [];
  if (names[0]) prompts.push(`Do you have ${names[0]}? How much?`);
  if (names[1]) prompts.push(`What's your price for ${names[1]}?`);
  else if (names[0]) prompts.push(`Can I order ${names[0]} today?`);
  // Delivery is a near-universal customer concern — always include it last so
  // the owner gets to see MiniMe answer a question their catalog alone doesn't.
  prompts.push('Can you deliver to Bole?');

  return NextResponse.json({ prompts: prompts.slice(0, 3) });
}
