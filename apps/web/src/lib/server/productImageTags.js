/**
 * productImageTags — one-time visual tagging for a product photo.
 *
 * WHY THIS EXISTS
 * Product photos are stored (productImages.js) but never analyzed: search
 * only ever matched name/description text, so a bare photo with no
 * descriptive text — most of the catalog — was invisible to a query like
 * "red dress" no matter how good text-matching got. This produces a short,
 * plain tag string ("red, dress, cotton, casual wear") that rides the exact
 * same ilike/wordMatch/embedding-text machinery `description` already uses —
 * no new retrieval path, no per-query vision call.
 *
 * COST DISCIPLINE (this was called out explicitly as a concern):
 * - Runs ONCE per photo (upload time or one-time backfill), never per search.
 * - `detail: 'low'` — OpenAI's fixed ~85-token image cost regardless of
 *   resolution; plenty for coarse color/category/style, not meant for
 *   reading fine print (that's the separate teach/image OCR flow).
 * - Cheap model (SEARCH_MODEL, this codebase's designated structured-
 *   extraction tier) and a small max_tokens — the response is a handful of
 *   short tags, not prose.
 */
import { makeOpenAI } from './openaiClient';
import { SEARCH_MODEL } from './constants';
import { parseTagsResponse } from './parseImageTags.mjs';

let _client;
function client() {
  if (!_client) _client = makeOpenAI();
  return _client;
}

const SYSTEM_PROMPT = `Look at this product photo and list 4-8 short visual attributes a shopper would search for: item type, color(s), material, style/occasion. Respond as JSON: {"tags": ["red", "dress", "cotton", "casual"]}. Lowercase, single words or short phrases, no sentences. If the photo does not clearly show a sellable product, respond {"tags": []}.`;

export { parseTagsResponse };

/**
 * Tag a product photo. `imageUrl` is the already-public Storage URL — OpenAI
 * Vision accepts remote https URLs directly, so callers (upload routes and
 * the backfill batch) never need to re-download/base64-encode the image.
 * Best-effort: any failure (bad image, model error, malformed JSON) resolves
 * to `{ tags: null }` rather than throwing — tagging must never block an
 * upload or fail a backfill batch.
 */
export async function tagProductImage(imageUrl) {
  if (!imageUrl) return { tags: null };
  try {
    const res = await client().chat.completions.create({
      model: SEARCH_MODEL,
      max_tokens: 100,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          ],
        },
      ],
    });
    return { tags: parseTagsResponse(res.choices?.[0]?.message?.content) };
  } catch (e) {
    console.warn('[product-image-tags] tagging failed:', e.message);
    return { tags: null };
  }
}
