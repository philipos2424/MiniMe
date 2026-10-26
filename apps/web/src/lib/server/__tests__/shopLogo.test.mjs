/**
 * Shop logos were uploaded to the private `documents` bucket, whose public URLs
 * 404 — every shop photo was broken. Uploads now go to the public bucket and a
 * script moves the existing ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOGO_BUCKET, logoPath, documentsPathFromLogoUrl, planLogoMigration, uploadShopLogo } from '../shopLogo.mjs';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const BROKEN = 'https://hb.supabase.co/storage/v1/object/public/documents/logos/b1/logo.png?v=1700';

test('recognises a broken documents-bucket logo URL', () => {
  assert.equal(documentsPathFromLogoUrl(BROKEN), 'logos/b1/logo.png');
  assert.equal(documentsPathFromLogoUrl('https://hb.supabase.co/storage/v1/object/public/product-images/logos/b1/logo.png'), null);
  assert.equal(documentsPathFromLogoUrl(null), null);
});

test('migration plan covers both old path shapes and skips good URLs', () => {
  const plan = planLogoMigration([
    { id: 'b1', logo_url: BROKEN },
    { id: 'b2', logo_url: 'https://hb.supabase.co/storage/v1/object/public/documents/logos/b2.jpg' },
    { id: 'b3', logo_url: 'https://hb.supabase.co/storage/v1/object/public/product-images/logos/b3/logo.webp' },
  ]);
  assert.deepEqual(plan, [
    { id: 'b1', from: 'logos/b1/logo.png', to: 'logos/b1/logo.png' },
    { id: 'b2', from: 'logos/b2.jpg', to: 'logos/b2/logo.jpg' },
  ]);
});

test('uploads go to the public bucket and return a cache-busted URL', async () => {
  const calls = [];
  const sb = { storage: { from: bucket => ({
    upload: async (path, _b, opts) => { calls.push({ bucket, path, opts }); return { error: null }; },
    getPublicUrl: path => ({ data: { publicUrl: `https://x/${bucket}/${path}` } }),
  }) } };
  const url = await uploadShopLogo(sb, 'b1', Buffer.from('x'), 'image/png', 'png');
  assert.equal(LOGO_BUCKET, 'product-images');
  assert.deepEqual(calls[0], { bucket: 'product-images', path: logoPath('b1', 'png'), opts: { contentType: 'image/png', upsert: true } });
  assert.match(url, /^https:\/\/x\/product-images\/logos\/b1\/logo\.png\?v=\d+$/);
});

test('neither logo route uploads to documents any more', () => {
  for (const f of ['app/api/settings/logo/route.js', 'app/api/settings/upload-logo/route.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /from\('documents'\)/, f);
    assert.match(s, /uploadShopLogo\(/, f);
  }
});
