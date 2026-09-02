/**
 * The posting wizard: photo in, live listing out, four questions between.
 *
 * `advanceDraft` is pure on purpose. Every branch here is a place a first-time
 * lister can abandon the flow, so the transitions are testable without a bot
 * token, a database, or a network — the I/O lives in the caller.
 */
import { MAX_PHOTOS, MAX_TEXT, CONDITIONS, CONDITION_LABELS, EXPIRY_DAYS } from './constants.mjs';
import { areaKeyboard, normalizeArea } from './swapAreas.mjs';
import { parseSwapText, expandKeywords, postLang } from './swapParse.mjs';

export const STEPS = ['await_kind', 'await_title', 'await_wants', 'await_condition', 'await_area', 'await_area_text'];

const T = {
  kind:      { en: 'What do you want to do with this?', am: 'በዚህ ምን ማድረግ ይፈልጋሉ?' },
  swapBtn:   { en: '🔄 Swap it', am: '🔄 ልቀይረው' },
  findBtn:   { en: '🔍 Find this', am: '🔍 ይህን ፈልግ' },
  title:     { en: 'What is it? (short — "Redmi Note 10, cracked back")', am: 'ምንድን ነው? (አጭር — "ሬድሚ ኖት 10, ጀርባው የተሰነጠቀ")' },
  wants:     { en: 'What do you want for it?', am: 'በምን መቀየር ይፈልጋሉ?' },
  condition: { en: 'Condition?', am: 'ሁኔታው?' },
  area:      { en: 'Where are you?', am: 'የት ነው ያሉት?' },
  areaText:  { en: 'Type your area:', am: 'አካባቢዎን ይጻፉ:' },
};

const t = (key, lang) => T[key][lang === 'am' ? 'am' : 'en'];

/** A photo has arrived and no draft was open. */
export function newDraft({ telegramUserId, chatId, fileId }) {
  return {
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    step: 'await_kind',
    payload: {
      photo_file_ids: fileId ? [fileId] : [],
      title: '', wants_text: '', condition: '', area: '', area_is_freetext: false, lang: 'en',
    },
  };
}

/** The question to ask at a given step. */
export function draftPrompt(step, lang = 'en') {
  switch (step) {
    case 'await_kind':
      return { text: t('kind', lang), keyboard: [[
        { text: t('findBtn', lang), callback_data: 'sw:kind:find' },
        { text: t('swapBtn', lang), callback_data: 'sw:kind:swap' },
      ]] };
    case 'await_title': return { text: t('title', lang) };
    case 'await_wants': return { text: t('wants', lang) };
    case 'await_condition':
      return { text: t('condition', lang), keyboard: [CONDITIONS.map(c => ({
        text: CONDITION_LABELS[c][lang === 'am' ? 'am' : 'en'],
        callback_data: `sw:cond:${c}`,
      }))] };
    case 'await_area':      return { text: t('area', lang), keyboard: areaKeyboard(lang) };
    case 'await_area_text': return { text: t('areaText', lang) };
    default: return { text: t('title', lang) };
  }
}

const cap = (s) => String(s || '').trim().slice(0, MAX_TEXT);

/**
 * One transition. Returns the next draft, the next question, and whether the
 * caller should publish. Never mutates its argument.
 */
export function advanceDraft(draft, input) {
  const d = { ...draft, payload: { ...draft.payload, photo_file_ids: [...draft.payload.photo_file_ids] } };
  const lang = d.payload.lang;

  // A photo at any point before the description attaches to this draft. This
  // is the entire multi-photo UI — no upload screen, no "add photo" button.
  if (input.kind === 'photo') {
    if (d.payload.photo_file_ids.length < MAX_PHOTOS) d.payload.photo_file_ids.push(input.fileId);
    return { draft: d, prompt: null };
  }

  switch (d.step) {
    case 'await_kind':
      if (input.value === 'swap') {
        d.step = 'await_title';
        return { draft: d, prompt: draftPrompt(d.step, lang) };
      }
      return { draft: d, prompt: null };

    case 'await_title':
      d.payload.title = cap(input.value);
      d.payload.lang = postLang(input.value);
      d.step = 'await_wants';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_wants':
      d.payload.wants_text = cap(input.value);
      d.step = 'await_condition';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_condition':
      if (!CONDITIONS.includes(input.value)) return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };
      d.payload.condition = input.value;
      d.step = 'await_area';
      return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };

    case 'await_area': {
      if (input.value === 'other') {
        d.step = 'await_area_text';
        return { draft: d, prompt: draftPrompt(d.step, d.payload.lang) };
      }
      const { area, isFreetext } = normalizeArea(input.value);
      d.payload.area = area;
      d.payload.area_is_freetext = isFreetext;
      return { draft: d, prompt: null, publish: true };
    }

    case 'await_area_text': {
      const { area, isFreetext } = normalizeArea(input.value);
      d.payload.area = area;
      d.payload.area_is_freetext = isFreetext;
      return { draft: d, prompt: null, publish: true };
    }

    default:
      return { draft: d, prompt: null };
  }
}

/**
 * Turn a finished draft into a live row. Parses both lines — the item AND the
 * wants — because the wants line is what the reverse-index block searches.
 */
export async function publishDraft(sb, draft, { parse = parseSwapText } = {}) {
  const p = draft.payload;
  const [item, want] = await Promise.all([parse(p.title), parse(p.wants_text)]);
  if (item.banned) return { refused: item.banned };
  if (want.banned) return { refused: want.banned };

  const row = {
    telegram_user_id: draft.telegram_user_id,
    telegram_username: draft.telegram_username || null,
    title: p.title,
    wants_text: p.wants_text,
    condition: p.condition,
    area: p.area,
    area_is_freetext: p.area_is_freetext,
    photo_file_ids: p.photo_file_ids,
    category: item.category,
    keywords: expandKeywords(item.keywords),
    want_category: want.category,
    want_keywords: expandKeywords(want.keywords),
    lang: p.lang,
    status: 'active',
    expires_at: new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString(),
  };

  const { data, error } = await sb.from('swap_items').insert(row).select().single();
  if (error) return { refused: 'save_failed' };
  return { item: data };
}
