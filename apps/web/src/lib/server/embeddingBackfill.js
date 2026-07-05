/**
 * Core embedding-backfill batch — generates search embeddings for
 * discoverable businesses that don't have one yet. Shared by the daily cron
 * (api/cron/backfill-embeddings) and the admin-triggered on-demand sync
 * (api/admin/sync-search-embeddings), so there's one source of truth for how
 * the embedding text is built instead of two copies drifting apart.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const EMBED_MODEL = 'text-embedding-3-small';

export async function runEmbeddingBackfillBatch({ limit = 100 } = {}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
  );
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, category, description, tags')
    .eq('b2b_discoverable', true)
    .is('search_embedding', null)
    .limit(limit);

  if (error) {
    console.warn('[embedding-backfill]', error.message);
    return { ok: true, skipped: true, reason: error.message };
  }
  if (!businesses?.length) {
    return { ok: true, processed: 0, failed: 0, batch: 0, message: 'All businesses have embeddings' };
  }

  let processed = 0;
  let failed = 0;

  for (const biz of businesses) {
    const parts = [
      [biz.name, biz.category, biz.description, ...(biz.tags || [])].filter(Boolean).join(' — '),
    ];

    try {
      const { data: products } = await supabase
        .from('products')
        .select('name, name_am, description, price, currency')
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
      const r = await openai.embeddings.create({ model: EMBED_MODEL, input: [text.slice(0, 8000)] });
      const embedding = r.data[0].embedding;
      const { error: updateError } = await supabase
        .from('businesses').update({ search_embedding: embedding }).eq('id', biz.id);
      if (updateError) { console.warn(`[embedding-backfill] update ${biz.id}:`, updateError.message); failed++; }
      else processed++;
    } catch (e) {
      console.warn(`[embedding-backfill] embed ${biz.id}:`, e.message);
      failed++;
    }
  }

  return { ok: true, processed, failed, batch: businesses.length };
}
