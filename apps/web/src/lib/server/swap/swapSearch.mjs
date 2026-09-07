/**
 * Swap discovery, appended under the business results.
 *
 * Two blocks come out of one query. The first matches the searcher's words
 * against what people HAVE. The second matches the same words against what
 * people WANT — the reverse index, which costs nothing extra and roughly
 * doubles the chance a thin pool produces a hit.
 *
 * The caps here are commercial. Businesses pay for MiniMe; swaps are the
 * funnel that feeds it. Three cards, always below the shops, never on a query
 * that reads like someone ready to buy.
 */
import { MAX_SWAP_CARDS } from './constants.mjs';
import { areaLabel } from './swapAreas.mjs';
// The repo's one Markdown escaper, shared with every other bot surface. It is
// a pure string function — telegramApi.js does its network work inside
// functions and imports `./db` lazily, so pulling it in here keeps this module
// importable under `node --test` with no token, no DB and no fetch.
import { escapeMarkdown } from '../telegramApi.js';

/** Words that mean "I am shopping", where a barter card is noise at best. */
const COMMERCIAL_LATIN = [
  'delivery', 'deliver', 'wholesale', 'shop', 'shops', 'store', 'supplier',
  'suppliers', 'bulk', 'invoice', 'warranty',
];
const COMMERCIAL_ETHIOPIC = ['ማድረስ', 'ጅምላ', 'ሱቅ'];

// `\b` is ASCII word-boundary only — it never fires on Ethiopic script, so
// Latin terms are matched on word boundaries (to avoid "workshop" catching
// "shop", "restore" catching "store") while Ethiopic terms stay substring
// matches.
const COMMERCIAL_LATIN_RE = new RegExp(
  `\\b(?:${COMMERCIAL_LATIN.join('|')})\\b`,
  'i',
);

export function isCommercialQuery(text) {
  const t = String(text || '');
  if (COMMERCIAL_LATIN_RE.test(t)) return true;
  const lower = t.toLowerCase();
  return COMMERCIAL_ETHIOPIC.some(w => lower.includes(w));
}

const freshness = (r) => new Date(r.created_at || 0).getTime();

function sortForSearcher(rows, searcherArea) {
  return [...rows].sort((a, b) => {
    if (searcherArea) {
      const an = a.area === searcherArea ? 0 : 1;
      const bn = b.area === searcherArea ? 0 : 1;
      if (an !== bn) return an - bn;
    }
    return freshness(b) - freshness(a);
  });
}

/**
 * Choose which cards to show. Haves fill first — someone searching "phone"
 * most wants a phone — and wants take whatever room is left, so the reverse
 * block never crowds out the direct answer.
 */
export function selectSwapCards({ haves = [], wants = [], searcherArea = null }) {
  const h = sortForSearcher(haves, searcherArea);
  const w = sortForSearcher(wants, searcherArea);
  const takeHaves = Math.min(h.length, h.length >= MAX_SWAP_CARDS && w.length ? MAX_SWAP_CARDS - 1 : MAX_SWAP_CARDS);
  const chosenHaves = h.slice(0, takeHaves);
  const chosenWants = w.slice(0, Math.max(0, MAX_SWAP_CARDS - chosenHaves.length));
  return { haves: chosenHaves, wants: chosenWants };
}

const L = {
  havesHeader: { en: '🔄 *Swaps from people*', am: '🔄 *ከሰዎች የሚቀየሩ*' },
  wantsHeader: { en: '🙋 *People who WANT', am: '🙋 *የሚፈልጉ ሰዎች —' },
  wants:       { en: 'Wants:', am: 'ይፈልጋል:' },
  offering:    { en: 'offering:', am: 'ያቀርባል:' },
  button:      { en: "🔄 I'll swap for this", am: '🔄 እቀይራለሁ' },
  empty:       { en: (q) => `Nobody's swapping ${q} yet. Have one to trade? Just send me a photo.`,
                 am: (q) => `${q} የሚቀይር ሰው የለም። አለዎት? ፎቶ ይላኩልኝ።` },
};

const pick = (k, lang) => L[k][lang === 'am' ? 'am' : 'en'];

const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
};

