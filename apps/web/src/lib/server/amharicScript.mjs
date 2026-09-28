/**
 * amharicScript — which language/script is this message actually written in?
 *
 * Ethiopian customers overwhelmingly text Amharic in LATIN letters, not Ethiopic
 * ("nege emetalehu", "sint new?", "eshi tiru"). Everything in this codebase used
 * to decide "is this Amharic?" with /[ሀ-፿]/ — an Ethiopic-block test —
 * so the single largest slice of real traffic was classified as English: it got
 * English replies, skipped the Amharic polish, and never matched the order /
 * delivery / payment routing regexes.
 *
 * Two hard problems, and the design of this module is a response to both:
 *
 * 1. THERE IS NO STANDARD SPELLING. The same word arrives as emetalehu /
 *    imetalehu / emethalehu, eshi / ishi / eshee, betam / bettam. A fixed word
 *    list cannot keep up, so tokens are folded through normalizeToken() before
 *    lookup and the lexicon stores the *normalized* forms.
 *
 * 2. TRANSLITERATED AMHARIC COLLIDES WITH ENGLISH. "new" (ነው, "it is"), "man"
 *    (ማን, "who"), "yet" (የት, "where"), "ale" (አለ, "there is"), "sew" (ሰው,
 *    "person") are all ordinary English words too. Treating those as proof of
 *    Amharic would flag half of English traffic. So the lexicon is split into
 *    STRONG (no plausible English reading) and WEAK (ambiguous) — weak tokens
 *    can only reinforce a decision, never trigger one on their own.
 *
 * The bias throughout is toward NOT firing: a missed Latin-Amharic message
 * degrades to today's behaviour, whereas a false positive makes an English
 * speaker get answered in Amharic.
 */

