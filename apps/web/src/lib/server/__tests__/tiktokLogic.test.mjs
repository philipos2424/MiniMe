import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTikTokEvent,
  tiktokMessageText,
  isEcho,
  needsTokenRefresh,
  expiryFromExpiresIn,
  chunkForTikTok,
  TOKEN_REFRESH_SKEW_MS,
  TIKTOK_MAX_MESSAGE_CHARS,
} from '../tiktokLogic.mjs';

const NOW = Date.parse('2026-09-06T09:00:00Z');

// ────────────────────────────── tiktokMessageText ──────────────────────────────

test('plain text message comes through unchanged', () => {
  assert.equal(tiktokMessageText({ type: 'text', content: 'ስንት ነው ዋጋው?' }), 'ስንት ነው ዋጋው?');
});

test('text wrapped in a JSON content string is unwrapped', () => {
  assert.equal(tiktokMessageText({ type: 'text', content: '{"text":"how much?"}' }), 'how much?');
});

test('content that looks like JSON but is not parseable stays literal', () => {
  assert.equal(tiktokMessageText({ type: 'text', content: '{not json' }), '{not json');
});

test('image without a caption becomes the bracketed placeholder', () => {
  assert.equal(tiktokMessageText({ type: 'image' }), '[Customer sent an image]');
});

test('image with a caption keeps the caption after the placeholder', () => {
  assert.equal(
    tiktokMessageText({ type: 'image', content: { text: 'this one?' } }),
    '[Customer sent an image] this one?',
  );
});

test('voice notes are labelled — we have no TikTok audio download yet', () => {
  assert.equal(tiktokMessageText({ type: 'voice' }), '[Customer sent a voice message]');
});

test('a shared TikTok post is labelled as a share, not as text', () => {
  assert.equal(tiktokMessageText({ type: 'share_post' }), '[Customer shared a TikTok post]');
});

test('an unknown message type carrying readable text is still answerable', () => {
  assert.equal(tiktokMessageText({ type: 'something_new', content: 'hello' }), 'hello');
});

test('an unknown message type with no text yields null so it is skipped', () => {
  assert.equal(tiktokMessageText({ type: 'something_new' }), null);
});

// ────────────────────────────────── isEcho ────────────────────────────────────

test('explicit is_echo flag marks our own message', () => {
  assert.equal(isEcho({ is_echo: true }, {}, 'biz1'), true);
});

test('outbound direction marks our own message', () => {
  assert.equal(isEcho({ direction: 'outbound' }, {}, 'biz1'), true);
});

test('a sender equal to the receiving business is the business itself', () => {
  assert.equal(isEcho({}, { sender: { open_id: 'biz1' } }, 'biz1'), true);
});

test('a genuine customer message is not an echo', () => {
  assert.equal(isEcho({}, { sender: { open_id: 'cust9' } }, 'biz1'), false);
});

// ──────────────────────────────── parseTikTokEvent ─────────────────────────────

const textEvent = (over = {}) => ({
  event: 'message.received',
  business_id: 'biz1',
  conversation_id: 'conv7',
  create_time: 1757148000,
  message: {
    message_id: 'msg1',
    type: 'text',
    content: 'do you deliver to Bole?',
    sender: { open_id: 'cust9', nickname: 'Selam' },
  },
  ...over,
});

test('a single event body yields one normalized message', () => {
  const { events, skipped } = parseTikTokEvent(textEvent());
  assert.equal(skipped.length, 0);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    businessId: 'biz1',
    senderId: 'cust9',
    senderName: 'Selam',
    messageId: 'msg1',
    conversationId: 'conv7',
    text: 'do you deliver to Bole?',
    timestamp: 1757148000,
  });
});

test('events nested under data are unwrapped', () => {
  const { events } = parseTikTokEvent({ event: 'message.received', data: textEvent() });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'do you deliver to Bole?');
});

test('a batch under events[] yields one message each', () => {
  const { events } = parseTikTokEvent({
    events: [textEvent(), textEvent({ message: { ...textEvent().message, message_id: 'msg2', content: 'and Piassa?' } })],
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.messageId), ['msg1', 'msg2']);
});

test('a batch under data.messages[] is handled too', () => {
  const { events } = parseTikTokEvent({ data: { messages: [textEvent()] } });
  assert.equal(events.length, 1);
});

test('read receipts are skipped with a reason, not processed', () => {
  const { events, skipped } = parseTikTokEvent(textEvent({ event: 'message.read' }));
  assert.equal(events.length, 0);
  assert.match(skipped[0], /ignored event/);
});

test('our own echoed message is skipped', () => {
  const { events, skipped } = parseTikTokEvent(textEvent({ direction: 'outbound' }));
  assert.equal(events.length, 0);
  assert.match(skipped[0], /echo/);
});

