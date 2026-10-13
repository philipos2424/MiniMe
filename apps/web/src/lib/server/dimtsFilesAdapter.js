import { supabase } from './db';
import { resolveToken } from './sendAs';
import { createFileService, fileError } from './dimtsFiles.mjs';

async function checked(query) {
  const { data, error } = await query;
  if (error) throw fileError('storage_unavailable', 503);
  return data;
}
const db = () => supabase();
export const handleDimtsFiles = createFileService({
  async business(userId) {
    const link = await checked(db().from('dimts_links').select('business_id').eq('dimts_user_id', userId).maybeSingle());
    return link ? checked(db().from('businesses').select('*').eq('id', link.business_id).maybeSingle()) : null;
  },
  customers: (id, phone) => checked(db().from('customers').select('id,name,phone,telegram_id')
    .eq('business_id', id).not('telegram_id', 'is', null).ilike('phone', `%${phone.slice(-7)}`).limit(100)),
  customer: (business, id) => checked(db().from('customers').select('id,name,phone,telegram_id')
    .eq('business_id', business).eq('id', id).maybeSingle()),
  documents: id => checked(db().from('documents').select('id,title,original_filename')
    .eq('business_id', id).eq('enabled', true).eq('status', 'ready').not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(100)),
  document: (business, id) => checked(db().from('documents').select('id,title,original_filename,storage_path,enabled,status')
    .eq('business_id', business).eq('id', id).maybeSingle()),
  async download(path) {
    const data = await checked(db().storage.from('documents').download(path));
    if (data.size > 20 * 1024 * 1024) throw fileError('file_size_unsupported');
    return Buffer.from(await data.arrayBuffer());
  },
  async preview(path) {
    const data = await checked(db().storage.from('documents').createSignedUrl(path, 60));
    return data.signedUrl;
  },
  prior: (business, id) => checked(db().from('dimts_file_deliveries').select('status,message_id,error,request_hash')
    .eq('business_id', business).eq('send_id', id).maybeSingle()),
  async claim(row) {
    const { error } = await db().from('dimts_file_deliveries').insert(row);
    if (error?.code === '23505') return false;
    if (error) throw fileError('storage_unavailable', 503);
    return true;
  },
  async finish(business, id, result) {
    await checked(db().from('dimts_file_deliveries').update({ ...result, updated_at: new Date().toISOString() })
      .eq('business_id', business).eq('send_id', id).eq('status', 'sending'));
  },
  async send(business, chatId, bytes, filename, caption) {
    const token = resolveToken(business, { as: 'bot' });
    if (!token) return { ok: false };
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([bytes]), filename);
    if (caption) form.append('caption', caption);
    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(40_000),
    });
    return response.json();
  },
});
