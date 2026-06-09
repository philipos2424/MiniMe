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

  // Pull products AND the most recent uploaded documents in parallel.
  // Documents (price-list PDFs, product photos) get prompts targeting them
  // directly — the owner uploaded them expecting MiniMe to learn, and we want
  // them to deliberately test against the upload (the "it actually worked"
  // moment for them is seeing MiniMe quote their PDF back at them).
  const [productsRes, docsRes] = await Promise.all([
    supabase()
      .from('products')
      .select('name')
      .eq('business_id', business.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase()
      .from('documents')
      .select('title, tag')
      .eq('business_id', business.id)
      .in('tag', ['image_upload', 'bot_upload'])
      .order('created_at', { ascending: false })
      .limit(2),
  ]);

  const names = (productsRes.data || [])
    .map(p => (p.name || '').trim())
    .filter(Boolean);
  const docs = (docsRes.data || [])
    .map(d => ({ title: (d.title || '').trim(), tag: d.tag }))
    .filter(d => d.title);

  if (!names.length && !docs.length) {
    return NextResponse.json({ prompts: GENERIC_PROMPTS });
  }

  // Build natural customer-style questions. We mix shapes so the owner sees
  // MiniMe handle multiple intents — price ask, availability, delivery, AND
  // queries against their uploaded assets.
  const prompts = [];

  // Lead with an upload-targeted prompt when one exists — this is the highest-
  // signal moment for the owner ("MiniMe is reading my PDF? cool").
  if (docs.length > 0) {
    const d = docs[0];
    if (d.tag === 'image_upload') {
      // Photo uploads come through as image_upload. The title is usually a
      // file name or the customer-question hint — strip common cruft.
      const clean = d.title.replace(/\.(jpg|jpeg|png|webp|heic)$/i, '').replace(/[_-]+/g, ' ').trim();
      prompts.push(`Do you have the ${clean || 'one'} from the photo?`);
    } else {
      prompts.push(`Tell me what's in the price list.`);
    }
  }

  if (names[0]) prompts.push(`Do you have ${names[0]}? How much?`);
  if (names[1]) prompts.push(`What's your price for ${names[1]}?`);
  else if (names[0] && prompts.length < 2) prompts.push(`Can I order ${names[0]} today?`);

  // Delivery is a near-universal customer concern. Add it last unless we've
  // already filled all three slots with upload + product prompts.
  if (prompts.length < 3) prompts.push('Can you deliver to Bole?');

  return NextResponse.json({ prompts: prompts.slice(0, 3) });
}
