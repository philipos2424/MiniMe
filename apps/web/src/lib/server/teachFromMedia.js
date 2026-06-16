/**
 * teachFromMedia.js
 *
 * Lets the business owner teach MiniMe by sending files directly in the bot:
 *   • PDF         → extract text with pdf-parse → chunk + embed → documents table
 *   • Image/Photo → OpenAI Vision description   → teachFromText
 *   • Text file   → raw text                    → teachFromText
 *   • URL         → scrape with webIngest        → documents table
 *
 * All functions return { ok, source, preview?, chunks?, error? }
 */
import OpenAI from 'openai';
import { supabase } from './db';
import { EMBED_MODEL, MODEL } from './constants';
import { ingestUrl } from './webIngest';
import {
  teachFromText,
  extractProductsFromText,
  upsertProductFromForward,
  extractStockChanges,
  applyStockChanges,
  extractPriceUpdates,
  applyPriceUpdates,
} from './teaching';

/* ── OCR fallback for scanned PDFs (no text layer) ───────────────────
 * Renders each page to an image with unpdf/@napi-rs/canvas and
 * transcribes it with Vision, same as a photo upload. */
const MAX_OCR_PAGES = 8;

async function ocrPdfPages(buf) {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pageCount = Math.min(pdf.numPages, MAX_OCR_PAGES);
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const dataUrl = await renderPageAsImage(pdf, i, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2,
      toDataURL: true,
    });
    const resp = await oa().chat.completions.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This is a page from a document (invoice, price list, or catalogue) sent by a business owner to teach their AI assistant. Transcribe every word of Amharic or English text visible, including item names, quantities, prices, and codes, preserving table structure as plain text rows.',
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      }],
    });
    const text = (resp.choices[0]?.message?.content || '').trim();
    if (text) pages.push(`--- Page ${i} ---\n${text}`);
  }
  return pages.join('\n\n');
}

/* ── Populate the structured catalog from extracted document text ───
 * PDFs embed directly (no teachFromText), so run catalog extraction here
 * too — a catalogue/price-list PDF should create real products. */
async function catalogFromText(businessId, text) {
  let added = 0, updated = 0;
  try {
    const items = await extractProductsFromText(text);
    for (const item of items) {
      const r = await upsertProductFromForward(businessId, item, null);
      if (r?.created) added++; else if (r) updated++;
    }
  } catch (e) {
    console.error('[teachFromMedia] catalog extraction:', e.message);
  }
  return { products_added: added, products_updated: updated };
}

/* ── Auto-apply stock + price updates from a document, against the existing
 * catalog. Runs unconditionally on PDFs so a supplier invoice / delivery
 * slip / restock sheet sent with no caption still moves stock. The LLM
 * returns {updates: []} when nothing matches, so a no-op PDF is cheap. */
async function autoApplyStockAndPrices(businessId, text) {
  const out = { stock_changes: [], price_changes: [] };
  try {
    const { data: products } = await supabase().from('products')
      .select('id, name, name_am, stock_quantity, price, currency')
      .eq('business_id', businessId).eq('is_active', true).limit(120);
    if (!products?.length) return out;
    try {
      const stockUpdates = await extractStockChanges(text, products);
      if (stockUpdates?.length) {
        const applied = await applyStockChanges(businessId, stockUpdates);
        out.stock_changes = (applied || []).filter(a => !a.error);
      }
    } catch (e) { console.warn('[teachFromMedia] auto stock:', e.message); }
    try {
      const priceUpdates = await extractPriceUpdates(text, products);
      if (priceUpdates?.length) {
        const applied = await applyPriceUpdates(businessId, priceUpdates);
        out.price_changes = (applied || []).filter(a => !a.error);
      }
    } catch (e) { console.warn('[teachFromMedia] auto price:', e.message); }
  } catch (e) {
    console.error('[teachFromMedia] autoApplyStockAndPrices:', e.message);
  }
  return out;
}

