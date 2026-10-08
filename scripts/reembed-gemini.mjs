/**
 * One-off: re-embed every stored vector with gemini-embedding-001 (1536 dims).
 *
 * Embeddings moved from OpenAI text-embedding-3-small to Gemini in 2026-10.
 * The two models' vectors are not comparable, so every row embedded under
 * OpenAI has to be rewritten before Gemini-embedded queries can match it:
 * products.search_embedding, businesses.search_embedding and
 * document_chunks.embedding. Text is built by the same helpers the backfill
 * crons use, so a row re-embedded here is identical to one the cron writes.
 *
 * Dry run (default) counts rows and embeds one sample of each kind — no writes:
 *   node --env-file=.env scripts/reembed-gemini.mjs
 * Rewrite everything (or one table with --only=products|businesses|chunks):
 *   node --env-file=.env scripts/reembed-gemini.mjs --write
 */
import { createClient } from '@supabase/supabase-js';
import { makeOpenAI } from '../apps/web/src/lib/server/openaiClient.js';
import { productText } from '../apps/web/src/lib/server/productEmbeddings.js';
import { businessEmbeddingText } from '../apps/web/src/lib/server/embeddingBackfill.js';

const WRITE = process.argv.includes('--write');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const BATCH = 100;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const openai = makeOpenAI();

async function embed(texts) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await openai.embeddings.create({ input: texts });
      if (r.data.length !== texts.length || r.data[0].embedding.length !== 1536) {
        throw new Error(`unexpected embedding shape: ${r.data.length} x ${r.data[0]?.embedding.length}`);
      }
      return r.data.map((d) => d.embedding);
    } catch (e) {
      if (attempt >= 5) throw e;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  embed failed (${e.status || ''} ${e.message}); retry ${attempt} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Keyset pagination (id > last seen), not OFFSET: offset paging deep into
// document_chunks hit Postgres' statement timeout partway through the run.
async function fetchAll(table, select, pageSize = 500) {
  const rows = [];
  let lastId = null;
  for (;;) {
    let q = sb.from(table).select(select).order('id').limit(pageSize);
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
    lastId = data[data.length - 1].id;
  }
}

// Embeds `items` ({ id, text }) in batches and writes `column` on `table`.
async function rewrite(table, column, items) {
  items = items.filter((it) => it.text && it.text.trim());
  console.log(`${table}.${column}: ${items.length} rows to embed`);
  if (!WRITE) {
    const [v] = await embed([items[0].text.slice(0, 8000)]);
    console.log(`  sample ok (${v.length} dims): ${JSON.stringify(items[0].text.slice(0, 90))}`);
    return { done: 0, failed: 0 };
  }
  let done = 0, failed = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    let vectors;
    try {
      vectors = await embed(batch.map((it) => it.text.slice(0, 8000)));
    } catch (e) {
      console.error(`  batch ${i}-${i + batch.length} failed: ${e.message}`);
      failed += batch.length;
      continue;
    }
    const results = await Promise.all(batch.map((it, k) =>
      sb.from(table).update({ [column]: vectors[k] }).eq('id', it.id)));
    for (const { error } of results) error ? failed++ : done++;
    console.log(`  ${Math.min(i + BATCH, items.length)}/${items.length} (failed ${failed})`);
  }
  return { done, failed };
}

async function products() {
  const rows = await fetchAll('products', 'id, name, name_am, description, image_tags, businesses(category)');
  return rewrite('products', 'search_embedding', rows.map((p) => ({ id: p.id, text: productText(p) })));
}

async function businesses() {
  const rows = await fetchAll('businesses', 'id, name, category, description, tags');
  const items = [];
  // businessEmbeddingText makes two queries per business; keep 8 in flight.
  for (let i = 0; i < rows.length; i += 8) {
    const slice = rows.slice(i, i + 8);
    const texts = await Promise.all(slice.map((b) => businessEmbeddingText(sb, b)));
    slice.forEach((b, k) => items.push({ id: b.id, text: texts[k] }));
  }
  return rewrite('businesses', 'search_embedding', items);
}

async function chunks() {
  const rows = await fetchAll('document_chunks', 'id, content');
  return rewrite('document_chunks', 'embedding', rows.map((c) => ({ id: c.id, text: c.content })));
}

const jobs = { products, businesses, chunks };
console.log(WRITE ? 'WRITE mode — overwriting vectors' : 'DRY RUN — no writes (pass --write to apply)');
const summary = {};
for (const [name, job] of Object.entries(jobs)) {
  if (ONLY && ONLY !== name) continue;
  summary[name] = await job();
}
console.log('summary:', JSON.stringify(summary));
