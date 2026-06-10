/**
 * GET /api/cron/backfill-embeddings
 *
 * Generates search embeddings for businesses that don't have one yet.
 * Processes up to 20 businesses per run to stay within Vercel limits.
 * Runs daily — once all businesses have embeddings, it's a no-op.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 20;
const EMBED_MODEL = 'text-embedding-3-small';

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
  );
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Find businesses without embeddings that are discoverable
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, category, description, tags')
    .eq('b2b_discoverable', true)
    .is('search_embedding', null)
    .limit(BATCH_SIZE);

  if (error) {
    // Column may not exist yet — migration not run
    console.warn('[backfill-embeddings]', error.message);
    return NextResponse.json({ ok: true, skipped: true, reason: error.message });
  }

  if (!businesses?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'All businesses have embeddings' });
  }

  let processed = 0;
  let failed = 0;

  for (const biz of businesses) {
    const parts = [
      [biz.name, biz.category, biz.description, ...(biz.tags || [])].filter(Boolean).join(' — '),
    ];

    // Fetch products for richer embedding
    try {
      const { data: products } = await supabase
        .from('products')
        .select('name, name_am, description, price, currency') // no category col on products
        .eq('business_id', biz.id)
        .eq('is_active', true)
        .limit(30);
      if (products?.length) {
        const productText = products.map(p => {
          const price = p.price != null ? ` (${Number(p.price).toLocaleString()} ${p.currency || 'ETB'})` : '';
          const desc  = p.description ? `: ${p.description.slice(0, 80)}` : '';
          return `${p.name}${p.name_am ? `/${p.name_am}` : ''}${price}${desc}`;
        }).join('; ');
        parts.push(`Products: ${productText}`);
      }
    } catch {}

    // Fetch sample replies / owner instructions
    try {
      const { data: bizDetail } = await supabase
        .from('businesses')
        .select('sample_replies, owner_instructions')
        .eq('id', biz.id)
        .single();
      if (bizDetail?.sample_replies?.length) {
        const faqs = bizDetail.sample_replies.slice(0, 10)
          .map(r => r.trigger || r.question || r.keyword || '').filter(Boolean).join('; ');
        if (faqs) parts.push(`FAQs: ${faqs}`);
        const answers = bizDetail.sample_replies.slice(0, 5)
          .map(r => (r.reply || r.answer || '').slice(0, 100)).filter(Boolean).join(' | ');
        if (answers) parts.push(`About: ${answers}`);
      }
      if (bizDetail?.owner_instructions?.length) {
        const inst = bizDetail.owner_instructions.slice(0, 8)
          .map(r => (r.content || r.instruction || r.rule || '').slice(0, 100)).filter(Boolean).join('; ');
        if (inst) parts.push(`Services: ${inst}`);
      }
    } catch {}

    const text = parts.filter(Boolean).join('\n');
    if (!text.trim()) continue;

    try {
      const r = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: [text.slice(0, 8000)],
      });
      const embedding = r.data[0].embedding;

      const { error: updateError } = await supabase
        .from('businesses')
        .update({ search_embedding: embedding })
        .eq('id', biz.id);

      if (updateError) {
        console.warn(`[backfill-embeddings] update ${biz.id}:`, updateError.message);
        failed++;
      } else {
        processed++;
      }
    } catch (e) {
      console.warn(`[backfill-embeddings] embed ${biz.id}:`, e.message);
      failed++;
    }
  }

  console.log(`[backfill-embeddings] processed=${processed} failed=${failed} remaining=${businesses.length - processed - failed}`);
  return NextResponse.json({ ok: true, processed, failed, batch: businesses.length });
}