/**
 * Render both blocks. Every swap post carries at least one photo, so a card is
 * a *photo* card — same shape `sendResults` already uses for business results
 * ({ photo, caption, keyboard }), so the caller sends them the same way and
 * falls back to the caption as text if Telegram refuses the photo.
 *
 * Every piece of lister-supplied text (title, wants, free-text area) and the
 * searcher's own query is escaped before it reaches a Markdown message.
 * Unescaped, a title of `[Verify your account](https://evil.example)` would
 * render as a live hyperlink sent by the trusted bot, and a stray `*` would
 * make Telegram reject the whole message — which, with the caller's
 * `.catch(() => {})`, would silently delete the swap block for every searcher.
 *
 * Returns null when there is nothing to append — the caller must not print an
 * empty header.
 */
export function formatSwapBlocks({ haves = [], wants = [], query, lang = 'en' }) {
  if (!haves.length && !wants.length) return null;
  const lines = [];
  const keyboard = [];
  const photoCards = [];

  const button = (r) => ({
    // Button labels are plain text to Telegram, never Markdown — escaping one
    // would show the reader a literal backslash.
    text: `${pick('button', lang)} — ${r.title}`.slice(0, 64),
    callback_data: `sw:want:${r.id}`,
  });

  // A card with a photo goes out as a photo; one without (only possible for a
  // row written before photos were mandatory) degrades to a text card in the
  // same message, so nothing is ever dropped.
  const emit = (r, caption) => {
    const photo = Array.isArray(r.photo_file_ids) ? r.photo_file_ids[0] : null;
    if (photo) {
      photoCards.push({ photo, caption, keyboard: [[button(r)]] });
    } else {
      lines.push(caption, '');
      keyboard.push([button(r)]);
    }
  };

  const where = (r) => `${escapeMarkdown(areaLabel(r.area, lang))} · ${ago(r.created_at)}`;

  if (haves.length) {
    lines.push('', pick('havesHeader', lang));
    for (const r of haves) {
      emit(r, [
        `*${escapeMarkdown(r.title)}*`,
        `${pick('wants', lang)} ${escapeMarkdown(r.wants_text)}`,
        where(r),
      ].join('\n'));
    }
  }

  if (wants.length) {
    lines.push('', `${pick('wantsHeader', lang)} ${escapeMarkdown(query)}*`);
    for (const r of wants) {
      emit(r, [
        `🙋 wants *${escapeMarkdown(r.wants_text)}* — ${pick('offering', lang)} ${escapeMarkdown(r.title)}`,
        where(r),
      ].join('\n'));
    }
  }

  return { text: lines.join('\n').trim(), keyboard, photoCards };
}

/** Shown when a search found no swaps: the gap advertises itself. */
export function swapEmptyLine(query, lang = 'en') {
  return pick('empty', lang)(query);
}

/**
 * Pull both candidate sets in one round trip each. The searcher's own posts
 * are excluded — being shown your own jacket back is the fastest way to look
 * broken.
 *
 * `unavailable` is the difference between "we looked and found nothing" and
 * "we could not look". Migrations here are applied by hand, so between deploy
 * and migration `swap_items` does not exist and Supabase answers
 * `{ data: null, error }` rather than throwing. Without this flag the caller
 * would read that as an empty result and append "Nobody's swapping X yet" to
 * every single search in the product.
 */
export async function fetchSwapMatches(sb, { keywords = [], category = null, excludeUserId = null } = {}) {
  if (!keywords.length && !category) return { haves: [], wants: [], unavailable: false };
  const cols = 'id, title, wants_text, condition, area, photo_file_ids, created_at, telegram_user_id';
  const nowIso = new Date().toISOString();

  const base = (col, cat) => {
    let q = sb.from('swap_items').select(cols).eq('status', 'active').gt('expires_at', nowIso);
    if (keywords.length) q = q.overlaps(col, keywords);
    else q = q.eq(cat, category);
    if (excludeUserId) q = q.neq('telegram_user_id', excludeUserId);
    return q.limit(20);
  };

  let h, w;
  try {
    [h, w] = await Promise.all([
      base('keywords', 'category'),
      base('want_keywords', 'want_category'),
    ]);
  } catch {
    return { haves: [], wants: [], unavailable: true };
  }

  if (h?.error || w?.error) return { haves: [], wants: [], unavailable: true };

  return { haves: h?.data || [], wants: w?.data || [], unavailable: false };
}
