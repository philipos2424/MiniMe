/**
 * GET /api/cron/backfill-embeddings
 *
 * Generates search embeddings for businesses that don't have one yet.
 * Processes up to 20 businesses per run to stay within Vercel limits.
 * Runs daily — once all businesses have embeddings, it's a no-op.
 */
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 20;
const EMBED_MODEL = 'text-embedding-3-small';

export async function GET(request) {
  const auth = request.headers.get('authorization') || '';
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const secret = process.env.CRON_SECRET;
  if (!isVercelCron && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
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
    const text = [biz.name, biz.category, biz.description, ...(biz.tags || [])]
      .filter(Boolean)
      .join(' — ');

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
