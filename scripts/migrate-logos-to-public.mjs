// Move shop logos out of the private `documents` bucket into the public
// `product-images` bucket and repoint businesses.logo_url.
//
// Why: logos were uploaded to `documents` (private) with a getPublicUrl() URL
// that 404s. On 2026-10-26 all 65 shops with a logo were affected; every shop
// photo was broken in Business Profile, MiniMe Search and MiniMe Market.
// New uploads already go to the public bucket (lib/server/shopLogo.mjs).
//
// Dry run by default — prints what it would do. Pass --apply to copy files and
// update rows. Safe to re-run: migrated rows no longer match. The originals in
// `documents` are left in place.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-logos-to-public.mjs [--apply]

import { createClient } from '@supabase/supabase-js';
import { LOGO_BUCKET, planLogoMigration } from '../apps/web/src/lib/server/shopLogo.mjs';

const apply = process.argv.includes('--apply');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: rows, error } = await sb.from('businesses').select('id, name, logo_url').not('logo_url', 'is', null);
if (error) { console.error(error.message); process.exit(1); }

const plan = planLogoMigration(rows);
console.log(`${plan.length} of ${rows.length} logos point at the private documents bucket.${apply ? '' : ' (dry run — pass --apply to move them)'}`);

let moved = 0, failed = 0;
for (const p of plan) {
  if (!apply) { console.log(`would move ${p.from} -> ${LOGO_BUCKET}/${p.to}`); continue; }
  const { data: blob, error: dlErr } = await sb.storage.from('documents').download(p.from);
  if (dlErr || !blob) { failed++; console.warn(`skip ${p.id}: download failed (${dlErr?.message || 'no data'})`); continue; }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const { error: upErr } = await sb.storage.from(LOGO_BUCKET).upload(p.to, bytes, { contentType: blob.type || 'image/jpeg', upsert: true });
  if (upErr) { failed++; console.warn(`skip ${p.id}: upload failed (${upErr.message})`); continue; }
  const { data: pub } = sb.storage.from(LOGO_BUCKET).getPublicUrl(p.to);
  const { error: rowErr } = await sb.from('businesses').update({ logo_url: `${pub.publicUrl}?v=${Date.now()}` }).eq('id', p.id);
  if (rowErr) { failed++; console.warn(`skip ${p.id}: row update failed (${rowErr.message})`); continue; }
  moved++;
}
if (apply) console.log(`moved ${moved}, failed ${failed}`);
