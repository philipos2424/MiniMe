/**
 * tiktokLogic.mjs — pure helpers for the TikTok Business Messaging channel.
 *
 * Everything here is side-effect free so it can be unit tested directly
 * (src/lib/server/__tests__/tiktokLogic.test.mjs), the same split the repo
 * already uses for sendAs/sendAsLogic and delegation/delegationLogic.
 *
 * ── Which TikTok API is this? ────────────────────────────────────────────────
 * TikTok has no general-purpose DM API: personal and creator inboxes are not
 * exposed to third parties. The one surface that lets software receive and
 * answer TikTok DMs is the **Business Messaging API** on
 * business-api.tiktok.com (v1.3) — a TikTok user messages a Business Account,
 * TikTok posts the event to a webhook, and the business replies in the same
 * conversation. Threads are always user-initiated; a business cannot cold-open
 * one. That maps cleanly onto how MiniMe already works.
 *
 * ── Why the parser is tolerant ───────────────────────────────────────────────
 * The v1.3 reference sits behind a JavaScript-rendered portal, so the exact
 * envelope field names could not be read from source while writing this.
 * parseTikTokEvent therefore accepts the handful of shapes TikTok uses across
 * its webhook products instead of hard-coding one guess, and every endpoint
 * path below is env-overridable. A payload we cannot read is reported as
 * skipped rather than silently dropped — check the webhook route's log line,
 * then correct the field lists or ENDPOINTS here, in one place.
 * Docs: https://business-api.tiktok.com/portal/docs/business-messaging/v1.3
 */

export const TIKTOK_API_BASE =
  (process.env.TIKTOK_API_BASE || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/$/, '');

/**
 * Every TikTok path the integration calls, in one table.
 * Shape follows the TikTok Business API v1.3 convention: `<base>/<resource>/`
 * with an `Access-Token` header. Each is env-overridable so a path change on
 * TikTok's side is a config edit, not a deploy.
 */
export const TIKTOK_ENDPOINTS = {
  // OAuth — exchange an auth code, refresh an access token
  token:        process.env.TIKTOK_EP_TOKEN         || '/tt_user/oauth2/token/',
  refresh:      process.env.TIKTOK_EP_REFRESH       || '/tt_user/oauth2/refresh_token/',
  // Business account info (resolves the account name after connecting)
  businessGet:  process.env.TIKTOK_EP_BUSINESS_GET  || '/business/get/',
  // Messaging
  sendMessage:  process.env.TIKTOK_EP_SEND          || '/business/message/send/',
  listConvos:   process.env.TIKTOK_EP_CONVERSATIONS || '/business/conversation/list/',
  listMessages: process.env.TIKTOK_EP_MESSAGES      || '/business/message/list/',
};

/** TikTok's OAuth consent screen (user-facing host, not the API host). */
export const TIKTOK_AUTHORIZE_URL =
  process.env.TIKTOK_AUTHORIZE_URL || 'https://www.tiktok.com/v2/auth/authorize/';

/** Scopes needed to read and answer Business Account DMs. */
export const TIKTOK_SCOPES =
  process.env.TIKTOK_SCOPES || 'user.info.basic,biz.message.read,biz.message.write';

export const TIKTOK_LABEL = '🎵 TikTok';

/** TikTok caps a single DM well below Telegram's 4096; keep replies inside it. */
export const TIKTOK_MAX_MESSAGE_CHARS = 1000;

// ── field pickers ─────────────────────────────────────────────────────────────
/** First non-empty value among `keys` on `obj`, as a trimmed string. */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

const BUSINESS_KEYS = ['business_id', 'bc_id', 'to_business_id', 'receiver_id', 'account_id'];
const SENDER_KEYS   = ['open_id', 'sender_id', 'from_id', 'user_id', 'id'];
const MESSAGE_KEYS  = ['message_id', 'msg_id', 'server_message_id', 'id'];
const CONVO_KEYS    = ['conversation_id', 'thread_id', 'chat_id'];

/**
 * Human-readable stand-in for a non-text message, matching the bracketed
 * convention the Meta channels use so the AI prompt reads the same everywhere.
 */
export function tiktokMessageText(message) {
  if (!message || typeof message !== 'object') return null;

  const type = String(message.type || message.message_type || 'text').toLowerCase();
  const content = message.content ?? message.text ?? message.body;

  // `content` arrives as a JSON string, an object, or plain text depending on
  // the message type — normalise all three before reading a caption out of it.
  let obj = null;
  let plain = null;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try { obj = JSON.parse(trimmed); } catch { plain = trimmed; }
    } else {
      plain = trimmed;
    }
  } else if (content && typeof content === 'object') {
    obj = content;
  }

  const text = plain || pick(obj, ['text', 'content', 'body', 'caption']);

  switch (type) {
    case 'text':
      return text || null;
    case 'image':
    case 'picture':
      return text ? `[Customer sent an image] ${text}` : '[Customer sent an image]';
    case 'video':
      return text ? `[Customer sent a video] ${text}` : '[Customer sent a video]';
    case 'audio':
    case 'voice':
      return '[Customer sent a voice message]';
    case 'sticker':
    case 'emoticon':
      return '[Customer sent a sticker]';
    case 'share_post':
    case 'video_share':
    case 'post':
      return text ? `[Customer shared a TikTok post] ${text}` : '[Customer shared a TikTok post]';
    case 'product':
    case 'product_card':
      return text ? `[Customer shared a product] ${text}` : '[Customer shared a product]';
    default:
      // An unknown type carrying readable text is still worth answering.
      return text || null;
  }
}

