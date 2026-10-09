/**
 * The brain may only send links it was given.
 *
 * Every "invented" case below was sent to a real customer between 2026-09-27
 * and 2026-10-09 by the follow-ups cron. Every "real" case is a link that was
 * on the business profile or already in the chat, and must survive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubUnknownLinks, profileUrls, extractUrls, normalizeUrl } from '../linkGuard.mjs';

const known = (business, ...texts) => new Set([...profileUrls(business), ...extractUrls(...texts)]);
const hosts = new Set(['chapa.co', 'web-theta-one-68.vercel.app']);

test('placeholder and invented links are removed', () => {
  const k = known({});
  for (const msg of [
    'ሰላም Cleopatra! ቀደም የተጠየቀው ፍላር ጂንስ ለምሳሌ እዚህ አለ: https://example.com/flared-jeans.',
    'Here is a sample: https://example.com/baist-blueprint-sample',
    'Check our portfolio https://bebanya.com/portfolio',
    'See https://h-ittech.com/sample for an example',
    'Our site: https://eximman.tech/.',
  ]) {
    const { text, removed } = scrubUnknownLinks(msg, k, hosts);
    assert.equal(removed.length, 1, msg);
    assert.doesNotMatch(text, /https?:\/\//, msg);
  }
});

test('a real domain with an invented path is still invented', () => {
  const k = known({ website: 'jackdigitals.com' });
  const { text, removed } = scrubUnknownLinks(
    'Websites: https://jackdigitals.com/portfolio/websites — or just visit https://jackdigitals.com', k, hosts);
  assert.deepEqual(removed, ['https://jackdigitals.com/portfolio/websites']);
  assert.match(text, /https:\/\/jackdigitals\.com$/);
});

test('profile links survive in every form share_links produces', () => {
  const biz = { website: 'https://iconnect.plus', instagram: '@iconnect.plus', tiktok: 'iconnect.plus', telegram_bot_username: 'iconnect_bot' };
  const k = known(biz);
  const msg = 'Site: https://iconnect.plus. IG https://www.instagram.com/iconnect.plus/ TikTok https://tiktok.com/@iconnect.plus and https://t.me/iconnect_bot';
  const { text, removed } = scrubUnknownLinks(msg, k, hosts);
  assert.deepEqual(removed, []);
  assert.equal(text, msg);
});

test('an Instagram handle with a space still matches the link it becomes', () => {
  const k = known({ instagram: 'Amanuel kebu ' });
  assert.deepEqual(scrubUnknownLinks('https://instagram.com/Amanuelkebu', k, hosts).removed, []);
  // …but a different, guessed handle does not.
  assert.equal(scrubUnknownLinks('https://instagram.com/Amanuel', k, hosts).removed.length, 1);
});

test('links already in the chat or the knowledge base survive', () => {
  const k = known({}, 'owner: here is our reel https://vm.tiktok.com/ZNRww7DD8/', 'KB: https://www.instagram.com/reel/DZH_85NI3fn/?igsi=MXRmdXNxdWtnb2kzcg==');
  const msg = 'Remember this? https://vm.tiktok.com/ZNRww7DD8/ and https://www.instagram.com/reel/DZH_85NI3fn/?igsi=MXRmdXNxdWtnb2kzcg==';
  assert.deepEqual(scrubUnknownLinks(msg, k, hosts).removed, []);
});

test('payment and platform links are always allowed', () => {
  const msg = 'Pay here: https://checkout.chapa.co/checkout/payment/abc123 · receipt https://web-theta-one-68.vercel.app/receipt/9';
  assert.deepEqual(scrubUnknownLinks(msg, new Set(), hosts).removed, []);
});

test('text around a removed link reads cleanly', () => {
  const { text } = scrubUnknownLinks('Hi Feva! Here is a new sample, take a look: https://example.com/x\nStill interested?', new Set(), hosts);
  assert.equal(text, 'Hi Feva! Here is a new sample, take a look\nStill interested?');
});

test('a message with no links is returned untouched', () => {
  const msg = 'ሰላም! እንዴት ነህ? 😊';
  const r = scrubUnknownLinks(msg, new Set(), hosts);
  assert.equal(r.text, msg);
  assert.deepEqual(r.removed, []);
});

test('normalization ignores scheme, www, case of host and trailing punctuation', () => {
  assert.equal(normalizeUrl('HTTPS://WWW.Iconnect.plus/.'), 'iconnect.plus');
  assert.equal(normalizeUrl('http://a.com/Path/'), 'a.com/Path');
});

// From the Codex review (2026-10-09): 34 call sites build links from WEB_URL,
// not NEXT_PUBLIC_APP_URL — receipts and shop pages must not be stripped.
test('links on any of our app hosts survive', async () => {
  const { trustedHosts } = await import('../linkGuard.mjs');
  const prev = { ...process.env };
  process.env.WEB_URL = 'https://web-theta-one-68.vercel.app';
  process.env.MINIAPP_URL = 'https://mini.example-app.et/';
  try {
    const h = trustedHosts();
    for (const url of ['https://web-theta-one-68.vercel.app/receipt/42', 'https://mini.example-app.et/shop/abc']) {
      assert.deepEqual(scrubUnknownLinks(`Here: ${url}`, new Set(), h).removed, [], url);
    }
  } finally { process.env = prev; }
});

test('a link the owner wrote into a rule or FAQ answer survives', () => {
  const k = known({}, 'Send people our menu at https://bit.ly/maraki-menu when they ask');
  assert.deepEqual(scrubUnknownLinks('Menu: https://bit.ly/maraki-menu', k, hosts).removed, []);
});
