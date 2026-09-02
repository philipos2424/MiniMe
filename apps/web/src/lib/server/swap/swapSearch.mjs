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

/** Words that mean "I am shopping", where a barter card is noise at best. */
const COMMERCIAL = [
  'delivery', 'deliver', 'wholesale', 'shop', 'shops', 'store', 'supplier',
  'suppliers', 'bulk', 'invoice', 'warranty', 'ማድረስ', 'ጅምላ', 'ሱቅ',
];

export function isCommercialQuery(text) {
  const t = String(text || '').toLowerCase();
  return COMMERCIAL.some(w => t.includes(w));
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
 * Render both blocks as one Markdown chunk plus one keyboard. Returns null
 * when there is nothing to append — the caller must not print an empty header.
 */
export function formatSwapBlocks({ haves = [], wants = [], query, lang = 'en' }) {
  if (!haves.length && !wants.length) return null;
  const lines = [];
  const keyboard = [];

  if (haves.length) {
    lines.push('', pick('havesHeader', lang));
    for (const r of haves) {
      lines.push(`📷 *${r.title}*`);
      lines.push(`${pick('wants', lang)} ${r.wants_text}`);
      lines.push(`${areaLabel(r.area, lang)} · ${ago(r.created_at)}`);
      lines.push('');
      keyboard.push([{ text: `${pick('button', lang)} — ${r.title}`.slice(0, 64), callback_data: `sw:want:${r.id}` }]);
    }
  }

  if (wants.length) {
    lines.push('', `${pick('wantsHeader', lang)} ${query}*`);
    for (const r of wants) {
      lines.push(`🙋 wants *${r.wants_text}* — ${pick('offering', lang)} ${r.title}`);
      lines.push(`${areaLabel(r.area, lang)} · ${ago(r.created_at)}`);
      lines.push('');
      keyboard.push([{ text: `${pick('button', lang)} — ${r.title}`.slice(0, 64), callback_data: `sw:want:${r.id}` }]);
    }
  }

  return { text: lines.join('\n').trim(), keyboard };
}

/** Shown when a search found no swaps: the gap advertises itself. */
export function swapEmptyLine(query, lang = 'en') {
  return pick('empty', lang)(query);
}

/**
 * Pull both candidate sets in one round trip each. The searcher's own posts
 * are excluded — being shown your own jacket back is the fastest way to look
 * broken.
 */
export async function fetchSwapMatches(sb, { keywords = [], category = null, excludeUserId = null } = {}) {
  if (!keywords.length && !category) return { haves: [], wants: [] };
  const cols = 'id, title, wants_text, condition, area, photo_file_ids, created_at, telegram_user_id';
  const nowIso = new Date().toISOString();

  const base = (col, cat) => {
    let q = sb.from('swap_items').select(cols).eq('status', 'active').gt('expires_at', nowIso);
    if (keywords.length) q = q.overlaps(col, keywords);
    else q = q.eq(cat, category);
    if (excludeUserId) q = q.neq('telegram_user_id', excludeUserId);
    return q.limit(20);
  };

  const [h, w] = await Promise.all([
    base('keywords', 'category'),
    base('want_keywords', 'want_category'),
  ]);

  return { haves: h.data || [], wants: w.data || [] };
}
