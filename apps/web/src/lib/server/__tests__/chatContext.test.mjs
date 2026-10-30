import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { historyWithoutCurrent, lastOwnReply, noRepeatRules, photosAlreadySent, fallbackRecentlySent } from '../chatContext.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = f => readFileSync(`${here}${f}`, 'utf8');
const inb = c => ({ direction: 'inbound', content: c });
const out = c => ({ direction: 'outbound', content: c });

test('the message being answered is not shown twice', () => {
  const h = [inb('hi'), out('Hello!'), inb('Do you have size 42?')];
  assert.deepEqual(historyWithoutCurrent(h, 'do you have  size 42?'), h.slice(0, 2));
});

test('a real resend still appears once in history', () => {
  const h = [inb('price?'), out('500 birr'), inb('price?')];
  assert.equal(historyWithoutCurrent(h, 'price?').length, 2);
  assert.equal(historyWithoutCurrent(h, 'price?').filter(m => m.content === 'price?').length, 1);
});

test('nothing is dropped when the last message is different or outbound', () => {
  const h = [inb('a'), out('b')];
  assert.equal(historyWithoutCurrent(h, 'b').length, 2);
  assert.equal(historyWithoutCurrent([inb('x')], 'y').length, 1);
  assert.deepEqual(historyWithoutCurrent(null, 'x'), []);
});

test('rules forbid "you are repeating yourself" and quote the last reply', () => {
  const r = noRepeatRules([inb('hi'), out('We open at 9am.'), out('[sent 3 product photos]')]);
  assert.match(r, /Never tell anyone they are repeating themselves/);
  assert.match(r, /Your last reply was: "We open at 9am\."/);
  assert.equal(lastOwnReply([out('[sent 2 product photos]')]), '');
});

test('the same photo set is not re-sent', () => {
  const h = [inb('photo'), out('[sent 5 product photos]'), inb('ok'), out('Anything else?')];
  assert.ok(photosAlreadySent(h, '[sent 5 product photos]'));
  assert.ok(!photosAlreadySent(h, '[sent 2 product photos]'));
});

test('one apology per conversation per 6 hours', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.ok(fallbackRecentlySent([{ direction: 'outbound', content: '[fallback: draftReply failed]', created_at: '2026-10-30T10:00:00Z' }], { now }));
  assert.ok(!fallbackRecentlySent([{ direction: 'outbound', content: '[fallback: draftReply failed]', created_at: '2026-10-30T03:00:00Z' }], { now }));
});

test('all three reply paths use it', () => {
  const eng = read('../replyEngine.js');
  assert.match(eng, /const fastHistory = historyWithoutCurrent\(fastRecent, msg\.text\)/);
  assert.match(eng, /noRepeatRules\(historyWithoutCurrent\(fastRecent, msg\.text\)\)/);
  assert.match(eng, /historyWithoutCurrent\(recent, incomingText\)\.length < recent\.length\) recent\.pop\(\)/);
  assert.match(eng, /\{ role: 'system', content: noRepeatRules\(recent\) \}/);
  assert.match(eng, /!skippedRepeat\) \{/);
  assert.match(eng, /if \(!apologisedRecently\) try \{/);
  const brain = read('../agentBrain.js');
  assert.match(brain, /const recent = historyWithoutCurrent\(allMessagesAsc \|\| \[\], inboundText\)/);
  assert.match(brain, /noRepeatRulesText: noRepeatRules\(recent\)/);
});
