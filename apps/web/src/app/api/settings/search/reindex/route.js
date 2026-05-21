/**
 * POST /api/settings/search/reindex
 *
 * Triggers a fresh search embedding for the authenticated business owner.
 * Pulls products + FAQs + knowledge internally — the owner doesn't need
 * to pass anything, just authenticate.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { generateSearchEmbedding, generateAutoTags } from '../../../../../lib/server/openai-wrapper';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'business_not_found' }, { status: 404 });

  // Check what's set
  const { data: biz } = await supabase()
    .from('businesses')
    .select('name, description, category, tags, telegram_bot_username, b2b_discoverable, search_embedding, sample_replies, owner_instructions')
    .eq('id', business.id)
    .single();

  const readiness = {
    has_username:     !!biz?.telegram_bot_username,
    has_description:  !!biz?.description,
    has_category:     !!biz?.category,
    is_discoverable:  biz?.b2b_discoverable !== false,
    has_embedding:    !!biz?.search_embedding,
  };

  // Count products
  const { count: productCount } = await supabase()
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', business.id)
    .eq('is_active', true);
  readiness.product_count = productCount || 0;

  // Generate fresh embedding + tags
  const seed = [biz?.name, biz?.category, biz?.description, ...(biz?.tags || [])].filter(Boolean).join(' — ');
  await generateSearchEmbedding(business.id, seed);
  await generateAutoTags(business.id, seed).catch(() => {});

  return NextResponse.json({ ok: true, readiness });
}
