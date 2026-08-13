/**
 * termTranslations — a small, static English ↔ Amharic dictionary for common
 * shopping terms, used to bridge cross-language search.
 *
 * WHY THIS EXISTS
 * A query keyword is matched against business/product text with plain
 * substring/word-boundary checks (see searchRanker.wordMatch). That works
 * fine within one script, but an English keyword like "car" can never match
 * an Amharic-only product name like "መኪና" — they share no characters. The
 * only existing bridge was a per-request OpenAI embedding call, which is
 * weak (no guaranteed recall) and not free.
 *
 * This is the opposite of that: a fixed, dependency-free lookup table (same
 * pattern as categoryMap.mjs) so cross-language matching is free and
 * deterministic at request time — no LLM/embedding call involved. It is
 * intentionally small and curated, not a general translator: it only needs
 * to cover the shopping-relevant nouns that already appear as English
 * keywords or Amharic KEYWORD_CACHE shortcuts in searchBot.js.
 */

// [english, amharic, ...moreAmharicVariants] — kept as simple tuples so the
// list reads like a glossary and is easy to extend.
const PAIRS = [
  ['laptop', 'ላፕቶፕ'],
  ['phone', 'ስልክ'],
  ['mobile', 'ሞባይል'],
  ['computer', 'ኮምፒውተር'],
  ['printing', 'ማተሚያ'],
  ['print', 'ህትመት'],
  ['banner', 'ባነር'],
  ['logo', 'ሎጎ'],
  ['design', 'ዲዛይን'],
  ['branding', 'ብራንዲንግ'],
  ['restaurant', 'ምግብ'],
  ['cafe', 'ካፌ'],
  ['coffee', 'ቡና'],
  ['cake', 'ኬክ'],
  ['bakery', 'ዳቦ'],
  ['catering', 'ኬተሪንግ'],
  ['injera', 'እንጀራ'],
  ['photo', 'ፎቶ'],
  ['photography', 'ፎቶግራፍ'],
  ['video', 'ቪዲዮ'],
  ['studio', 'ስቱዲዮ'],
  ['clothing', 'ልብስ'],
  ['dress', 'ቀሚስ'],
  ['habesha', 'ሀበሻ', 'ሐበሻ'],
  ['beauty', 'ውበት'],
  ['hair', 'ፀጉር'],
  ['salon', 'ሳሎን'],
  ['makeup', 'ሜካፕ'],
  ['construction', 'ግንባታ'],
  ['furniture', 'ፈርኒቸር'],
  ['delivery', 'ዲሊቨሪ'],
  ['transport', 'ትራንስፖርት'],
  ['wedding', 'ሰርግ'],
  ['event', 'ዝግጅት'],
  ['flower', 'አበባ'],
  ['dj', 'ዲጄ'],
  ['training', 'ስልጠና'],
  ['consulting', 'አማካሪ'],
  ['wholesale', 'ጅምላ'],
  ['repair', 'ጥገና'],
  ['software', 'ሶፍትዌር'],
  ['website', 'ዌብሳይት'],
  ['car', 'መኪና', 'ተሽከርካሪ'],
];

// Built once at module load: term (lowercase) -> Set of same-meaning terms in
// the other script. Bidirectional — each pair populates both directions.
const TRANSLATIONS = new Map();
function link(a, b) {
  if (!TRANSLATIONS.has(a)) TRANSLATIONS.set(a, new Set());
  TRANSLATIONS.get(a).add(b);
}
for (const [en, ...amVariants] of PAIRS) {
  for (const am of amVariants) {
    link(en, am);
    link(am, en);
  }
}

/**
 * Same-meaning terms for `word` in the other script, or [] if none known.
 * Case-insensitive (Amharic has no case, but English lookups shouldn't
 * depend on it).
 */
export function translationsOf(word) {
  const key = String(word || '').toLowerCase().trim();
  if (!key) return [];
  const set = TRANSLATIONS.get(key);
  return set ? [...set] : [];
}
