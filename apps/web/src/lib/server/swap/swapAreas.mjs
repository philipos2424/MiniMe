/**
 * Where a swap can be collected.
 *
 * Buttons cover the Addis areas that actually generate MiniMe traffic; anything
 * else is stored as free text via `sw:area:other`. The free-text values are the
 * signal for which cities to promote to buttons later — so they are stored as
 * typed, not silently dropped into an "other" bucket that answers nothing.
 */
export const AREAS = [
  { id: 'bole',       en: 'Bole',       am: 'ቦሌ' },
  { id: 'piassa',     en: 'Piassa',     am: 'ፒያሳ' },
  { id: 'megenagna',  en: 'Megenagna',  am: 'መገናኛ' },
  { id: 'four_kilo',  en: '4 Kilo',     am: '4 ኪሎ' },
  { id: 'six_kilo',   en: '6 Kilo',     am: '6 ኪሎ' },
  { id: 'mexico',     en: 'Mexico',     am: 'ሜክሲኮ' },
  { id: 'kazanchis',  en: 'Kazanchis',  am: 'ካዛንቺስ' },
  { id: 'sarbet',     en: 'Sarbet',     am: 'ሳርቤት' },
  { id: 'gerji',      en: 'Gerji',      am: 'ገርጂ' },
  { id: 'ayat',       en: 'Ayat',       am: 'አያት' },
];

const MAX_FREETEXT = 60;

const BY_ALIAS = new Map();
for (const a of AREAS) {
  BY_ALIAS.set(a.id, a.id);
  BY_ALIAS.set(a.en.toLowerCase(), a.id);
  BY_ALIAS.set(a.am, a.id);
}

/** Display name for an area id, or the free-text value unchanged. */
export function areaLabel(area, lang = 'en') {
  const known = AREAS.find(a => a.id === area);
  if (!known) return area;
  return lang === 'am' ? known.am : known.en;
}

/** Map typed or tapped input to a known area id, else keep it as free text. */
export function normalizeArea(text) {
  const raw = String(text || '').trim();
  const hit = BY_ALIAS.get(raw.toLowerCase()) || BY_ALIAS.get(raw);
  if (hit) return { area: hit, isFreetext: false };
  return { area: raw.slice(0, MAX_FREETEXT), isFreetext: true };
}

/** Two-per-row area buttons, with the free-text escape hatch last. */
export function areaKeyboard(lang = 'en') {
  const rows = [];
  for (let i = 0; i < AREAS.length; i += 2) {
    rows.push(AREAS.slice(i, i + 2).map(a => ({
      text: lang === 'am' ? a.am : a.en,
      callback_data: `sw:area:${a.id}`,
    })));
  }
  rows.push([{
    text: lang === 'am' ? 'ሌላ ቦታ — ይጻፉ' : 'Somewhere else — type it',
    callback_data: 'sw:area:other',
  }]);
  return rows;
}
