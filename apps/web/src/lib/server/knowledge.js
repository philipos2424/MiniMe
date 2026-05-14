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
    if (error) { console.warn('match_document_chunks:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.warn('retrieveRelevantChunks:', e.message);
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
    console.warn('matchDocumentByIntent:', e.message);
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
  // Explicit "send me the file" requests
  const keywords = [
    'price list', 'pricelist', 'menu', 'brochure', 'catalog', 'catalogue',
    'pdf', 'file', 'document', 'portfolio',
    'ዋጋ ዝርዝር', 'ሜኑ', 'ፋይል', 'ካታሎግ', 'ፖርትፎሊዮ',
    'send me', 'share the', 'do you have', 'can i see', 'can you send',
  ];
  if (keywords.some(k => t.includes(k))) return true;

  // Price / cost inquiries — if the owner has uploaded a price list doc we
  // want to send it alongside the AI's answer.
  const priceInquiry = /\b(how much|what.?s the price|price of|cost of|rates?)\b/i;
  const priceInquiryAm = /(ስንት ነው|ዋጋው ስንት|ዋጋ)/;
  return priceInquiry.test(text) || priceInquiryAm.test(text);
}
