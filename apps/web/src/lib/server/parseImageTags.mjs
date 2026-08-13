/**
 * parseImageTags — pure parser for the vision-tagging JSON response.
 *
 * Split out from productImageTags.js (which also makes the OpenAI call, and
 * so pulls in openaiClient.js's heavier import graph) so this logic can be
 * unit-tested directly, the same way searchRanker.mjs/categoryMap.mjs are:
 * dependency-free .mjs files import each other and nothing impure.
 */
const MAX_TAGS = 8;

/** Comma-joined tag string, or null if there's nothing usable. */
export function parseTagsResponse(raw) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.tags)) return null;
  const tags = parsed.tags
    .map(t => String(t || '').toLowerCase().trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  return tags.length ? tags.join(', ') : null;
}
