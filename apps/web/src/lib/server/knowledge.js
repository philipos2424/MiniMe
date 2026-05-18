/**
 * Knowledge RAG for the webhook reply engine.
 *
 * - retrieveRelevantChunks: semantic search for reply-time context injection
 * - matchDocumentByIntent: find a whole doc the user seems to be asking for
 * - downloadDocument: pull bytes from Supabase Storage (for sendDocument)
 * - looksLikeDocumentRequest: cheap pre-filter ("send me the price list")
 */
import OpenAI from 'openai';
import { supabase } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });
import { EMBED_MODEL } from './constants';
const BUCKET = 'documents';

async function embed(text) {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: [text] });
  return r.data[0].embedding;
}

export async function retrieveRelevantChunks(query, businessId, { count = 4, threshold = 0.3 } = {}) {
  if (!query || !businessId) return [];
  try {
    const embedding = await embed(query);
    const { data, error } = await supabase().rpc('match_document_chunks', {
      query_embedding: embedding,
      p_business_id: businessId,
      match_threshold: threshold,
      match_count: count,
    });
    if (error) { console.warn('[knowledge] match_document_chunks:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[knowledge][WARN] Embedding API failed — replies will lack knowledge context:', e.message);
    return [];
  }
}

export async function matchDocumentByIntent(query, businessId, { threshold = 0.4, count = 3 } = {}) {
  if (!query || !businessId) return [];
  try {
    const embedding = await embed(query);
    const { data, error } = await supabase().rpc('match_documents', {
      query_embedding: embedding,
      p_business_id: businessId,
      match_threshold: threshold,
      match_count: count,
    });
    if (error) { console.warn('match_documents:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[knowledge][WARN] Embedding API failed for doc match:', e.message);
    return [];
  }
}

export async function downloadDocument(storagePath) {
  const { data, error } = await supabase().storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Download failed: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export function looksLikeDocumentRequest(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  // Explicit file/doc/image request keywords
  const keywords = [
    // English
    'price list', 'pricelist', 'menu', 'brochure', 'catalog', 'catalogue',
    'pdf', 'file', 'document', 'portfolio', 'photo', 'picture', 'image',
    'sample', 'samples', 'lookbook', 'design',
    'send me', 'share the', 'share your', 'can i see', 'can you send',
    'show me', 'do you have a', 'send the', 'attach',
    // Amharic
    'ዋጋ ዝርዝር', 'ሜኑ', 'ፋይል', 'ካታሎግ', 'ፖርትፎሊዮ',
    'ፎቶ', 'ስዕል', 'ሳምፕል', 'አሳይ', 'ላክ', 'ስጠኝ',
  ];
  if (keywords.some(k => t.includes(k))) return true;

  // Price / cost inquiries — send the price list doc if available
  const priceInquiry = /\b(how much|what.?s the price|price of|cost of|rates?|pricing|package)\b/i;
  const priceInquiryAm = /(ስንት ነው|ዋጋው ስንት|ዋጋ|ስንቱ)/;
  if (priceInquiry.test(text) || priceInquiryAm.test(text)) return true;

  // "What do you have?" / "What services?" — may want catalog
  const catalogInquiry = /\b(what do you (have|offer|sell)|what.?s (available|in stock)|your (services|products|offerings))\b/i;
  return catalogInquiry.test(text);
}
