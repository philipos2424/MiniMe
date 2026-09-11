/**
 * tiktokApi.js — HTTP transport for the TikTok Business Messaging API.
 *
 * Mirrors telegramApi.js: nothing here knows about conversations or drafts, it
 * only speaks TikTok's wire protocol. All paths live in TIKTOK_ENDPOINTS
 * (tiktokLogic.mjs) so a path change is a config edit, not a code change.
 *
 * TikTok Business API conventions this module encodes:
 *   • Base https://business-api.tiktok.com/open_api/v1.3
 *   • Auth via an `Access-Token` header (not `Authorization: Bearer`)
 *   • Every response is {code, message, request_id, data}; code 0 means success,
 *     so a 200 with code != 0 is still a failure and must throw.
 *   • Access tokens are short-lived and refreshed with a long-lived refresh
 *     token; both are stored encrypted on the business row.
 */
import crypto from 'crypto';
import { supabase } from './db';
import { encrypt, decrypt } from './crypto';
import {
  TIKTOK_API_BASE,
  TIKTOK_ENDPOINTS,
  needsTokenRefresh,
  expiryFromExpiresIn,
} from './tiktokLogic.mjs';

const TIMEOUT_MS = 10000;

function appCredentials() {
  return {
    clientKey: (process.env.TIKTOK_CLIENT_KEY || '').trim(),
    clientSecret: (process.env.TIKTOK_CLIENT_SECRET || '').trim(),
  };
}

export function tiktokConfigured() {
  const { clientKey, clientSecret } = appCredentials();
  return !!(clientKey && clientSecret);
}

/**
 * Call a TikTok Business API endpoint.
 * Throws on transport failure, on a non-2xx, and on a business-level error
 * code — callers can treat a returned value as success.
 */
export async function tiktokFetch(path, { method = 'GET', token, params, body, timeout = TIMEOUT_MS } = {}) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const url = `${TIKTOK_API_BASE}${path}${qs}`;

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Access-Token'] = token;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const err = new Error(`TikTok request failed: ${e.message}`);
    err.retryable = true;
    throw err;
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(json?.message || `TikTok API HTTP ${res.status}`);
    err.status = res.status;
    // 429 and 5xx are worth a redelivery; 4xx generally is not.
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  // TikTok signals business errors inside a 200 response.
  const code = json?.code;
  if (code !== undefined && code !== 0) {
    const err = new Error(json?.message || `TikTok API error ${code}`);
    err.code = code;
    err.requestId = json?.request_id;
    throw err;
  }

  return json?.data ?? json;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(authCode, redirectUri) {
  const { clientKey, clientSecret } = appCredentials();
  if (!clientKey || !clientSecret) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set');

  return tiktokFetch(TIKTOK_ENDPOINTS.token, {
    method: 'POST',
    body: {
      client_id: clientKey,
      client_key: clientKey,       // TikTok accepts either name depending on product
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      auth_code: authCode,
      code: authCode,
      redirect_uri: redirectUri,
    },
  });
}

