// One-off: create the public 'product-images' bucket and move existing product
// photos out of the private 'documents' bucket (where their public URLs 403).
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://hbmesjhkczhqpbdseifd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const NEW_BUCKET = 'product-images';

async function main() {
  const { error: bErr } = await sb.storage.createBucket(NEW_BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  });
  if (bErr && !/already exists/i.test(bErr.message)) throw bErr;
  console.log('bucket ready:', NEW_BUCKET, bErr ? `(existed: ${bErr.message})` : '(created)');

  const { data: rows, error: qErr } = await sb
    .from('products')
    .select('id, image_url')
    .like('image_url', '%/documents/products/%');
  if (qErr) throw qErr;
  console.log('to migrate:', rows.length);

  for (const r of rows) {
    const key = r.image_url.split('/documents/')[1];
    if (!key) { console.warn('skip (no key):', r.id, r.image_url); continue; }

    const { data: file, error: dErr } = await sb.storage.from('documents').download(key);
    if (dErr || !file) { console.warn('download failed:', r.id, dErr && dErr.message); continue; }
    const buf = Buffer.from(await file.arrayBuffer());

    const ext = (key.split('.').pop() || 'png').toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    const { error: uErr } = await sb.storage.from(NEW_BUCKET).upload(key, buf, { contentType, upsert: true });
    if (uErr) { console.warn('upload failed:', r.id, uErr.message); continue; }

    const { data: pub } = sb.storage.from(NEW_BUCKET).getPublicUrl(key);
    const newUrl = pub && pub.publicUrl;
    if (!newUrl) { console.warn('no public url:', r.id); continue; }

    const { error: upErr } = await sb.from('products').update({ image_url: newUrl }).eq('id', r.id);
    if (upErr) { console.warn('db update failed:', r.id, upErr.message); continue; }
    console.log('migrated:', r.id, '->', newUrl);
  }
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); });
