/**
 * Product-level embedding backfill — mirrors lib/server/embeddingBackfill.js
 * (business-level) but one embedding per PRODUCT, so the Market catalog can
 * semantically match a specific product variation instead of only the shop
 * it belongs to. Shared by the daily cron and the admin-triggered sync.
 */
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const EMBED_MODEL = 'text-embedding-3-small';
const BATCH_INPUT_SIZE = 100; // OpenAI accepts an array of inputs per call

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
  );
}

function productText(p) {
  const parts = [p.name];
  if (p.name_am) parts.push(p.name_am);
  const head = parts.join(' / ');
  const desc = p.description ? `: ${String(p.description).slice(0, 300)}` : '';
  const cat = p.businesses?.category ? ` — ${p.businesses.category}` : '';
  return `${head}${desc}${cat}`.trim();
}

/**
 * Embed up to `limit` active products (of discoverable businesses) that
 * don't have an embedding yet. Batches embed calls (BATCH_INPUT_SIZE inputs
 * per API call) instead of one call per product.
 */
export async function runProductEmbeddingBackfillBatch({ limit = 200 } = {}) {
  const supabase = sb();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, name_am, description, business_id, businesses!inner(category, b2b_discoverable)')
    .eq('is_active', true)
    .eq('businesses.b2b_discoverable', true)
    .is('search_embedding', null)
    .limit(limit);

  if (error) {
    console.warn('[product-embedding-backfill]', error.message);
    return { ok: true, skipped: true, reason: error.message };
  }
  if (!products?.length) {
    return { ok: true, processed: 0, failed: 0, batch: 0, message: 'All products have embeddings' };
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i += BATCH_INPUT_SIZE) {
    const chunk = products.slice(i, i + BATCH_INPUT_SIZE)
      .map(p => ({ id: p.id, text: productText(p) }))
      .filter(p => p.text.trim().length > 0);
    if (!chunk.length) continue;

    try {
      const r = await openai.embeddings.create({
        model: EMBED_MODEL,
        input: chunk.map(c => c.text.slice(0, 4000)),
      });
      // OpenAI returns embeddings in request order.
      await Promise.all(chunk.map(async (c, idx) => {
        const embedding = r.data[idx]?.embedding;
        if (!embedding) { failed++; return; }
        const { error: updateError } = await supabase
          .from('products').update({ search_embedding: embedding }).eq('id', c.id);
        if (updateError) { console.warn(`[product-embedding-backfill] update ${c.id}:`, updateError.message); failed++; }
        else processed++;
      }));
    } catch (e) {
      console.warn('[product-embedding-backfill] batch embed failed:', e.message);
      failed += chunk.length;
    }
  }

  return { ok: true, processed, failed, batch: products.length };
}

// ── Query embedding cache — the catalog route embeds the searcher's text on
// every request; cache identical queries briefly to cut OpenAI calls on a
// hot public endpoint. ──────────────────────────────────────────────────────
const _queryCache = new Map(); // normalized query -> { embedding, at }
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const QUERY_CACHE_MAX = 100;

export async function embedSearchQuery(q) {
  const key = String(q || '').trim().toLowerCase().slice(0, 200);
  if (!key) return null;

  const cached = _queryCache.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_TTL_MS) return cached.embedding;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: [key] });
  const embedding = r.data[0].embedding;

  if (_queryCache.size >= QUERY_CACHE_MAX) {
    const oldestKey = _queryCache.keys().next().value;
    _queryCache.delete(oldestKey);
  }
  _queryCache.set(key, { embedding, at: Date.now() });
  return embedding;
}