test('an event with no business id is skipped rather than guessed at', () => {
  const ev = textEvent();
  delete ev.business_id;
  const { events, skipped } = parseTikTokEvent(ev);
  assert.equal(events.length, 0);
  assert.match(skipped[0], /business id/);
});

test('an event with no sender is skipped — there would be nobody to reply to', () => {
  const ev = textEvent();
  delete ev.message.sender;
  const { events, skipped } = parseTikTokEvent(ev);
  assert.equal(events.length, 0);
  assert.match(skipped[0], /sender/);
});

test('an event with no readable text is skipped', () => {
  const ev = textEvent({ message: { message_id: 'm', type: 'unknown_thing', sender: { open_id: 'cust9' } } });
  const { events, skipped } = parseTikTokEvent(ev);
  assert.equal(events.length, 0);
  assert.match(skipped[0], /readable text/);
});

test('alternative field names (bc_id, from, thread_id) are accepted', () => {
  const { events } = parseTikTokEvent({
    bc_id: 'biz2',
    thread_id: 'thread3',
    from: { user_id: 'cust5', display_name: 'Abel' },
    message: { msg_id: 'm5', type: 'text', text: 'hi' },
  });
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].businessId, events[0].conversationId, events[0].senderId, events[0].senderName, events[0].messageId],
    ['biz2', 'thread3', 'cust5', 'Abel', 'm5'],
  );
});

test('a non-object body is reported, never thrown on', () => {
  const { events, skipped } = parseTikTokEvent(null);
  assert.equal(events.length, 0);
  assert.equal(skipped.length, 1);
});

test('a missing timestamp becomes null rather than NaN', () => {
  const ev = textEvent();
  delete ev.create_time;
  const { events } = parseTikTokEvent(ev);
  assert.equal(events[0].timestamp, null);
});

// ─────────────────────────────── token lifecycle ──────────────────────────────

test('no refresh token → never try to refresh', () => {
  assert.equal(needsTokenRefresh({ expiresAt: null, hasRefreshToken: false, nowMs: NOW }), false);
});

test('unknown expiry with a refresh token → refresh', () => {
  assert.equal(needsTokenRefresh({ expiresAt: null, hasRefreshToken: true, nowMs: NOW }), true);
});

test('token expiring inside the skew window → refresh before using it', () => {
  const soon = new Date(NOW + TOKEN_REFRESH_SKEW_MS - 1000).toISOString();
  assert.equal(needsTokenRefresh({ expiresAt: soon, hasRefreshToken: true, nowMs: NOW }), true);
});

test('token good for another hour → use it as is', () => {
  const later = new Date(NOW + 60 * 60 * 1000).toISOString();
  assert.equal(needsTokenRefresh({ expiresAt: later, hasRefreshToken: true, nowMs: NOW }), false);
});

test('already-expired token → refresh', () => {
  const past = new Date(NOW - 1000).toISOString();
  assert.equal(needsTokenRefresh({ expiresAt: past, hasRefreshToken: true, nowMs: NOW }), true);
});

test('unparseable expiry → refresh rather than trust it', () => {
  assert.equal(needsTokenRefresh({ expiresAt: 'whenever', hasRefreshToken: true, nowMs: NOW }), true);
});

test('expires_in becomes an absolute ISO expiry', () => {
  assert.equal(expiryFromExpiresIn(3600, NOW), new Date(NOW + 3600_000).toISOString());
});

test('a missing or nonsensical expires_in yields null, not an invalid date', () => {
  assert.equal(expiryFromExpiresIn(undefined, NOW), null);
  assert.equal(expiryFromExpiresIn(0, NOW), null);
  assert.equal(expiryFromExpiresIn('soon', NOW), null);
});

// ──────────────────────────────── chunkForTikTok ──────────────────────────────

test('a short reply is sent as one message', () => {
  assert.deepEqual(chunkForTikTok('Yes, we deliver.'), ['Yes, we deliver.']);
});

test('empty text produces no messages at all', () => {
  assert.deepEqual(chunkForTikTok('   '), []);
});

test('a long reply is split into chunks that all fit the limit', () => {
  const long = 'Sentence number one is here. '.repeat(80); // ~2240 chars
  const chunks = chunkForTikTok(long);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= TIKTOK_MAX_MESSAGE_CHARS, `chunk too long: ${c.length}`);
});

test('splitting never breaks a word in half', () => {
  const long = 'antidisestablishmentarianism '.repeat(60);
  for (const c of chunkForTikTok(long)) {
    assert.ok(!/\Santi$/.test(c), 'chunk ended mid-word');
    for (const word of c.split(/\s+/)) {
      assert.ok(word === '' || word === 'antidisestablishmentarianism', `broken word: ${word}`);
    }
  }
});

test('no content is lost across the split', () => {
  const long = 'word '.repeat(500).trim();
  const joined = chunkForTikTok(long).join(' ');
  assert.equal(joined.split(/\s+/).length, 500);
});
