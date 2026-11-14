/**
 * What the hosting platform allows one request, and how to live inside it.
 *
 * Vercel lets a route run up to its maxDuration (300s here). Netlify stops
 * every request at 60 seconds, no setting changes that. Telegram then retries
 * the update, the retry is skipped as a duplicate (webhook_dedupe), and the
 * customer never hears back — so on Netlify the app has to finish, or say it
 * couldn't, before the platform cuts it off.
 *
 * MINIME_HOST is set at build time by next.config.js.
 */
export function hostName(env) {
  // Tests pass an env. The real read must spell out process.env.MINIME_HOST:
  // the build replaces that exact expression, and Netlify does not set NETLIFY
  // at runtime, so going through a variable would lose it.
  if (env) return env.MINIME_HOST || (env.VERCEL ? 'vercel' : env.NETLIFY ? 'netlify' : 'node');
  return process.env.MINIME_HOST || (process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'node');
}

/** Longest a single request may run on this host, in ms. */
export function requestCapMs(env) {
  return hostName(env) === 'netlify' ? 60_000 : 300_000;
}

/** True on hosts where a loopback URL (a local Ollama) points at nothing. */
export function isServerless(env) {
  return hostName(env) !== 'node';
}

/**
 * Per-attempt time and retries for each LLM provider. On a 60s host one slow
 * provider must not eat the whole request: each gets a single short attempt so
 * the fallback chain (Gemini, then Groq, then OpenAI) still fits.
 */
export function llmLimits(env) {
  if (requestCapMs(env) <= 60_000) {
    return {
      openai: { timeout: 20_000, maxRetries: 0 },
      gemini: { timeout: 20_000, maxRetries: 0 },
      groq: { timeout: 15_000, maxRetries: 0 },
      ollama: { timeout: 20_000, maxRetries: 0 },
    };
  }
  return {
    openai: { timeout: 45_000, maxRetries: 1 },
    gemini: { timeout: 45_000, maxRetries: 1 },
    groq: { timeout: 30_000, maxRetries: 1 },
    ollama: { timeout: 60_000, maxRetries: 0 },
  };
}

/**
 * How long a webhook handler may work before it must stop and tell the owner,
 * or null when the host gives it room (no watchdog needed). Leaves 10s for the
 * route's own setup and for the heads-up message to go out.
 */
export function replyDeadlineMs(env) {
  const cap = requestCapMs(env);
  return cap <= 60_000 ? cap - 10_000 : null;
}

/**
 * Run `work`, but stop waiting after `ms`. Resolves { timedOut: false, value }
 * or { timedOut: true }. The work is not cancelled — the caller decides what
 * to tell people. A rejection from `work` propagates as usual.
 */
export async function raceDeadline(work, ms) {
  if (!ms) return { timedOut: false, value: await work };
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  try {
    return await Promise.race([Promise.resolve(work).then(value => ({ timedOut: false, value })), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Who and what an update was, for the "I ran out of time" note. */
export function describeUpdate(update) {
  const msg = update?.message || update?.business_message || update?.edited_message || update?.edited_business_message;
  if (!msg) return null;
  const from = msg.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || (from.username ? `@${from.username}` : 'A customer');
  const text = msg.text || msg.caption || (msg.photo ? '[photo]' : msg.voice ? '[voice message]' : msg.document ? '[file]' : '[message]');
  return { name, fromId: from.id ?? null, text: String(text).slice(0, 300) };
}

/** The owner-facing line when a reply could not be finished in time. */
export function timedOutText({ name, text }, { fromOwner = false } = {}) {
  return fromOwner
    ? `⏱ That took too long and I had to stop. Please send it again.\n\n"${text}"`
    : `⏱ I ran out of time answering ${name} and may not have replied.\n\n"${text}"\n\nPlease check that chat.`;
}
