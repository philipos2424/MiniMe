/**
 * Platform health as failure rates — one definition shared by Insights, Pulse
 * and the Platform health tab (pure; no I/O).
 *
 * The tabs disagreed: Pulse said "normal" while Insights said the AI chain was
 * failing on 18.9% of calls, because Pulse only alarmed above 25% while
 * Insights alarmed at 10%. Platform
 * health showed "OK" for anything that merely ran (Order pipeline OK at 0
 * orders). Everything here reports a rate and a sample size, and calls a
 * check unknown rather than OK when there's too little data to say.
 */
import { isChainCall, STALE_AFTER_HOURS } from './definitions.mjs';

const DAY_MS = 86400000;
const round1 = n => Math.round(n * 10) / 10;

/** Alert when this share (%) of AI reply chains fail on every provider. */
export const AI_FAIL_ALERT_PCT = 10;
/** Alert when this share (%) of outbound Telegram sends fail. */
export const DELIVERY_FAIL_ALERT_PCT = 5;
/** Alert when webhook deliveries succeed less often than this (%). */
export const WEBHOOK_OK_MIN_PCT = 90;
/** Below this many events a rate is inconclusive, not OK. */
export const MIN_SAMPLE = 10;

export function rate(failed, total) {
  return total > 0 ? round1((100 * failed) / total) : null;
}

/** 'ok' | 'fail' | 'unknown' for a failure-rate check. */
export function verdict(failPct, total, alertPct) {
  if (failPct == null || total < MIN_SAMPLE) return 'unknown';
  return failPct >= alertPct ? 'fail' : 'ok';
}

/** AI and delivery failure rates over the last 24h, external shops only for delivery. */
export function failureRates24h({ now = Date.now(), extIds = null, recentMessages = [], llmRecent = [] }) {
  const ago24 = now - DAY_MS;
  const out24 = recentMessages.filter(m =>
    m.direction === 'outbound' && Date.parse(m.created_at) >= ago24 && (!extIds || extIds.has(m.business_id)));
  const failed24 = out24.filter(m => m.status === 'failed').length;
  const chain24 = llmRecent.filter(l => isChainCall(l) && Date.parse(l.created_at) >= ago24);
  const llmFailed = chain24.filter(l => l.ok === false).length;
  return {
    llm_calls_24h: chain24.length,
    llm_failed_24h: llmFailed,
    llm_fail_pct_24h: rate(llmFailed, chain24.length),
    sends_24h: out24.length,
    sends_failed_24h: failed24,
    delivery_fail_pct_24h: rate(failed24, out24.length),
  };
}

/** The checks shown on Platform health. */
export function platformHealth({ now = Date.now(), extIds = null, recentMessages = [], llmRecent = [], webhooks = [], runs = [] }) {
  const r = failureRates24h({ now, extIds, recentMessages, llmRecent });
  const hookOk = webhooks.filter(w => w.delivery_status === 'success').length;
  const hookFailPct = rate(webhooks.length - hookOk, webhooks.length);
  const lastOk = runs.find(x => x.ok && x.finished_at);
  const ageH = lastOk ? round1((now - Date.parse(lastOk.finished_at)) / 3600000) : null;
  const lastFailed = runs[0] ? runs[0].ok === false : false;

  return [
    {
      key: 'ai', name: 'AI replies',
      status: verdict(r.llm_fail_pct_24h, r.llm_calls_24h, AI_FAIL_ALERT_PCT),
      note: r.llm_calls_24h
        ? `${r.llm_fail_pct_24h}% failed on every provider (${r.llm_failed_24h}/${r.llm_calls_24h}) in 24h · alert at ${AI_FAIL_ALERT_PCT}%`
        : 'No AI replies in 24h',
    },
    {
      key: 'delivery', name: 'Message delivery',
      status: verdict(r.delivery_fail_pct_24h, r.sends_24h, DELIVERY_FAIL_ALERT_PCT),
      note: r.sends_24h
        ? `${r.delivery_fail_pct_24h}% of sends failed (${r.sends_failed_24h}/${r.sends_24h}) in 24h · alert at ${DELIVERY_FAIL_ALERT_PCT}%`
        : 'No outbound messages in 24h',
    },
    {
      key: 'webhooks', name: 'Webhook delivery',
      status: verdict(hookFailPct, webhooks.length, 100 - WEBHOOK_OK_MIN_PCT),
      note: webhooks.length
        ? `${round1(100 - hookFailPct)}% delivered (${hookOk}/${webhooks.length}) in 24h · alert below ${WEBHOOK_OK_MIN_PCT}%`
        : 'No webhook events in 24h',
    },
    {
      key: 'rollup', name: 'Metrics job (nightly)',
      // The only cron with a run log; the others only show that something ran.
      status: lastFailed || ageH == null || ageH > STALE_AFTER_HOURS ? 'fail' : 'ok',
      note: lastOk
        ? `Last success ${ageH}h ago${lastFailed ? ' · latest run FAILED' : ''} · alert after ${STALE_AFTER_HOURS}h`
        : 'Never completed',
    },
  ];
}
