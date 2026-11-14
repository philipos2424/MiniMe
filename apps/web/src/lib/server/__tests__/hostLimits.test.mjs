import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostName, requestCapMs, isServerless, llmLimits, replyDeadlineMs, raceDeadline, describeUpdate, timedOutText } from '../hostLimits.mjs';

const NETLIFY = { MINIME_HOST: 'netlify' };
const VERCEL = { VERCEL: '1' };

test('host is read from the build marker, then the platform env', () => {
  assert.equal(hostName(NETLIFY), 'netlify');
  assert.equal(hostName(VERCEL), 'vercel');
  assert.equal(hostName({ NETLIFY: 'true' }), 'netlify');
  assert.equal(hostName({}), 'node');
  assert.equal(isServerless({}), false);
  assert.equal(isServerless(NETLIFY), true);
});

test('Netlify gets 60 seconds, everything else 300', () => {
  assert.equal(requestCapMs(NETLIFY), 60_000);
  assert.equal(requestCapMs(VERCEL), 300_000);
  assert.equal(requestCapMs({}), 300_000);
});

test('on a 60s host the whole fallback chain fits inside the reply deadline', () => {
  const l = llmLimits(NETLIFY);
  const worstCase = [l.gemini, l.groq, l.openai].reduce((ms, p) => ms + p.timeout * (p.maxRetries + 1), 0);
  assert.ok(worstCase < requestCapMs(NETLIFY), `chain can take ${worstCase}ms`);
  assert.equal(l.gemini.maxRetries, 0);
});

test('Vercel keeps the limits it had', () => {
  assert.deepEqual(llmLimits(VERCEL), {
    openai: { timeout: 45_000, maxRetries: 1 },
    gemini: { timeout: 45_000, maxRetries: 1 },
    groq: { timeout: 30_000, maxRetries: 1 },
    ollama: { timeout: 60_000, maxRetries: 0 },
  });
});

test('only a 60s host gets a reply deadline', () => {
  assert.equal(replyDeadlineMs(NETLIFY), 50_000);
  assert.equal(replyDeadlineMs(VERCEL), null);
});

test('raceDeadline: work that finishes in time returns its value', async () => {
  assert.deepEqual(await raceDeadline(Promise.resolve('done'), 50), { timedOut: false, value: 'done' });
  assert.deepEqual(await raceDeadline(Promise.resolve('done'), null), { timedOut: false, value: 'done' });
});

test('raceDeadline: slow work times out without being cancelled', async () => {
  let finished = false;
  const slow = new Promise(r => setTimeout(() => { finished = true; r('late'); }, 60));
  assert.deepEqual(await raceDeadline(slow, 10), { timedOut: true });
  assert.equal(await slow, 'late');
  assert.equal(finished, true);
});

test('raceDeadline: a failure before the deadline still throws', async () => {
  await assert.rejects(raceDeadline(Promise.reject(new Error('boom')), 50), /boom/);
});

test('describeUpdate names the sender and the message', () => {
  assert.deepEqual(describeUpdate({ message: { from: { id: 7, first_name: 'Sara', last_name: 'K' }, text: 'Do you have size 40?' } }),
    { name: 'Sara K', fromId: 7, text: 'Do you have size 40?' });
  assert.equal(describeUpdate({ business_message: { from: { id: 9, username: 'abel' }, photo: [{}] } }).name, '@abel');
  assert.equal(describeUpdate({ business_message: { from: { id: 9 }, photo: [{}] } }).text, '[photo]');
  assert.equal(describeUpdate({ callback_query: { id: '1' } }), null);
});

test('timedOutText tells the owner which customer was left waiting', () => {
  const who = { name: 'Sara', text: 'Do you have size 40?' };
  assert.match(timedOutText(who), /Sara/);
  assert.match(timedOutText(who), /size 40/);
  assert.match(timedOutText(who, { fromOwner: true }), /send it again/);
});
