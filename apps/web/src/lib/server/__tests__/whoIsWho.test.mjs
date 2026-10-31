import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unsureContacts, whoCardText, whoKeyboard, parseWho, whoDoneText } from '../../whoIsWho.mjs';
import { briefText, briefKeyboard, briefActionable } from '../ownerLedger.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const id = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const convs = [
  { id: id(1), last_message_at: '2026-10-30', metadata: { contact_profile: { relationship: 'unknown', name: 'Hana', notes: 'asked about logo' } }, customers: { telegram_id: 11 } },
  { id: id(2), last_message_at: '2026-10-31', metadata: { contact_profile: { relationship: 'friend', name: 'Abel' } }, customers: { telegram_id: 12 } },
  { id: id(3), last_message_at: '2026-10-29', metadata: { contact_profile: { relationship: 'unknown', owner_set: true } }, customers: { telegram_id: 13 } },
  { id: id(4), last_message_at: '2026-10-31', metadata: { contact_profile: { relationship: 'unknown', name: 'Saved Sis' } }, customers: { telegram_id: 14 } },
  { id: id(5), last_message_at: '2026-10-28', metadata: { contact_profile: {} }, customers: { name: 'Dawit', telegram_id: 15 } },
  { id: id(6), last_message_at: '2026-10-31', metadata: {}, customers: { telegram_id: 16 } },
];

test('only unplaced, unlabelled people who are not already saved', () => {
  const list = unsureContacts(convs, { personalIds: [14] });
  assert.deepEqual(list.map(c => c.id), [id(1), id(5)]);
});

test('card and buttons: one row of five per person, callbacks fit Telegram', () => {
  const list = unsureContacts(convs, { personalIds: [14] });
  assert.match(whoCardText(list, 2), /these 2/);
  assert.match(whoCardText(list), /Hana\* — _asked about logo_/);
  assert.match(whoCardText([]), /know who everyone is/);
  const kb = whoKeyboard(list);
  assert.equal(kb.length, 4);
  assert.equal(kb[1].length, 5);
  for (const b of kb.flat()) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  assert.deepEqual(parseWho(kb[1][0].callback_data), { relation: 'family', conversationId: id(1) });
  assert.deepEqual(parseWho(`who_x_${id(5)}`), { relation: 'ignore', conversationId: id(5) });
  assert.equal(parseWho('who_z_bad'), null);
  assert.match(whoDoneText('Hana', 'customer'), /a customer/);
  assert.match(whoDoneText('Hana', 'ignore'), /won't reply/);
});

test('morning brief mentions them with a button', () => {
  assert.ok(briefActionable({ unsure: 3 }));
  assert.match(briefText({ unsure: 3 }), /3 people I'm not sure who they are/);
  assert.ok(briefKeyboard({ unsure: 3 }).flat().some(b => b.callback_data === 'who_list'));
});

test('wired: /who, owner-only who_ buttons, and the owner label survives profile refresh', () => {
  const e = readFileSync(`${here}../replyEngine.js`, 'utf8');
  assert.match(e, /\/\(who\|people\)/);
  const at = e.indexOf("if (data.startsWith('who_')) {");
  assert.ok(at > 0);
  assert.match(e.slice(at, at + 250), /Only the shop owner/);
  assert.match(e, /prevCp\.owner_set && prevCp\.relationship \? prevCp\.relationship/);
  assert.match(readFileSync(`${here}../../../app/api/cron/morning-briefing/route.js`, 'utf8'), /telegram_biz_conn_id/);
});
