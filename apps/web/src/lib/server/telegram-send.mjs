/**
 * Flood-safe Telegram sendMessage for broadcast loops.
 *
 * Two failure modes get bots banned/limited and were previously treated as
 * plain "failed" while the loop kept firing:
 *  - 429 flood-wait: Telegram tells us exactly how long to back off
 *    (`parameters.retry_after`). Ignoring it repeatedly is the classic path
 *    to a bot limitation.
 *  - 403 "bot was blocked by the user" (and friends): re-messaging people who
 *    blocked the bot on every future broadcast is a strong spam signal, and
 *    under GDPR their block IS a consent withdrawal — callers must persist an
 *    opt-out for `blocked: true` results.
 *
 * Dependency-free (fetch + sleep injectable) so tests/telegram-send.test.mjs
 * can run it under plain `node --test`.
 */

const MAX_RETRY_AFTER_S = 60; // don't let one bad response stall a request-scoped loop for minutes

const BLOCKED_PATTERNS = [
  'bot was blocked by the user',
  'user is deactivated',
  'chat not found',
  'bot can\'t initiate conversation',
  'user not found',
];

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Send one message, honoring a single 429 retry_after backoff.
 * Returns { ok, status, description, blocked, retryAfterHit }.
 */
export async function sendTelegramMessage(token, payload, { fetchImpl = fetch, sleep = defaultSleep, timeoutMs = 8000 } = {}) {
  let retryAfterHit = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res, body;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, status: 0, description: e.message || 'network error', blocked: false, retryAfterHit };
    }

    if (res.ok) return { ok: true, status: res.status, description: null, blocked: false, retryAfterHit };

    const description = (body?.description || '').toLowerCase();
    const blocked = BLOCKED_PATTERNS.some(p => description.includes(p));
    if (blocked) return { ok: false, status: res.status, description: body?.description || null, blocked: true, retryAfterHit };

    if (res.status === 429 && attempt === 0) {
      retryAfterHit = true;
      const waitS = Math.min(Number(body?.parameters?.retry_after) || 1, MAX_RETRY_AFTER_S);
      await sleep(waitS * 1000);
      continue; // retry once after honoring the flood wait
    }

    return { ok: false, status: res.status, description: body?.description || null, blocked: false, retryAfterHit };
  }
  // Unreachable, but keep the contract if the loop ever changes.
  return { ok: false, status: 429, description: 'flood wait persisted', blocked: false, retryAfterHit: true };
}

/**
 * Circuit breaker for broadcast loops: call `hit429()` after every send that
 * ended in a flood wait, `okSend()` after a clean one. `tripped` goes true
 * after `threshold` consecutive flood waits — the loop must then abort the
 * remaining recipients (better to under-send than get the bot limited).
 */
export function floodBreaker(threshold = 3) {
  let consecutive = 0;
  return {
    hit429() { consecutive++; },
    okSend() { consecutive = 0; },
    get tripped() { return consecutive >= threshold; },
  };
}
