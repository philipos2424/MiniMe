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
 * Chunks stream page by page; resume a crashed run with --after=<last id>.
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

// Postgres statement timeouts hit intermittently while the vector indexes are
// absorbing thousands of writes — retry a query rather than abort the run.
async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    const res = await fn();
    if (!res.error) return res;
    if (attempt >= 6) throw new Error(`${label}: ${res.error.message}`);
    const wait = 3000 * attempt;
    console.warn(`  ${label}: ${res.error.message}; retry ${attempt} in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// Keyset pagination (id > last seen), not OFFSET: offset paging deep into
// document_chunks hit the statement timeout partway through the run.
async function* pages(table, select, { pageSize = 200, after = null } = {}) {
  let lastId = after;
  for (;;) {
    const { data } = await withRetry(`read ${table}`, () => {
      let q = sb.from(table).select(select).order('id').limit(pageSize);
      return lastId !== null ? q.gt('id', lastId) : q;
    });
    if (data.length) yield data;
    if (data.length < pageSize) return;
    lastId = data[data.length - 1].id;
  }
}

async function fetchAll(table, select) {
  const rows = [];
  for await (const page of pages(table, select, { pageSize: 500 })) rows.push(...page);
  return rows;
}

// Writes vectors 10 at a time: 100 concurrent vector updates was enough index
// churn to push other statements past the timeout.
async function writeVectors(table, column, items, vectors) {
  let failed = 0;
  for (let i = 0; i < items.length; i += 10) {
    const results = await Promise.all(items.slice(i, i + 10).map((it, k) =>
      withRetry(`update ${table}`, () => sb.from(table).update({ [column]: vectors[i + k] }).eq('id', it.id))
        .then(() => null, (e) => e)));
    for (const err of results) if (err) { failed++; console.error(`  ${err.message}`); }
  }
  return failed;
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
    const f = await writeVectors(table, column, batch, vectors);
    failed += f; done += batch.length - f;
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

// Streams page by page (read 200 → embed → write) so a failure loses at most
// one page, and logs the last finished id: resume with --after=<id>.
async function chunks() {
  const after = process.argv.find((a) => a.startsWith('--after='))?.slice(8) || null;
  let done = 0, failed = 0;
  for await (const page of pages('document_chunks', 'id, content', { after })) {
    const items = page.filter((c) => c.content && c.content.trim());
    if (!WRITE) {
      const [v] = await embed([items[0].content.slice(0, 8000)]);
      console.log(`document_chunks: reading ok, sample embedded (${v.length} dims) — no writes`);
      return { done: 0, failed: 0 };
    }
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const vectors = await embed(batch.map((c) => c.content.slice(0, 8000)));
      const f = await writeVectors('document_chunks', 'embedding', batch, vectors);
      failed += f; done += batch.length - f;
    }
    console.log(`  chunks ${done + failed} done (failed ${failed}) — last id ${page[page.length - 1].id}`);
  }
  return { done, failed };
}

const jobs = { products, businesses, chunks };
console.log(WRITE ? 'WRITE mode — overwriting vectors' : 'DRY RUN — no writes (pass --write to apply)');
const summary = {};
for (const [name, job] of Object.entries(jobs)) {
  if (ONLY && ONLY !== name) continue;
  summary[name] = await job();
}
console.log('summary:', JSON.stringify(summary));
