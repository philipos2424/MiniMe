/**
 * Self-healing guardian for the SHARED @MiniMeAgentBot webhook.
 *
 * The shared bot (TELEGRAM_BOT_TOKEN) powers BOTH shared mode AND every
 * Secretary connection. If its Telegram webhook ever drifts — pointed at the
 * wrong URL, or missing the business_* update types — the whole platform goes
 * silent. The daily cron is a backstop, but on the Hobby plan crons only run
 * once a day, which is far too slow for "always on".
 *
 * So we also verify-and-repair opportunistically from inside the live webhook
 * handlers. Every inbound update is a chance to confirm the shared bot is
 * correctly registered. The check is throttled (per warm serverless instance)
 * so it costs one extra Telegram round-trip every ~15 minutes at most; the
 * overwhelming majority of calls just compare a timestamp and return instantly.
 *
 * Placed in both entry points:
 *   • /api/agent-bot/webhook        — catches allowed_updates drift (the bot is
 *                                      still receiving `message` updates here).
 *   • /api/telegram/webhook/[secret] — acts as a canary: custom-bot traffic
 *                                      keeps flowing even if the shared bot's
 *                                      URL is broken, so it can heal it.
 */
import { allowedUpdates } from './telegramConfig';

// Per warm-instance throttle. A cold start resets it to 0, which just means the
// next request re-verifies — cheap and harmless.
let _lastCheckMs = 0;
let _inFlight = null;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function baseUrl() {
  return (process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '')
    .trim()
    .replace(/\/$/, '');
}

/**
 * Verify the shared bot's webhook and repair it if it has drifted.
 * Safe to call on every request — it self-throttles and de-dupes concurrent
 * callers. Never throws.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - bypass the throttle (used by the cron).
 * @returns {Promise<{skipped?:boolean, ok?:boolean, healed?:boolean, was?:string, error?:string}>}
 */
export async function ensureSharedWebhook({ force = false } = {}) {
  const now = Date.now();
  if (!force) {
    if (now - _lastCheckMs < INTERVAL_MS) return { skipped: true };
    if (_inFlight) return _inFlight; // collapse concurrent checks
  }
  _lastCheckMs = now;

  const run = (async () => {
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const secret = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
    const base = baseUrl();
    if (!token || !base) return { skipped: true };
    const expectedUrl = `${base}/api/agent-bot/webhook`;
    try {
      const info = await (await fetch(
        `https://api.telegram.org/bot${token}/getWebhookInfo`,
        { signal: AbortSignal.timeout(6000) },
      )).json();
      const cur = info.result || {};
      const au = cur.allowed_updates || [];
      // Telegram returns an EMPTY allowed_updates when ALL types are enabled,
      // so [] counts as "business updates allowed".
      const businessOk = au.length === 0
        || (au.includes('business_message') && au.includes('business_connection'));
      if (cur.url === expectedUrl && businessOk) return { ok: true };

      // Drifted — repair.
      const body = {
        url: expectedUrl,
        allowed_updates: allowedUpdates(),
        max_connections: 40,
        drop_pending_updates: false, // never drop — would lose live messages
      };
      if (secret) body.secret_token = secret;
      const res = await (await fetch(
        `https://api.telegram.org/bot${token}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(6000),
        },
      )).json();
      if (res.ok) {
        console.warn(`[sharedWebhookGuard] healed shared webhook: was url=${cur.url || 'none'} updates=[${au.join(',')}] → ${expectedUrl}`);
        return { healed: true, was: cur.url };
      }
      return { error: res.description || 'setWebhook failed' };
    } catch (e) {
      return { error: e.message };
    } finally {
      _inFlight = null;
    }
  })();

  _inFlight = run;
  return run;
}
