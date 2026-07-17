/**
 * nango.js — thin wrapper around the Nango cloud REST API.
 *
 * Nango holds and refreshes the Meta OAuth credentials; we reference them by
 * connection ID and let the Proxy inject fresh tokens into Graph API calls.
 *
 * Env:
 *   NANGO_SECRET_KEY            — server secret key (per environment)
 *   NANGO_HOST                  — optional, defaults to https://api.nango.dev
 *   NANGO_INTEGRATION_FACEBOOK  — integration ID (provider config key), default 'facebook'
 *   NANGO_INTEGRATION_INSTAGRAM — default 'instagram'
 *   NANGO_INTEGRATION_WHATSAPP  — default 'whatsapp-business'
 */
import crypto from 'crypto';

const HOST = () => (process.env.NANGO_HOST || 'https://api.nango.dev').replace(/\/$/, '');
const SECRET = () => process.env.NANGO_SECRET_KEY;

export const NANGO_INTEGRATIONS = {
  facebook: process.env.NANGO_INTEGRATION_FACEBOOK || 'facebook',
  instagram: process.env.NANGO_INTEGRATION_INSTAGRAM || 'instagram',
  whatsapp: process.env.NANGO_INTEGRATION_WHATSAPP || 'whatsapp-business',
};

/** integration ID (provider config key) → our platform name, or null */
export function platformForIntegration(providerConfigKey) {
  for (const [platform, key] of Object.entries(NANGO_INTEGRATIONS)) {
    if (key === providerConfigKey) return platform;
  }
  return null;
}

export function nangoConfigured() {
  return !!SECRET();
}

async function nangoFetch(path, { method = 'GET', headers = {}, body, timeout = 15000 } = {}) {
  const r = await fetch(`${HOST()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || `Nango API error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return j;
}

/**
 * Create a Connect UI session token for a business.
 * platforms: array of 'facebook' | 'instagram' | 'whatsapp'
 */
export async function createSessionToken(business, platforms) {
  const allowed = (platforms || Object.keys(NANGO_INTEGRATIONS))
    .map(p => NANGO_INTEGRATIONS[p])
    .filter(Boolean);
  // `tags` are copied onto the connection and echoed back in auth webhooks —
  // this is how we recover which business authorized (end_user_id) and, when a
  // single platform was requested, which channel (so we don't depend on the
  // webhook echoing providerConfigKey).
  const list = platforms || Object.keys(NANGO_INTEGRATIONS);
  const j = await nangoFetch('/connect/sessions', {
    method: 'POST',
    body: {
      tags: {
        end_user_id: String(business.id),
        ...(list.length === 1 ? { platform: list[0] } : {}),
        ...(business.name ? { business_name: business.name } : {}),
      },
      allowed_integrations: allowed,
    },
  });
  return j?.data?.token || null;
}

/**
 * Call the Meta Graph API through the Nango proxy with the connection's token.
 * endpoint is Graph-relative, e.g. '/me/accounts' or `/${pageId}/messages`.
 */
export async function nangoProxy({ method = 'GET', endpoint, integration, connectionId, params, data, timeout = 15000 }) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const r = await fetch(`${HOST()}/proxy${endpoint}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET()}`,
      'Provider-Config-Key': integration,
      'Connection-Id': connectionId,
      'Content-Type': 'application/json',
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || j?.message || `Proxy error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return j;
}

/** Delete a connection in Nango (used when a business disconnects a channel). */
export async function deleteConnection({ integration, connectionId }) {
  await nangoFetch(`/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(integration)}`, {
    method: 'DELETE',
  });
}

/**
 * Verify Nango's X-Nango-Signature header on webhooks from Nango.
 * Signature = hex(sha256(secretKey + rawBody)).
 */
export function verifyNangoWebhook(request, rawBody) {
  const secret = SECRET();
  if (!secret) return false;
  const sig = request.headers.get('x-nango-signature');
  if (!sig) return false;
  const expected = crypto.createHash('sha256').update(secret + rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
