/**
 * One LLM call per line of a swap post — the item and the wants each get
 * parsed the same way, because in barter the wants line is the price and has
 * to be as searchable as the item itself.
 *
 * The same call enforces the banned list. Doing it here rather than in a
 * second pass means a refused post costs one call, not two, and a model that
 * fails open (returns nothing) refuses nothing — the fallback is an empty
 * parse, never a banned=false claim we did not earn.
 */
import { translationsOf } from '../termTranslations.mjs';
import { detectScript } from '../amharicScript.mjs';

const MAX_KEYWORDS = 8;

const BANNED = 'weapons, ammunition, drugs or medicine, currency or money, ID or government documents, live animals, human body parts, stolen goods';

const SYSTEM = `You parse one line from a barter post on an Ethiopian swap board. Input may be English or Amharic.
Return JSON with:
- category: the best-fitting broad category id (lowercase snake_case, e.g. "electronics_phones", "clothing_fashion", "home_furniture") or null
- keywords: 1-6 specific lowercase ENGLISH nouns someone would search for (e.g. ["phone","redmi"]). No adjectives, no brands-only.
- banned: if the item is one of [${BANNED}], a one-word reason such as "weapons" or "medicine". Otherwise null.
Return JSON only.`;

/** Lazily reach for the real LLM so this module stays importable under node --test. */
async function defaultComplete(args) {
  const [{ loggedCompletion }, { SEARCH_MODEL }] = await Promise.all([
    import('../openai-wrapper.js'),
    import('../constants.js'),
  ]);
  return loggedCompletion({ model: SEARCH_MODEL, ...args });
}

/**
 * Parse one line of a swap post.
 * Never throws: a failed parse yields an unfindable post, which is recoverable;
 * a thrown error yields a lost post, which is not.
 */
export async function parseSwapText(text, { complete = defaultComplete } = {}) {
  const empty = { category: null, keywords: [], banned: null };
  try {
    const res = await complete({
      route: 'swap_parse', temperature: 0.1, max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: String(text || '').slice(0, 200) },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content);
    const banned = raw.banned ? String(raw.banned).slice(0, 40) : null;
    if (banned) return { category: null, keywords: [], banned };
    const keywords = Array.isArray(raw.keywords)
      ? [...new Set(raw.keywords.map(k => String(k).toLowerCase().trim()).filter(Boolean))].slice(0, MAX_KEYWORDS)
      : [];
    return { category: raw.category ? String(raw.category) : null, keywords, banned: null };
  } catch (e) {
    console.warn('[swap] parse failed:', e.message);
    return empty;
  }
}

/** Add cross-script variants so "ጃኬት" and "jacket" land on the same posts. */
export function expandKeywords(keywords) {
  const out = new Set();
  for (const k of keywords || []) {
    const key = String(k).toLowerCase().trim();
    if (!key) continue;
    out.add(key);
    for (const t of translationsOf(key)) out.add(String(t).toLowerCase().trim());
  }
  return [...out].slice(0, MAX_KEYWORDS * 2);
}

/** Which language to speak back to this lister. */
export function postLang(text) {
  const s = detectScript(text);
  return (s === 'ethiopic' || s === 'latin-am') ? 'am' : 'en';
}
