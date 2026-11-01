import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  quickRelationship, mergeRelationship, shouldAskWho, nextAsks, askWhoText, addisHour, addisDate,
  parseRelay, relayCallback, activeRelay, relaySentText, recapText, recapKeyboard, recapWanted, MAX_ASKS_PER_DAY,
} from '../../secretaryPeople.mjs';
import { unsureContacts } from '../../whoIsWho.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');
const NOON = Date.parse('2026-11-01T09:00:00Z');   // 12:00 in Addis
const NIGHT = Date.parse('2026-11-01T20:00:00Z');  // 23:00 in Addis

test('names say who family and friends are', () => {
  for (const n of ['Mom', 'Emaye ❤️', 'Wendme Abel', 'እማዬ', 'My Love', 'Baba']) {
    assert.equal(quickRelationship({ names: [n] })?.relationship, 'family', n);
  }
  assert.equal(quickRelationship({ names: ['Sara 💕'] })?.relationship, 'family');
  assert.equal(quickRelationship({ names: ['Bro Dawit'] })?.relationship, 'friend');
  assert.equal(quickRelationship({ names: ['Emanuel'] }), null, 'no match inside a longer name');
  assert.equal(quickRelationship({ names: ['Hanna Wendemagegn'] }), null);
});

test('price questions mean customer; betting links mean spam', () => {
  assert.equal(quickRelationship({ names: ['Abel'], inbound: ['hi', 'how much is the black one?'] })?.relationship, 'customer');
  assert.equal(quickRelationship({ names: ['Abel'], inbound: ['ዋጋው ስንት ነው'] })?.relationship, 'customer');
  const spam = quickRelationship({ names: ['Leyandha'], inbound: ['Free Correct Score group, high odds! join t.me/+abc'] });
  assert.equal(spam.spam, true);
  assert.equal(spam.relationship, 'unknown');
  assert.equal(quickRelationship({ names: ['Abel'], inbound: ['selam', 'how are you', 'see you tomorrow'] }), null);
});

test('the owner answer stands; vague guesses never erase a known one', () => {
  assert.equal(mergeRelationship({ relationship: 'friend', owner_set: true }, { relationship: 'customer', confidence: 1 }).relationship, 'friend');
  assert.equal(mergeRelationship({}, { relationship: 'friend', confidence: 0.9 }, { relationship: 'family', confidence: 0.85, why: 'name' }).relationship, 'family');
  assert.equal(mergeRelationship({ relationship: 'customer' }, { relationship: 'unknown' }).relationship, 'customer');
  assert.equal(mergeRelationship({ relationship: 'customer' }, { relationship: 'friend', confidence: 0.3 }).relationship, 'customer');
  assert.equal(mergeRelationship({ relationship: 'customer' }, { relationship: 'friend', confidence: 0.8 }).relationship, 'friend');
  assert.equal(mergeRelationship({}, { relationship: 'colleague' }).relationship, 'colleague', 'no confidence given = trusted as before');
  assert.equal(mergeRelationship({}, { relationship: 'weird' }).relationship, 'unknown');
});

test('ask about one person: after a real exchange, by day, a few times a day', () => {
  const cp = { relationship: 'unknown', name: 'Hanna' };
  assert.equal(addisHour(NOON), 12);
  assert.equal(addisDate(NIGHT), '2026-11-01');
  assert.equal(shouldAskWho(cp, { inboundCount: 3, now: NOON }), true);
  assert.equal(shouldAskWho(cp, { inboundCount: 1, now: NOON }), false, 'one hello is not enough');
  assert.equal(shouldAskWho(cp, { inboundCount: 3, now: NIGHT }), false, 'never at night');
  assert.equal(shouldAskWho({ ...cp, spam: true }, { inboundCount: 3, now: NOON }), false);
  assert.equal(shouldAskWho({ ...cp, asked_at: 'x' }, { inboundCount: 3, now: NOON }), false, 'asked once only');
  assert.equal(shouldAskWho({ ...cp, relationship: 'friend' }, { inboundCount: 3, now: NOON }), false);
  assert.equal(shouldAskWho(cp, { inboundCount: 3, now: NOON, isPersonal: true }), false);
  let asks = null;
  for (let i = 0; i < MAX_ASKS_PER_DAY; i++) asks = nextAsks(asks, NOON);
  assert.equal(shouldAskWho(cp, { inboundCount: 3, now: NOON, asks }), false, 'daily cap');
  assert.equal(shouldAskWho(cp, { inboundCount: 3, now: NOON + 86400000, asks }), true, 'resets next day');
  assert.match(askWhoText({ name: 'Hanna', lastMessage: 'are you free *Friday*?' }), /Who is Hanna\?[\s\S]*are you free Friday\?/);
});

test('spam never shows up in the who list', () => {
  const convs = [
    { id: 'a', metadata: { contact_profile: { relationship: 'unknown', spam: true } } },
    { id: 'b', metadata: { contact_profile: { relationship: 'unknown' } } },
  ];
  assert.deepEqual(unsureContacts(convs).map(c => c.id), ['b']);
});

test('answer through Secretary: button, expiry, honest failure text', () => {
  const id = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  assert.equal(parseRelay(relayCallback(id)), id);
  assert.ok(relayCallback(id).length <= 64);
  assert.equal(parseRelay('sra_nope'), null);
  const now = Date.now();
  assert.ok(activeRelay({ secretary_relay: { conversation_id: id, at: new Date(now).toISOString() } }, now));
  assert.equal(activeRelay({ secretary_relay: { conversation_id: id, at: new Date(now - 3600000).toISOString() } }, now), null);
  assert.match(relaySentText('Hanna', true), /Sent to \*Hanna\*/);
  assert.match(relaySentText('Hanna', false, 'Bad Request: chat not found'), /last day or so/);
});

test('evening recap: quiet days send nothing; waiting people get a button', () => {
  assert.equal(recapText({ answered: 0, waiting: [] }), null);
  const s = { answered: 14, waiting: [{ conversationId: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', name: 'Hanna', asked: 'are you free Friday?' }], unsure: 2 };
  const t = recapText(s, { ownerFirst: 'Philipos' });
  assert.match(t, /Philipos, here's your day/);
  assert.match(t, /answered \*14 people\*/);
  assert.match(t, /1 person is waiting/);
  assert.match(t, /not sure who 2 people are/);
  const cbs = recapKeyboard(s).inline_keyboard.flat().map(b => b.callback_data);
  assert.deepEqual(cbs, ['sra_3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'who_list', 'srec_off']);
  assert.match(recapText({ answered: 3, waiting: [] }), /Nobody is waiting/);
  assert.equal(recapWanted({ telegram_biz_conn_id: 'x', notification_prefs: {} }), true);
  assert.equal(recapWanted({ telegram_biz_conn_id: 'x', notification_prefs: { secretary_recap: { enabled: false } } }), false);
  assert.equal(recapWanted({ notification_prefs: {} }), false);
});

test('wiring', () => {
  const re = read('../replyEngine.js');
  assert.match(re, /quickRelationship\(/);
  assert.match(re, /mergeRelationship\(prevCp, profile, quick\)/);
  assert.match(re, /maybeAskWho\(business, conversation, customer\)/);
  assert.match(re, /handleRelayAnswer\(/);
  assert.match(re, /data\.startsWith\('sra_'\) \|\| data === 'srec_off'/);
  assert.match(read('../notification.js'), /callback_data: `sra_\$\{conversationId\}`/);
  assert.match(read('../../../app/api/cron/secretary-recap/route.js'), /sendSecretaryRecap/);
  assert.match(read('../../../../vercel.json'), /secretary-recap/);
});
