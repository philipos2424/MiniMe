/**
 * Shared product-photo storage: validate a file + buffer, upload it to the
 * PUBLIC 'product-images' Supabase Storage bucket, and return its public URL.
 * No DB writes here — callers decide which row (if any) to attach the URL to.
 *
 * Used by /api/products/[id]/image (deliberate per-product photo upload) and
 * /api/teach/image (onboarding "add a product photo" quick action).
 */
import { imageFile, ValidationError } from './sanitize';

const BUCKET = 'product-images';
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

// Magic-byte sniff for the formats imageFile() allows by mime/extension.
// HEIC/HEIF is an ISO base media file: a 4-byte size, then 'ftyp' at offset 4,
// then a 4-byte brand at offset 8 — iPhone captures inside the Telegram Mini
// App are commonly HEIC, so this must be recognized or those photos silently
// never make it to storage.
function isValidImageMagic(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true; // WebP (RIFF)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase().trim();
    if (HEIC_BRANDS.has(brand)) return true;
  }
  return false;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} businessId
 * @param {File} file - the multipart File (used for mime/name/type)
 * @param {Buffer} buf - the already-read file bytes
 * @param {object} opts
 * @param {string} opts.label - identifies the upload within the business's folder (e.g. a product id, or a random token when none exists yet)
 * @param {number} [opts.maxBytes]
 * @returns {Promise<{ image_url: string }>}
 * @throws {ValidationError} on bad mime/extension/size/magic bytes
 * @throws {Error} on Storage upload failure
 */
export async function storeProductPhoto(sb, businessId, file, buf, { label, maxBytes = 5 * 1024 * 1024 } = {}) {
  const { ext } = imageFile(file, { field: 'file' });
  if (buf.length > maxBytes) {
    throw new ValidationError('file', 'file too large (max 5 MB)');
  }
  if (!isValidImageMagic(buf)) {
    throw new ValidationError('file', 'file content does not match a supported image format');
  }

  const path = `products/${businessId}/${label}-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw new Error(`upload_failed: ${upErr.message}`);

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) throw new Error('no_public_url');
  return { image_url: pub.publicUrl };
}
