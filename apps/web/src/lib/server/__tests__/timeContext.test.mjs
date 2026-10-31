import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nowLine, partOfDay, gapLabel, gapMarkers, withGap, timeBlock } from '../../timeContext.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

test('the clock is Addis Ababa time', () => {
  assert.equal(nowLine(new Date('2026-10-31T12:31:00Z')), 'Saturday 31 October 2026, 3:31 pm (afternoon)');
  assert.equal(nowLine(new Date('2026-10-31T19:05:00Z')), 'Saturday 31 October 2026, 10:05 pm (night)');
  assert.equal(nowLine(new Date('2026-10-31T21:30:00Z')), 'Sunday 1 November 2026, 12:30 am (night)');
  assert.equal(partOfDay(8), 'morning');
});

test('gaps: nothing for a normal pause, hours, next day, days, weeks', () => {
  assert.equal(gapLabel('2026-10-31T08:00:00Z', '2026-10-31T09:00:00Z'), null);
  assert.equal(gapLabel('2026-10-31T06:00:00Z', '2026-10-31T11:00:00Z'), '5 hours later');
  assert.equal(gapLabel('2026-10-30T15:00:00Z', '2026-10-31T06:00:00Z'), 'next day, Saturday');
  assert.equal(gapLabel('2026-10-27T08:00:00Z', '2026-10-31T08:00:00Z'), '4 days later, Saturday');
  assert.equal(gapLabel('2026-10-03T08:00:00Z', '2026-10-31T08:00:00Z'), '4 weeks later');
});

test('markers line up with the chat and prefix the text', () => {
  const h = [
    { content: 'hi', created_at: '2026-10-27T08:00:00Z' },
    { content: 'hello', created_at: '2026-10-27T08:01:00Z' },
    { content: 'still have it?', created_at: '2026-10-31T08:00:00Z' },
  ];
  const g = gapMarkers(h);
  assert.deepEqual(g, [null, null, '4 days later, Saturday']);
  assert.equal(withGap(h[2].content, g[2]), '[4 days later, Saturday] still have it?');
});

test('time block: now, and a coming-back note after a break', () => {
  const now = new Date('2026-10-31T12:31:00Z');
  const fresh = timeBlock([{ created_at: '2026-10-31T12:20:00Z' }], now);
  assert.match(fresh, /Saturday 31 October 2026, 3:31 pm/);
  assert.doesNotMatch(fresh, /coming back/);
  const back = timeBlock([{ created_at: '2026-10-27T08:00:00Z' }], now);
  assert.match(back, /4 days ago — they are coming back after a break/);
});

test('every reply path gets the clock and the gaps', () => {
  const e = readFileSync(`${here}../replyEngine.js`, 'utf8');
  assert.match(e, /volatileBlock \+= '\\n\\n' \+ timeBlock\(rawWindow\)/);
  assert.match(e, /content: withGap\(m\.content|let content = withGap\(m\.content, gaps\[gi\]\)/);
  assert.match(e, /fastTimeBlock\(fastBase\)/);
  const b = readFileSync(`${here}../agentBrain.js`, 'utf8');
  assert.match(b, /const timeNow = timeBlock\(recent/);
  assert.doesNotMatch(b, /`Today: \$\{new Date\(\)\.toISOString\(\)/);
});
