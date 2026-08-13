/**
 * Shared upload helper used by the onboarding wizard AND the dashboard's
 * Teach page. Branches on file type:
 *   - image/* → POST /api/teach/image      (Vision → products + document)
 *   - PDF/text → POST /api/documents/upload (chunked + embedded)
 *
 * Both endpoints accept `x-telegram-init-data` auth and return JSON with
 * a normalised `{ products_added, document_id?, summary? }` shape after
 * we unwrap their responses.
 *
 * Caller is responsible for showing busy/done UI and surfacing errors —
 * this is a thin transport helper, not a hook.
 *
 * Throws Error on failure so the caller can catch.
 */

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB — matches the dashboard cap.

export function isImage(file) {
  return !!file?.type?.startsWith('image/');
}

/**
 * Upload a file and teach the AI from it.
 *
 * @param {File} file - The file to upload (image or PDF).
 * @param {object} opts
 * @param {string} opts.initData - Telegram initData header value.
 * @param {string} [opts.title] - Optional title hint (e.g. the customer question
 *   that triggered the upload in Try-It). Falls back to the file name.
 * @param {string} [opts.intent] - Image uploads only. 'product_photo' signals
 *   /api/teach/image to also store the image and attach it to a product (so
 *   it becomes the shop's MiniMe Search thumbnail). Omit for the price-list /
 *   generic-upload path, which keeps today's text-extraction-only behavior.
 * @returns {Promise<{ kind: 'image'|'document', products_added: number, document_id?: string, summary?: string, image_url?: string|null }>}
 */
export async function uploadProduct(file, { initData, title, intent } = {}) {
  if (!file) throw new Error('No file provided');
  if (!initData) throw new Error('Missing auth');
  if (file.size > MAX_BYTES) throw new Error('File too large (max 15 MB)');

  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('title', title || file.name);
  fd.append('tag', isImage(file) ? 'image_upload' : 'bot_upload');
  if (isImage(file) && intent) fd.append('intent', intent);

  const endpoint = isImage(file) ? '/api/teach/image' : '/api/documents/upload';
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'x-telegram-init-data': initData },
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'upload failed');

  return {
    kind: isImage(file) ? 'image' : 'document',
    products_added: j.products_added || 0,
    document_id: j.document_id || j.document?.id || null,
    summary: j.summary || null,
    image_url: j.image_url || null,
  };
}
