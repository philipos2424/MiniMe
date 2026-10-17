import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryTag, channelOfTag, attributeShops, logEntryLink, ENTRY_STEP } from '../metrics/attribution.mjs';

test('entryTag keeps campaign tags and drops routed or unsafe payloads', () => {
  assert.equal(entryTag('src_TikTok_Oct'), 'src_tiktok_oct');
  assert.equal(entryTag('ref_ABC123'), 'ref_abc123');
  for (const bad of ['', null, 'shop_abc', 'team_x', 'sell', 'sell_market', 'msearch_1', 'a b', '<script>', 'x'.repeat(65), '+251911223344']) {
    assert.equal(entryTag(bad), null, String(bad));
  }
});

test('channelOfTag buckets into acquisition_source names', () => {
  assert.equal(channelOfTag('src_tiktok_oct'), 'instagram_tiktok');
  assert.equal(channelOfTag('ig_story'), 'instagram_tiktok');
  assert.equal(channelOfTag('fb_ad'), 'facebook');
  assert.equal(channelOfTag('tg_channel_x'), 'telegram');
  assert.equal(channelOfTag('ref_abc'), 'referral');
  assert.equal(channelOfTag('poster_bole'), 'poster');
});

test('attribution precedence and touch-before-signup rule', () => {
  const t = d => new Date(Date.UTC(2026, 9, d)).toISOString();
  const shops = [
    { id: 'self', owner_telegram_id: 1, created_at: t(10), acquisition_source: 'telegram' },
    { id: 'link', owner_telegram_id: 2, created_at: t(10) },
    { id: 'late', owner_telegram_id: 3, created_at: t(10) },
    { id: 'sell', owner_telegram_id: 4, created_at: t(10) },
    { id: 'chan', owner_telegram_id: 5, created_at: t(10), source_channel_id: '-100' },
    { id: 'none', owner_telegram_id: 6, created_at: t(10) },
  ];
  const ev = [
    { telegram_id: 1, step: ENTRY_STEP, meta: { tag: 'fb_ad' }, created_at: t(9) },
    { telegram_id: '2', step: ENTRY_STEP, meta: { tag: 'src_tiktok' }, created_at: t(9) },
    { telegram_id: 3, step: ENTRY_STEP, meta: { tag: 'src_tiktok' }, created_at: t(11) },
    { telegram_id: 4, step: 'sell_cta_tapped', meta: { source: 'market' }, created_at: t(8) },
  ];
  const a = attributeShops(shops, ev);
  assert.deepEqual(a.get('self'), { channel: 'telegram', basis: 'self_reported' });
  assert.deepEqual(a.get('link'), { channel: 'instagram_tiktok', basis: 'entry_link' });
  assert.deepEqual(a.get('late'), { channel: 'unattributed', basis: 'unattributed' });
  assert.deepEqual(a.get('sell'), { channel: 'minime_search', basis: 'sell_link' });
  assert.deepEqual(a.get('chan'), { channel: 'telegram', basis: 'channel_import' });
});

function fakeSb(existing = []) {
  const inserts = [];
  const q = {
    select() { return q; }, eq() { return q; },
    limit: async () => ({ data: existing }),
    insert: async row => { inserts.push(row); return { error: null }; },
  };
  return { inserts, from: () => q };
}

test('logEntryLink stores the first tag only, sanitised', async () => {
  const sb = fakeSb();
  assert.equal(await logEntryLink(sb, 42, 'SRC_TikTok', 'bot_start'), true);
  assert.deepEqual(sb.inserts[0], { telegram_id: 42, step: ENTRY_STEP, meta: { tag: 'src_tiktok', surface: 'bot_start' } });
  assert.equal(await logEntryLink(fakeSb([{ id: 1 }]), 42, 'src_fb', 'bot_start'), false);
  assert.equal(await logEntryLink(fakeSb(), 42, 'shop_abc', 'bot_start'), false);
  assert.equal(await logEntryLink(fakeSb(), null, 'src_fb', 'bot_start'), false);
});

test('logEntryLink never throws', async () => {
  const sb = { from() { throw new Error('db down'); } };
  assert.equal(await logEntryLink(sb, 42, 'src_fb', 'mini_app'), false);
});