/** True when this event is our own outbound message echoed back to us. */
export function isEcho(event, message, businessId) {
  if (event?.is_echo === true || message?.is_echo === true) return true;
  const dir = String(event?.direction || message?.direction || '').toLowerCase();
  if (dir === 'outbound' || dir === 'send' || dir === 'sent') return true;
  const role = String(message?.sender_role || event?.sender_role || '').toLowerCase();
  if (role === 'business' || role === 'seller' || role === 'merchant') return true;
  // A sender equal to the receiving business account is the business itself.
  const senderId = pick(message?.sender || event?.sender || event?.from || null, SENDER_KEYS)
    || pick(event, ['sender_id', 'from_id']);
  return !!(businessId && senderId && senderId === businessId);
}

/**
 * Normalize a raw TikTok webhook body into inbound message descriptors.
 *
 * @returns {{ events: Array<object>, skipped: Array<string> }} — `skipped`
 *   holds a short reason per dropped entry so the webhook route can log why
 *   nothing was processed, instead of a silent 200.
 */
export function parseTikTokEvent(body) {
  const events = [];
  const skipped = [];
  if (!body || typeof body !== 'object') return { events, skipped: ['body not an object'] };

  // A batch arrives as a bare event or under any of these list keys.
  const raw = Array.isArray(body) ? body
    : Array.isArray(body.events) ? body.events
    : Array.isArray(body.data) ? body.data
    : Array.isArray(body.data?.events) ? body.data.events
    : Array.isArray(body.data?.messages) ? body.data.messages
    : Array.isArray(body.data?.list) ? body.data.list
    : [body];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') { skipped.push('entry not an object'); continue; }

    // The interesting fields sit either on the entry or one level down in `data`.
    const nested = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data);
    const event = nested ? { ...entry, ...entry.data } : entry;

    const eventName = String(entry.event || entry.type || event.event_type || '').toLowerCase();
    // Read receipts, typing pings and recalls carry nothing to answer. Only
    // bail on names we positively recognise as noise — an unnamed event still
    // gets the readable-text check below.
    if (/read|delivered|receipt|typing|recall|revoke/.test(eventName)) {
      skipped.push(`ignored event "${eventName}"`);
      continue;
    }

    const businessId = pick(event, BUSINESS_KEYS) || pick(body, BUSINESS_KEYS);
    if (!businessId) { skipped.push('no business id on event'); continue; }

    const message = (event.message && typeof event.message === 'object') ? event.message : event;

    if (isEcho(event, message, businessId)) { skipped.push('echo of our own message'); continue; }

    const senderObj = message.sender || event.sender || event.from || event.user || null;
    const senderId = pick(senderObj, SENDER_KEYS) || pick(event, ['sender_id', 'from_id', 'open_id']);
    if (!senderId) { skipped.push('no sender id'); continue; }

    const text = tiktokMessageText(message);
    if (!text) { skipped.push('no readable text'); continue; }

    const tsRaw = event.create_time ?? event.timestamp ?? message.create_time ?? message.timestamp ?? null;
    const ts = tsRaw == null ? null : Number(tsRaw);

    events.push({
      businessId,
      senderId,
      senderName: pick(senderObj, ['nickname', 'display_name', 'username', 'name']),
      messageId: pick(message, MESSAGE_KEYS) || pick(event, MESSAGE_KEYS),
      conversationId: pick(event, CONVO_KEYS) || pick(message, CONVO_KEYS),
      text,
      timestamp: Number.isFinite(ts) ? ts : null,
    });
  }

  return { events, skipped };
}

// ── token lifecycle ───────────────────────────────────────────────────────────
/** Refresh a little before the token actually dies, so no request races expiry. */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Should we refresh before using this access token?
 * With no refresh token there is nothing to refresh with, so we try what we
 * have rather than fail closed. A missing or unparseable expiry counts as due.
 */
export function needsTokenRefresh({ expiresAt, hasRefreshToken, nowMs = Date.now() }) {
  if (!hasRefreshToken) return false;
  if (!expiresAt) return true;
  const expMs = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(expMs)) return true;
  return expMs - nowMs <= TOKEN_REFRESH_SKEW_MS;
}

/** Absolute expiry ISO string from TikTok's relative `expires_in` (seconds). */
export function expiryFromExpiresIn(expiresIn, nowMs = Date.now()) {
  const secs = Number(expiresIn);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return new Date(nowMs + secs * 1000).toISOString();
}

/**
 * Split a reply that exceeds TikTok's per-message limit, preferring paragraph
 * then sentence then word boundaries so a draft never breaks mid-word.
 */
export function chunkForTikTok(text, max = TIKTOK_MAX_MESSAGE_CHARS) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  if (s.length <= max) return [s];

  const chunks = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) {
      cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
      if (cut > 0) cut += 1; // keep the punctuation with its sentence
    }
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}
