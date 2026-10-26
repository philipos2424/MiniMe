/**
 * Shop logos live in the PUBLIC `product-images` bucket.
 *
 * Both logo routes uploaded to `documents`, which is private, and stored its
 * getPublicUrl() — a URL that 404s for everyone. On 2026-10-26 all 65 shops
 * with a logo had one of those, so every shop photo was broken in Business
 * Profile, MiniMe Search and MiniMe Market. scripts/migrate-logos-to-public.mjs
 * moves the existing ones; this module is what uploads use from now on.
 */
export const LOGO_BUCKET = 'product-images';
const DOCUMENTS_PUBLIC = /\/storage\/v1\/object\/public\/documents\/([^?]+)/;

export function logoPath(businessId, ext) {
  return `logos/${businessId}/logo.${ext}`;
}

/** Storage path inside `documents` for a broken logo URL, or null if it isn't one. */
export function documentsPathFromLogoUrl(url) {
  const m = String(url || '').match(DOCUMENTS_PUBLIC);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Which rows need moving: { id, from (documents path), to (public-bucket path) }. */
export function planLogoMigration(rows) {
  const out = [];
  for (const r of rows || []) {
    const from = documentsPathFromLogoUrl(r.logo_url);
    if (!from) continue;
    const ext = (from.split('.').pop() || 'jpg').toLowerCase();
    out.push({ id: r.id, from, to: logoPath(r.id, ext) });
  }
  return out;
}

/** Upload a logo and return its cache-busted public URL. Throws on failure. */
export async function uploadShopLogo(sb, businessId, bytes, mime, ext) {
  const path = logoPath(businessId, ext);
  const { error } = await sb.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // Same path on every re-upload, so bust browser and card caches.
  return `${data.publicUrl}?v=${Date.now()}`;
}