/** Trade a refresh token for a fresh access token. */
export async function refreshTokens(refreshToken) {
  const { clientKey, clientSecret } = appCredentials();
  if (!clientKey || !clientSecret) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set');

  return tiktokFetch(TIKTOK_ENDPOINTS.refresh, {
    method: 'POST',
    body: {
      client_id: clientKey,
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  });
}

/**
 * Persist a token response onto the business row. TikTok may or may not rotate
 * the refresh token, so only overwrite it when a new one comes back.
 */
export async function storeTokens(businessId, data, extra = {}) {
  const updates = { ...extra };
  const access = data?.access_token || data?.token;
  const refresh = data?.refresh_token;

  if (access) updates.tiktok_access_token_enc = encrypt(access);
  if (refresh) updates.tiktok_refresh_token_enc = encrypt(refresh);

  const expiry = expiryFromExpiresIn(data?.expires_in ?? data?.access_token_expire_in);
  if (expiry) updates.tiktok_token_expires_at = expiry;

  if (!Object.keys(updates).length) return null;
  const { error } = await supabase().from('businesses').update(updates).eq('id', businessId);
  if (error) throw new Error(`storing TikTok tokens failed: ${error.message}`);
  return updates;
}

/**
 * A usable access token for this business, refreshing first if it is at or
 * near expiry. Returns null when the business has no TikTok connection —
 * callers must treat that as "not connected", not as an error.
 */
export async function getAccessToken(business) {
  if (!business?.tiktok_access_token_enc && !business?.tiktok_refresh_token_enc) return null;

  let refreshToken = null;
  try {
    refreshToken = business.tiktok_refresh_token_enc ? decrypt(business.tiktok_refresh_token_enc) : null;
  } catch {
    refreshToken = null;
  }

  const due = needsTokenRefresh({
    expiresAt: business.tiktok_token_expires_at,
    hasRefreshToken: !!refreshToken,
  });

  if (due && refreshToken) {
    try {
      const data = await refreshTokens(refreshToken);
      await storeTokens(business.id, data);
      const fresh = data?.access_token || data?.token;
      if (fresh) return fresh;
    } catch (e) {
      // A refresh failure is not fatal while the current token may still work —
      // fall through and try it, so one bad refresh doesn't drop a customer's
      // message. A genuinely dead token surfaces as a send error instead.
      console.warn('[tiktokApi] token refresh failed:', e.message);
    }
  }

  try {
    return business.tiktok_access_token_enc ? decrypt(business.tiktok_access_token_enc) : null;
  } catch {
    return null;
  }
}

// ── Business account ──────────────────────────────────────────────────────────
/** Profile of the connected Business Account (name/handle for the settings UI). */
export async function getBusinessInfo({ token, businessId }) {
  return tiktokFetch(TIKTOK_ENDPOINTS.businessGet, {
    token,
    params: { business_id: businessId, fields: JSON.stringify(['username', 'display_name', 'profile_image']) },
  });
}

// ── Messaging ─────────────────────────────────────────────────────────────────
/**
 * Send one text DM.
 *
 * Addressing: TikTok threads are identified by conversation_id. We include the
 * recipient's open_id too, because a first reply after a webhook sometimes has
 * only the sender. Extra fields are ignored by the API, a missing one is not.
 *
 * @param {object}  args
 * @param {string}  args.token          — access token from getAccessToken()
 * @param {string}  args.businessId     — tiktok_business_id of the sender
 * @param {string}  [args.conversationId]
 * @param {string}  [args.recipientId]  — customer's open_id
 * @param {string}  args.text
 */
export async function sendMessage({ token, businessId, conversationId, recipientId, text }) {
  if (!token) throw new Error('No TikTok access token');
  if (!conversationId && !recipientId) throw new Error('No TikTok conversation or recipient to send to');

  return tiktokFetch(TIKTOK_ENDPOINTS.sendMessage, {
    method: 'POST',
    token,
    body: {
      business_id: businessId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(recipientId ? { to_open_id: recipientId, open_id: recipientId } : {}),
      message_type: 'text',
      message: { type: 'text', text, content: JSON.stringify({ text }) },
      text,
    },
  });
}

/** Recent conversations for a business account (used by the connection test). */
export async function listConversations({ token, businessId, pageSize = 20, cursor }) {
  return tiktokFetch(TIKTOK_ENDPOINTS.listConvos, {
    token,
    params: {
      business_id: businessId,
      page_size: String(pageSize),
      ...(cursor ? { cursor: String(cursor) } : {}),
    },
  });
}

// ── Webhook authenticity ──────────────────────────────────────────────────────
/**
 * Verify a webhook delivery.
 *
 * Two independent guards, because TikTok's exact signature scheme could not be
 * confirmed from the (JS-rendered) docs while writing this:
 *
 *   1. The URL path secret — /api/webhook/tiktok/<secret> — checked by the
 *      route itself. This is the guarantee that does not depend on TikTok's
 *      scheme at all, and is the same pattern the multi-tenant Telegram
 *      webhook uses.
 *   2. This HMAC check, applied only when TIKTOK_WEBHOOK_SECRET is set. It
 *      accepts a hex HMAC-SHA256 over the raw body, and over
 *      `${timestamp}${body}` — the two shapes TikTok uses across its webhook
 *      products — so turning it on is safe once you have confirmed the scheme.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
export function verifyWebhookSignature(request, rawBody) {
  const secret = (process.env.TIKTOK_WEBHOOK_SECRET || '').trim();
  if (!secret) return { ok: true, reason: 'hmac not configured' };

  const provided = request.headers.get('x-tt-signature')
    || request.headers.get('x-tiktok-signature')
    || request.headers.get('tt-signature')
    || request.headers.get('x-signature');
  if (!provided) return { ok: false, reason: 'no signature header' };

  const timestamp = request.headers.get('x-tt-timestamp') || request.headers.get('tt-timestamp') || '';
  const candidates = [rawBody, `${timestamp}${rawBody}`];

  const clean = provided.trim().replace(/^sha256=/i, '');
  for (const payload of candidates) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    try {
      if (clean.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) {
        return { ok: true };
      }
    } catch {
      // length mismatch or non-hex input — try the next candidate
    }
  }
  return { ok: false, reason: 'signature mismatch' };
}
