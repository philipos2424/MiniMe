import OpenAI from 'openai';

/**
 * One place to configure every OpenAI client in apps/web.
 *
 * Why this exists: the OpenAI SDK defaults to a 10-minute request timeout. On a
 * serverless function (our Telegram webhook + cron routes) a single hung model
 * call would otherwise hold the invocation open until the platform kills it,
 * taking down replies AND the learning writes that ride on the same request.
 * A bounded timeout makes a stuck call fail fast and predictably.
 *
 * `maxRetries: 2` matches the SDK default (exponential backoff on 408/409/429/5xx)
 * but is set explicitly here so the retry policy is documented in one spot.
 *
 * Pass `opts` to override per-call site (e.g. a shorter timeout on a path that
 * must return inside the function limit).
 */
export function makeOpenAI(opts = {}) {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder',
    timeout: 60_000,   // 60s per attempt (was SDK default: 10 min)
    maxRetries: 2,     // explicit; matches SDK default, documents intent
    ...opts,
  });
}
