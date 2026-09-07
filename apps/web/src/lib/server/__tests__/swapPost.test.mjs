/**
 * The wizard is four questions, and every one of them is a place a first-time
 * lister can walk away. So the state machine is pure and tested directly:
 * no Telegram, no database, no LLM in these tests — just "given this draft and
 * this input, what is the next question".
 *
 * The photo-before-title branch is the whole multi-photo UI. There is no
 * upload screen; sending another picture while the bot is asking "what is it?"
 * attaches it. That behaviour has to survive refactors, hence the test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, advanceDraft, publishDraft } from '../swap/swapPost.mjs';
import { MAX_PHOTOS, MAX_TEXT } from '../swap/constants.mjs';

const start = () => newDraft({ telegramUserId: 7, chatId: 7, fileId: 'photo-1' });

test('a photo opens the draft asking what to do with it', () => {
  const d = start();
  assert.equal(d.step, 'await_kind');
  assert.deepEqual(d.payload.photo_file_ids, ['photo-1']);
});

test('tapping "swap it" asks for the description', () => {
  const { draft, prompt } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  assert.equal(draft.step, 'await_title');
  assert.match(prompt.text, /what is it/i);
});

test('extra photos sent before the title attach to the same draft', () => {
  let { draft } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  ({ draft } = advanceDraft(draft, { kind: 'photo', fileId: 'photo-2' }));
  assert.deepEqual(draft.payload.photo_file_ids, ['photo-1', 'photo-2']);
  assert.equal(draft.step, 'await_title', 'still waiting on the description');
});

test('photos stop attaching at the cap instead of growing forever', () => {
  let { draft } = advanceDraft(start(), { kind: 'tap', value: 'swap' });
  for (let i = 2; i < 10; i++) ({ draft } = advanceDraft(draft, { kind: 'photo', fileId: `p${i}` }));
  assert.equal(draft.payload.photo_file_ids.length, MAX_PHOTOS);
});

test('the full happy path reaches publish with every field set', () => {
  let d = start(), prompt;
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'Redmi Note 10, small crack' }));
  assert.equal(d.step, 'await_wants');
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'winter jacket or a watch' }));
  assert.equal(d.step, 'await_condition');
  ({ draft: d, prompt } = advanceDraft(d, { kind: 'tap', value: 'good' }));
  assert.equal(d.step, 'await_area');
  assert.ok(prompt.keyboard.flat().some(b => b.callback_data === 'sw:area:other'));

  const done = advanceDraft(d, { kind: 'tap', value: 'bole' });
  assert.equal(done.publish, true);
  assert.deepEqual(
    { t: done.draft.payload.title, w: done.draft.payload.wants_text, c: done.draft.payload.condition, a: done.draft.payload.area },
    { t: 'Redmi Note 10, small crack', w: 'winter jacket or a watch', c: 'good', a: 'bole' },
  );
});

test('"somewhere else" asks for typed text instead of publishing', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'jacket' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'phone' }));
  ({ draft: d } = advanceDraft(d, { kind: 'tap',  value: 'good' }));
  const r = advanceDraft(d, { kind: 'tap', value: 'other' });
  assert.equal(r.publish, undefined);
  assert.equal(r.draft.step, 'await_area_text');

  const done = advanceDraft(r.draft, { kind: 'text', value: 'Hawassa Piazza' });
  assert.equal(done.publish, true);
  assert.equal(done.draft.payload.area, 'Hawassa Piazza');
  assert.equal(done.draft.payload.area_is_freetext, true);
});

test('long text is truncated, not rejected — nobody retypes a post', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap', value: 'swap' }));
  ({ draft: d } = advanceDraft(d, { kind: 'text', value: 'y'.repeat(500) }));
  assert.equal(d.payload.title.length, MAX_TEXT);
});

test('the wizard answers in Amharic when the lister writes Amharic', () => {
  let d = start();
  ({ draft: d } = advanceDraft(d, { kind: 'tap', value: 'swap' }));
  const { draft, prompt } = advanceDraft(d, { kind: 'text', value: 'ስልክ ሬድሚ' });
  assert.equal(draft.payload.lang, 'am');
  assert.ok(/[ሀ-፿]/.test(prompt.text), 'the next question is asked in Amharic');
});

/** Minimal Supabase fake: records the row handed to insert(). */
function fakeSb(sink) {
  return {
    from: () => ({
      insert: (row) => ({
        select: () => ({
          single: async () => { sink.push(row); return { data: { id: 'item-1', ...row }, error: null }; },
        }),
      }),
    }),
  };
}

test('publishing stores both keyword sets and an expiry date', async () => {
  const sink = [];
  const parse = async (text) => text.includes('jacket')
    ? { category: 'clothing_fashion', keywords: ['jacket'], banned: null }
    : { category: 'electronics_phones', keywords: ['phone'], banned: null };

  const draft = {
    telegram_user_id: 7, chat_id: 7, step: 'await_area',
    payload: {
      photo_file_ids: ['photo-1'], title: 'Redmi Note 10', wants_text: 'winter jacket',
      condition: 'good', area: 'bole', area_is_freetext: false, lang: 'en',
    },
  };
  const r = await publishDraft(fakeSb(sink), draft, { parse });
  assert.ok(r.item, 'published');
  const row = sink[0];
  // expandKeywords adds cross-script glossary variants (e.g. "phone" -> "ስልክ"),
  // so we assert containment rather than an exact set — that expansion is
  // swapParse's contract, not this module's.
  assert.ok(row.keywords.includes('phone'));
  assert.ok(row.want_keywords.includes('jacket'));
  assert.equal(row.status, 'active');
  assert.ok(new Date(row.expires_at) > new Date(), 'expiry is in the future');
});

test('a banned item is refused and never reaches the database', async () => {
  const sink = [];
  const parse = async () => ({ category: null, keywords: [], banned: 'weapons' });
  const draft = {
    telegram_user_id: 7, chat_id: 7, step: 'await_area',
    payload: {
      photo_file_ids: ['photo-1'], title: 'AK47 mag', wants_text: 'phone',
      condition: 'good', area: 'bole', area_is_freetext: false, lang: 'en',
    },
  };
  const r = await publishDraft(fakeSb(sink), draft, { parse });
  assert.equal(r.refused, 'weapons');
  assert.equal(sink.length, 0, 'nothing was inserted');
});
