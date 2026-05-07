/**
 * Web ingestion — fetch a URL, extract clean text, chunk, embed, store as a
 * document in the business's knowledge base so Alfred can retrieve from it
 * on future turns.
 *
 * Used by the brain's `research_url` tool and by a manual owner trigger
 * when they add/update their website on /settings.
 */
import OpenAI from 'openai';
import { supabase } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = 'text-embedding-3-small';

// Strip HTML → plain text. Keeps headings and lists by inserting newlines.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(h\d|p|li|div|section|article|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text, size = 900, overlap = 120) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += (size - overlap);
  }
  return chunks;
}

async function embedBatch(inputs) {
  if (!inputs.length) return [];
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: inputs });
  return r.data.map(d => d.embedding);
}

/**
 * Fetch a URL, extract text, and persist as a `documents` row + embedded chunks.
 * If the same URL was ingested for this business before, replace its chunks.
 * Returns { ok, title, chars, chunks } or { ok:false, error }.
 */
export async function ingestUrl({ businessId, url, tag = 'website' }) {
  if (!businessId || !url) return { ok: false, error: 'missing args' };
  const safeUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  let html;
  try {
    const res = await fetch(safeUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (MiniMe-Agent/1.0)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { ok: false, error: `fetch: ${e.message}` };
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || safeUrl).trim().slice(0, 200);
  const text = htmlToText(html);
  if (!text || text.length < 60) return { ok: false, error: 'empty page' };

  const sb = supabase();

  // Reuse existing doc for same URL (meta.url) so we don't duplicate.
  const { data: existing } = await sb.from('documents')
    .select('id').eq('business_id', businessId).eq('tag', tag)
    .contains('meta', { url: safeUrl }).limit(1).maybeSingle();

  let docId = existing?.id;
  if (docId) {
    await sb.from('document_chunks').delete().eq('document_id', docId);
    await sb.from('documents').update({
      title, description: text.slice(0, 400),
      status: 'embedding', updated_at: new Date().toISOString(),
    }).eq('id', docId);
  } else {
    const { data: doc, error } = await sb.from('documents').insert({
      business_id: businessId,
      title,
      tag,
      description: text.slice(0, 400),
      mime_type: 'text/html',
      original_filename: safeUrl,
      status: 'embedding',
      meta: { url: safeUrl },
    }).select().single();
    if (error) return { ok: false, error: error.message };
    docId = doc.id;
  }

  const chunks = chunkText(text).slice(0, 40); // cap at ~36k chars
  // Embed in batches of 20
  const rows = [];
  for (let i = 0; i < chunks.length; i += 20) {
    const slice = chunks.slice(i, i + 20);
    const embeddings = await embedBatch(slice);
    slice.forEach((content, j) => {
      rows.push({
        document_id: docId,
        business_id: businessId,
        chunk_index: i + j,
        content,
        token_count: Math.ceil(content.length / 4),
        embedding: embeddings[j],
      });
    });
  }
  if (rows.length) await sb.from('document_chunks').insert(rows);
  await sb.from('documents').update({ status: 'ready' }).eq('id', docId);

  return { ok: true, document_id: docId, title, chars: text.length, chunks: rows.length };
}