// ── Token normalization ─────────────────────────────────────────────────────
//
// Folds the spelling variance one Amharic word picks up when different people
// romanize it. Applied identically to input tokens and to the lexicon below, so
// the two always meet in the middle.
//
// - h-dropping (except word-initial): Amharic ሀ/ሐ/ኀ are romanized inconsistently
//   and often just omitted — emetalehu ↔ emetaleu, dehna ↔ dena.
// - i→e, u→o: the vowel pairs people swap most often — ishi ↔ eshi.
// - ny→gn: the ኘ sound, spelled both ways (amesegnalehu ↔ amesenyalehu).
// - run collapsing: betam ↔ bettam, eshe ↔ eshee.
export function normalizeToken(token) {
  let t = String(token || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return '';
  t = t.replace(/ny/g, 'gn');
  t = t[0] + t.slice(1).replace(/h/g, '');   // drop non-initial h
  t = t.replace(/i/g, 'e').replace(/u/g, 'o');
  t = t.replace(/(.)\1+/g, '$1');            // collapse doubled letters
  return t;
}

function buildSet(words) {
  const s = new Set();
  for (const w of words) {
    const n = normalizeToken(w);
    if (n) s.add(n);
  }
  return s;
}

// ── STRONG: seeing one of these is real evidence of Amharic ─────────────────
// Every entry was checked against its normalized form for English collisions.
// Spelling variants are listed explicitly where the normalizer can't bridge them
// (amesegnalehu vs ameseginalehu differ by a whole syllable, not a vowel).
const STRONG_WORDS = [
  // greetings & courtesy
  'selam', 'salam', 'tadias', 'tadiyas', 'tenayistilign', 'tenayistilgn',
  'dehna', 'dehnaneh', 'dehnanesh', 'dehnawal', 'endemin', 'endemen', 'endemneh',
  'endemnesh', 'endet', 'amesegnalehu', 'ameseginalehu', 'amesegnalew',
  'ayzosh', 'ayzoh', 'melkam', 'enkuan', 'yiqirta', 'yikirta', 'betam',
  // acknowledgements & sentiment
  'eshi', 'ishi', 'awo', 'aydelem', 'yelem', 'yelelem', 'arif', 'tiru', 'tiruw',
  'konjo', 'gobez', 'chigger', 'chigir', 'asazgn', 'demo',
  // time — the category that motivated this module ("nege emetalehu")
  'nege', 'zare', 'tilant', 'tinant', 'tinantina', 'ahun', 'kese', 'behuala',
  'wediyaw', 'sanbet', 'ehud', 'mata', 'tewat', 'kenat', 'gize',
  // verbs & very common phrase words
  'emetalehu', 'metalehu', 'enimetalen', 'inimetalen', 'alegn', 'alesh',
  'alachihu', 'alachu', 'alu', 'lakelign', 'lakelegn', 'lakulign', 'lakew',
  'setegn', 'setelign', 'setelegn', 'efelgalehu', 'efeligalehu', 'ewedalehu',
  'echalalehu', 'ichilalehu', 'negerign', 'negerign', 'awukalehu', 'alawkim',
  'ergetegna', 'yasfelgal', 'mechem', 'mindnew', 'mindinew', 'minew',
  // questions
  'lemin', 'lemn', 'manew', 'yetnew', 'sint', 'sintnew', 'meche', 'mechie',
  'endemint', 'sintew',
  // commerce
  'waga', 'wega', 'kifiya', 'kefiya', 'genzeb', 'genzob', 'hisab',
  'meshet', 'gezalehu', 'gezahu', 'adera', 'agelgilot', 'derash', 'yaltemola',
  // food & goods that show up constantly in Ethiopian shop chats
  'injera', 'tibs', 'kitfo', 'shiro', 'doro', 'bunna', 'buna', 'netela',
  'habesha', 'kemis', 'shemiz',
  // people / address terms
  'gashe', 'weyzero', 'wro', 'emama', 'wendime', 'ehite', 'konjit',
];

// ── EXACT_STRONG: strong, but only at this exact spelling ───────────────────
// Their normalized forms collide with ordinary English (birr→ber shares a key
// with "beer"; saat→sat with "sat"), so folding them would import the false
// positive. Spelled exactly this way they're unambiguous, so they're matched
// pre-normalization and excluded from the folded set above.
const EXACT_STRONG = new Set(['birr', 'saat', 'ato', 'aleh']);

// ── WEAK: consistent with Amharic, but each is also an English word ─────────
// These never trigger detection alone. They exist so that a message which
// already has one strong hit can be scored as *more* Amharic than English.
const WEAK_WORDS = [
  'new', 'newu', 'nw', 'ale', 'alew', 'min', 'man', 'yet', 'lay', 'sew', 'and',
  'gena', 'ere', 'wey', 'weys', 'bel', 'ken', 'wer', 'amet', 'ras', 'lik',
  'atu', 'be', 'ke', 'le', 'ende', 'sile', 'gin', 'gn',
];

export const STRONG_TOKENS = buildSet(STRONG_WORDS);
export const WEAK_TOKENS = buildSet(WEAK_WORDS);

const ETHIOPIC_RE = /[ሀ-፿]/;
const LATIN_RE = /[A-Za-z]/;

/** Does the text contain Ethiopic script? (the old isAmharic() test) */
export function hasEthiopic(text) {
  return ETHIOPIC_RE.test(text || '');
}

/**
 * Token-level scoring of how Amharic-in-Latin-letters a message is.
 * Returns { tokens, strong, weak, ratio, matched } — matched is the list of
 * original tokens that hit, which makes failures debuggable from a log line.
 */
export function scoreLatinAmharic(text) {
  const raw = String(text || '')
    .split(/[^A-Za-z']+/)
    .filter(Boolean);

  let strong = 0;
  let weak = 0;
  const matched = [];

  for (const tok of raw) {
    const exact = tok.toLowerCase().replace(/[^a-z]/g, '');
    if (EXACT_STRONG.has(exact)) { strong++; matched.push(tok); continue; }
    const n = normalizeToken(tok);
    if (!n) continue;
    if (STRONG_TOKENS.has(n)) { strong++; matched.push(tok); }
    else if (WEAK_TOKENS.has(n)) { weak++; }
  }

  const tokens = raw.length;
  const ratio = tokens ? (strong + weak * 0.5) / tokens : 0;
  return { tokens, strong, weak, ratio, matched };
}

/**
 * Is this Latin-script Amharic?
 *
 * Thresholds are deliberately asymmetric by message length:
 *  - Short messages (≤3 tokens) are where "nege emetalehu" and "eshi tiru" live.
 *    One strong hit is enough, but it must dominate — half the message or more.
 *  - Longer messages need two strong hits (or one strong plus real weak support),
 *    because a lone Amharic loanword inside an English sentence ("do you have
 *    injera") is an English message and must be answered in English.
 */
export function isLatinAmharic(text) {
  const { tokens, strong, weak, ratio } = scoreLatinAmharic(text);
  if (!strong) return false;
  if (tokens <= 3) return ratio >= 0.5;
  return strong >= 2 || (strong >= 1 && weak >= 2);
}

/**
 * The single entry point callers should use.
 *
 *   'ethiopic' — written in ፊደል
 *   'latin-am' — Amharic typed in Latin letters; MIRROR THIS, don't answer in ፊደል
 *   'mixed'    — Amharic and English genuinely interleaved (either script)
 *   'en'       — English (the default; also what empty input returns)
 */
export function detectScript(text) {
  const t = String(text || '');
  const ethiopic = hasEthiopic(t);
  const latin = LATIN_RE.test(t);

  if (ethiopic && latin) {
    // Ethiopic plus Latin letters. Latin that is itself Amharic isn't real
    // mixing — "ሰላም nege emetalehu" is one Amharic message in two scripts.
    return isLatinAmharic(t) ? 'ethiopic' : 'mixed';
  }
  if (ethiopic) return 'ethiopic';
  if (!latin) return 'en';

  if (isLatinAmharic(t)) {
    // How much of the message was actually Amharic decides whether the reply
    // should be Amharic throughout or the same code-switch the customer used.
    const { ratio } = scoreLatinAmharic(t);
    return ratio >= 0.6 ? 'latin-am' : 'mixed';
  }
  return 'en';
}

/** Any flavour of Amharic — the replacement for the old isAmharic() call sites. */
export function isAmharicish(text) {
  return detectScript(text) !== 'en';
}

/** Should the REPLY be written in Latin letters? True when the customer used them. */
export function prefersLatinScript(text) {
  const s = detectScript(text);
  if (s === 'latin-am') return true;
  if (s === 'mixed') return !hasEthiopic(text);
  return false;
}

/**
 * Two-letter language tag for intent classification and stored preferences.
 * Latin-script Amharic is still Amharic — that it isn't tagged 'en' is the whole
 * point of this module.
 */
export function languageTag(text) {
  const s = detectScript(text);
  if (s === 'ethiopic' || s === 'latin-am') return 'am';
  if (s === 'mixed') return 'mixed';
  return 'en';
}
