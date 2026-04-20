const { supabase } = require('../client');

async function createDocument(data) {
  const { data: row, error } = await supabase.from('documents').insert(data).select().single();
  if (error) { console.error('documents.create error:', error); return null; }
  return row;
}

async function updateDocument(id, updates) {
  const { data, error } = await supabase
    .from('documents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('documents.update error:', error); return null; }
  return data;
}

async function findDocumentById(id) {
  const { data } = await supabase.from('documents').select('*').eq('id', id).single();
  return data;
}

async function listDocuments(businessId, { enabledOnly = false } = {}) {
  let q = supabase
    .from('documents')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (enabledOnly) q = q.eq('enabled', true);
  const { data } = await q;
  return data || [];
}

async function deleteDocument(id) {
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) { console.error('documents.delete error:', error); return false; }
  return true;
}

async function insertChunks(chunks) {
  // chunks: [{ document_id, business_id, chunk_index, content, token_count, embedding }]
  if (!chunks || !chunks.length) return 0;
  const { error } = await supabase.from('document_chunks').insert(chunks);
  if (error) { console.error('document_chunks.insert error:', error); return 0; }
  return chunks.length;
}

async function deleteChunksForDocument(documentId) {
  await supabase.from('document_chunks').delete().eq('document_id', documentId);
}

async function matchChunks({ embedding, business_id, threshold = 0.3, count = 5 }) {
  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: embedding,
    p_business_id: business_id,
    match_threshold: threshold,
    match_count: count,
  });
  if (error) { console.error('match_document_chunks error:', error); return []; }
  return data || [];
}

async function matchDocuments({ embedding, business_id, threshold = 0.4, count = 3 }) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    p_business_id: business_id,
    match_threshold: threshold,
    match_count: count,
  });
  if (error) { console.error('match_documents error:', error); return []; }
  return data || [];
}

module.exports = {
  createDocument,
  updateDocument,
  findDocumentById,
  listDocuments,
  deleteDocument,
  insertChunks,
  deleteChunksForDocument,
  matchChunks,
  matchDocuments,
};
