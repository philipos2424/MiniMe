const OpenAI = require('openai');
const { supabase } = require('../../../../packages/db/client');
const {
  createDocument,
  updateDocument,
  findDocumentById,
  insertChunks,
  deleteChunksForDocument,
  matchChunks,
  matchDocuments,
} = require('../../../../packages/db/queries/documents');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims
const CHUNK_SIZE = 800; // chars
const CHUNK_OVERLAP = 120;
const BUCKET = 'documents';

/**
 * Simple word-aware chunker.
 */
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = (text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      // try to break at a paragraph/sentence/space boundary
      const slice = clean.slice(i, end);
      const br = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('። '));
      if (br > size * 0.5) end = i + br + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks.filter(Boolean);
}

async function embedTexts(texts) {
  if (!texts.length) return [];
  const resp = await openai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return resp.data.map(d => d.embedding);
}

async function extractText({ buffer, mimeType, filename }) {
  const name = (filename || '').toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return { text: data.text || '', pageCount: data.numpages || null };
  }
  if (mimeType?.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) {
    return { text: buffer.toString('utf8'), pageCount: null };
  }
  // Future: docx, images with OCR.
  throw new Error(`Unsupported file type: ${mimeType || filename}`);
}

/**
 * Upload to Supabase Storage + create documents row (status: pending).
 */
async function uploadAndRegister({ businessId, buffer, filename, mimeType, title, tag, description }) {
  const storagePath = `${businessId}/${Date.now()}-${filename.replace(/[^\w.\-]/g, '_')}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  const doc = await createDocument({
    business_id: businessId,
    title: title || filename,
    tag: tag || null,
    description: description || null,
    mime_type: mimeType || null,
    storage_path: storagePath,
    original_filename: filename,
    byte_size: buffer.length,
    status: 'pending',
  });
  return doc;
}

/**
 * Full ingest: extract → chunk → embed → store.
 * Idempotent: wipes old chunks before re-embedding.
 */
async function ingestDocument(documentId) {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new Error('Document not found');
  try {
    await updateDocument(documentId, { status: 'extracting', error: null });
    const { data: fileBlob, error: dlErr } = await supabase.storage.from(BUCKET).download(doc.storage_path);
    if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);
    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    const { text, pageCount } = await extractText({
      buffer,
      mimeType: doc.mime_type,
      filename: doc.original_filename,
    });
    if (!text || !text.trim()) throw new Error('No text could be extracted');

    const chunks = chunkText(text);
    if (!chunks.length) throw new Error('No chunks produced');

    await updateDocument(documentId, { status: 'embedding', page_count: pageCount });
    await deleteChunksForDocument(documentId);

    // Embed in batches of 64
    const BATCH = 64;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const embeddings = await embedTexts(slice);
      const rows = slice.map((content, j) => ({
        document_id: documentId,
        business_id: doc.business_id,
        chunk_index: i + j,
        content,
        token_count: Math.round(content.length / 4),
        embedding: embeddings[j],
      }));
      await insertChunks(rows);
    }

    await updateDocument(documentId, { status: 'ready', error: null });
    return { ok: true, chunks: chunks.length };
  } catch (err) {
    console.error('ingestDocument error:', err);
    await updateDocument(documentId, { status: 'failed', error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Retrieve top-K chunks for a query (semantic).
 */
async function retrieveRelevantChunks(query, businessId, { count = 5, threshold = 0.3 } = {}) {
  if (!query || !businessId) return [];
  const [embedding] = await embedTexts([query]);
  return matchChunks({ embedding, business_id: businessId, threshold, count });
}

/**
 * Find the best-matching WHOLE document for a request like "send me your price list".
 * Combines semantic match on chunks + description + tag keyword match.
 */
async function matchDocumentByIntent(query, businessId, { threshold = 0.4, count = 3 } = {}) {
  if (!query || !businessId) return [];
  const [embedding] = await embedTexts([query]);
  return matchDocuments({ embedding, business_id: businessId, threshold, count });
}

/**
 * Download a document from Storage and return a Buffer (for bot.sendDocument).
 */
async function downloadDocument(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Heuristic: does the customer's message look like a request for a file?
 * e.g. "send me the price list", "can I see the menu", "do you have a brochure".
 */
function looksLikeDocumentRequest(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const keywords = [
    'price list', 'pricelist', 'menu', 'brochure', 'catalog', 'catalogue',
    'pdf', 'file', 'document', 'ዋጋ ዝርዝር', 'ሜኑ', 'ፋይል',
    'send me', 'share the', 'do you have', 'can i see', 'can you send',
  ];
  return keywords.some(k => t.includes(k));
}

module.exports = {
  chunkText,
  embedTexts,
  extractText,
  uploadAndRegister,
  ingestDocument,
  retrieveRelevantChunks,
  matchDocumentByIntent,
  downloadDocument,
  looksLikeDocumentRequest,
  BUCKET,
};