// Lazy-init — avoids crash when OPENAI_API_KEY is absent at build time
let _oa;
function oa() {
  if (!_oa) _oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });
  return _oa;
}

/* ── Telegram helpers ───────────────────────────────────────────── */
export async function getFileUrl(token, fileId) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (!j.ok || !j.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${j.result.file_path}`;
  } catch { return null; }
}

/* ── Chunk helper (mirrors webIngest) ────────────────────────────── */
function chunkText(text, size = 900, overlap = 120) {
  const clean = (text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks.filter(Boolean);
}

/* ── Embed chunks and save to documents table ─────────────────────── */
async function saveChunkedDoc({ businessId, title, tag = 'bot_upload', content, mimeType, fileName, meta = {} }) {
  const sb = supabase();
  const { data: doc, error } = await sb.from('documents').insert({
    business_id: businessId,
    title,
    tag,
    description: content.slice(0, 400),
    mime_type: mimeType,
    original_filename: fileName || title,
    status: 'embedding',
    meta,
  }).select().single();
  if (error) throw new Error(error.message);

  const chunks = chunkText(content).slice(0, 60);
  const rows = [];
  for (let i = 0; i < chunks.length; i += 20) {
    const slice = chunks.slice(i, i + 20);
    const res = await oa().embeddings.create({ model: EMBED_MODEL, input: slice });
    slice.forEach((c, j) => {
      rows.push({
        document_id: doc.id,
        business_id: businessId,
        chunk_index: i + j,
        content: c,
        token_count: Math.ceil(c.length / 4),
        embedding: res.data[j].embedding,
      });
    });
  }
  if (rows.length) await sb.from('document_chunks').insert(rows);
  await sb.from('documents').update({ status: 'ready' }).eq('id', doc.id);
  return { docId: doc.id, chunks: rows.length };
}

/* ── PUBLIC API ─────────────────────────────────────────────────── */

/**
 * Owner sent a document (PDF, image-as-doc, plain text).
 */
export async function teachFromDocument(token, businessId, msg) {
  const doc = msg.document;
  if (!doc) return { ok: false, error: 'no document' };

  const caption  = (msg.caption || '').trim();
  const mime     = doc.mime_type || '';
  const fileName = doc.file_name || 'document';

  const fileUrl = await getFileUrl(token, doc.file_id);
  if (!fileUrl) return { ok: false, error: 'could not retrieve file from Telegram' };

  try {
    // ── Image sent as doc (full resolution) → Vision describe ──────────
    if (mime.startsWith('image/')) {
      const resp = await oa().chat.completions.create({
        model: MODEL,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `This image was sent by a business owner to teach their AI assistant. Describe it in full detail: transcribe every word of Amharic or English text visible, list items with prices/codes, describe what the image shows.${caption ? ` Owner note: "${caption}"` : ''}`,
            },
            { type: 'image_url', image_url: { url: fileUrl, detail: 'high' } },
          ],
        }],
      });
      const description = (resp.choices[0]?.message?.content || '').trim();
      if (!description) return { ok: false, error: 'vision returned empty' };
      const text = caption ? `${caption}\n\n${description}` : description;
      await teachFromText(businessId, text);
      return { ok: true, source: 'image', preview: description.slice(0, 140), extracted_text: description };
    }

    // ── PDF → pdf-parse → chunk + embed ────────────────────────────────
    if (mime === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(40000) });
      const buf = Buffer.from(await res.arrayBuffer());
      let extracted = '';
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await pdfParse(buf);
        extracted = (parsed.text || '').trim();
      } catch (e) {
        console.warn('[teachFromMedia] pdf-parse:', e.message);
      }
      // pdf-parse chokes on some PDF structures (e.g. xref/stream variants).
      // unpdf (pdfjs-based) handles those — try it as a fallback.
      if (!extracted) {
        try {
          const { extractText, getDocumentProxy } = await import('unpdf');
          const pdf = await getDocumentProxy(new Uint8Array(buf));
          const { text } = await extractText(pdf, { mergePages: true });
          extracted = (Array.isArray(text) ? text.join('\n') : text || '').trim();
        } catch (e) {
          console.warn('[teachFromMedia] unpdf fallback:', e.message);
        }
      }
      // Still nothing? The PDF is likely scanned pages with no text layer —
      // render each page as an image and OCR it with Vision.
      if (!extracted) {
        try {
          extracted = await ocrPdfPages(buf);
        } catch (e) {
          console.warn('[teachFromMedia] pdf OCR fallback:', e.message);
        }
      }
      extracted = extracted.slice(0, 40000);
      if (!extracted) return { ok: false, error: 'could not extract text from PDF' };

      const content = caption ? `${caption}\n\n${extracted}` : extracted;
      const { chunks } = await saveChunkedDoc({
        businessId, title: caption || fileName, tag: 'pdf_upload',
        content, mimeType: 'application/pdf', fileName,
        meta: { source: 'bot_upload' },
      });
      // A catalogue/price-list PDF should also populate the structured catalog.
      const cat = await catalogFromText(businessId, extracted);
      // Auto-apply stock + price changes against existing catalog. This runs
      // whether or not the owner captioned the PDF — a bare supplier invoice
      // or delivery slip should still move stock.
      const auto = await autoApplyStockAndPrices(businessId, extracted);
      // Return extracted_text so callers can run stock/price extraction on the raw content
      return {
        ok: true, source: 'pdf', chunks,
        preview: extracted.slice(0, 140),
        extracted_text: extracted,
        ...cat,
        stock_changes: auto.stock_changes,
        price_changes: auto.price_changes,
      };
    }

    // ── Plain text / CSV / JSON ─────────────────────────────────────────
    if (mime.startsWith('text/') || mime === 'application/json') {
      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) });
      const text = (await res.text()).slice(0, 12000);
      const content = caption ? `${caption}\n\n${text}` : text;
      await teachFromText(businessId, content);
      return { ok: true, source: 'text_file', preview: text.slice(0, 140), extracted_text: text };
    }

    return { ok: false, error: `unsupported file type: ${mime || 'unknown'}` };
  } catch (e) {
    console.error('[teachFromMedia] document:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Owner sent a photo (not a forwarded message — forwarded ones are handled
 * separately for product extraction in replyEngine.js).
 */
export async function teachFromPhoto(token, businessId, msg) {
  if (!msg.photo?.length) return { ok: false, error: 'no photo' };

  const caption = (msg.caption || '').trim();
  const largest = msg.photo[msg.photo.length - 1];
  const fileUrl = await getFileUrl(token, largest.file_id);
  if (!fileUrl) return { ok: false, error: 'could not retrieve photo' };

  try {
    const resp = await oa().chat.completions.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `A business owner shared this photo to teach their AI assistant. Describe everything: transcribe visible text (Amharic or English), list product names, prices, contact info, hours — anything useful for answering customer questions.${caption ? ` Owner note: "${caption}"` : ''}`,
          },
          { type: 'image_url', image_url: { url: fileUrl, detail: 'high' } },
        ],
      }],
    });
    const description = (resp.choices[0]?.message?.content || '').trim();
    if (!description) return { ok: false, error: 'vision returned empty' };
    const text = caption ? `${caption}\n\n${description}` : description;
    await teachFromText(businessId, text);
    return { ok: true, source: 'photo', preview: description.slice(0, 140), extracted_text: description };
  } catch (e) {
    console.error('[teachFromMedia] photo:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Owner sent (or typed) a URL.
 * Scrapes the page and saves as an embedded document — same as the Mini App "Ingest URL" feature.
 */
export async function teachFromLink(businessId, url) {
  try {
    const result = await ingestUrl({ businessId, url, tag: 'bot_link' });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, source: 'url', chunks: result.chunks, title: result.title };
  } catch (e) {
    console.error('[teachFromMedia] url:', e.message);
    return { ok: false, error: e.message };
  }
}
