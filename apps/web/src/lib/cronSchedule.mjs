/**
 * The cron table, and the matching the Netlify scheduler needs to run it.
 *
 * Vercel reads schedules from the "crons" block of apps/web/vercel.json. Netlify
 * has no equivalent for Next.js routes, so one scheduled function
 * (netlify/functions/cron-dispatch.mjs) wakes every 30 minutes and calls
 * whichever routes are due. This file is that function's table.
 *
 * CRON_JOBS must stay equal to vercel.json's "crons" (cronSchedule.test.mjs
 * fails when they drift). SUB_DAILY_JOBS are the two that Vercel Hobby can't
 * schedule (it only allows daily crons); on Vercel they run from GitHub
 * Actions instead, on Netlify they run from the same dispatcher as the rest.
 *
 * Every schedule is UTC and lands on minute 0 or 30 — the dispatcher's tick.
 */
export const CRON_JOBS = [
  { path: '/api/cron/healthcheck', schedule: '0 9 * * *' },
  { path: '/api/cron/followups', schedule: '0 6 * * *' },
  { path: '/api/cron/auto-learn', schedule: '0 3 * * *' },
  { path: '/api/cron/metrics-rollup', schedule: '0 23 * * *' },
  { path: '/api/cron/weekly-digest', schedule: '0 5 * * 1' },
  { path: '/api/cron/reminders', schedule: '0 7 * * *' },
  { path: '/api/cron/llm-stats', schedule: '0 6 * * *' },
  { path: '/api/cron/self-improve', schedule: '0 4 * * 1' },
  { path: '/api/cron/morning-briefing', schedule: '0 5 * * *' },
  { path: '/api/cron/secretary-recap', schedule: '30 16 * * *' },
  { path: '/api/cron/birthdays', schedule: '0 4 * * *' },
  { path: '/api/cron/data-retention', schedule: '0 3 * * 0' },
  { path: '/api/cron/b2b-expire', schedule: '0 2 * * *' },
  { path: '/api/cron/research-timeout', schedule: '0 1 * * *' },
  { path: '/api/cron/b2b-follow-up', schedule: '0 10 * * *' },
  { path: '/api/cron/extract-owner-facts', schedule: '30 2 * * *' },
  { path: '/api/cron/backfill-embeddings', schedule: '30 3 * * *' },
  { path: '/api/cron/notify-waitlist', schedule: '0 8 * * *' },
  { path: '/api/cron/review-followup', schedule: '0 9 * * *' },
  { path: '/api/cron/scheduled-messages', schedule: '0 6 * * *' },
  { path: '/api/cron/scheduled-messages', schedule: '0 12 * * *' },
  { path: '/api/cron/scheduled-messages', schedule: '0 16 * * *' },
  { path: '/api/cron/owner-nudges', schedule: '0 8 * * *' },
  { path: '/api/cron/outreach-rules', schedule: '30 8 * * *' },
  { path: '/api/cron/agent-tasks', schedule: '0 6 * * *' },
  { path: '/api/cron/agent-tasks', schedule: '0 11 * * *' },
  { path: '/api/cron/agent-tasks', schedule: '0 15 * * *' },
  { path: '/api/cron/agent-tasks', schedule: '0 19 * * *' },
  { path: '/api/cron/agent-task-nudges', schedule: '0 9 * * *' },
  { path: '/api/cron/reengagement', schedule: '0 17 * * *' },
  { path: '/api/cron/weekly-reengagement-digest', schedule: '0 6 * * 1' },
  { path: '/api/cron/funnel-daily', schedule: '0 6 * * *' },
  { path: '/api/cron/search-engagement-nudge', schedule: '0 9 * * 1' },
  { path: '/api/cron/conversation-summaries', schedule: '0 18 * * *' },
  { path: '/api/cron/team-standup', schedule: '0 15 * * *' },
  { path: '/api/cron/payment-followups', schedule: '0 7 * * *' },
  { path: '/api/cron/payment-followups', schedule: '0 11 * * *' },
  { path: '/api/cron/payment-followups', schedule: '0 15 * * *' },
  { path: '/api/cron/payment-followups', schedule: '0 19 * * *' },
];

export const SUB_DAILY_JOBS = [
  // The delegation chase engine is built around 1-2 hour windows.
  { path: '/api/cron/delegation', schedule: '0 * * * *' },
  // Catch an outage at 2am by 4am, not at 9am from a merchant.
  { path: '/api/cron/pulse-alert', schedule: '0 */2 * * *' },
];

export const TICK_MINUTES = 30;

/** One cron field against a value: a star, "5", "1,3", "1-5", or any of those with a "/step". */
function fieldMatches(field, value, min, max) {
  return String(field).split(',').some(part => {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) return false;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) { [lo, hi] = range.split('-').map(Number); }
    else { lo = Number(range); hi = stepRaw === undefined ? lo : max; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/** Does a 5-field cron expression fire at this instant (UTC, to the minute)? */
export function cronMatches(expr, date) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dom, month, dow] = fields;
  const weekday = date.getUTCDay();
  const domOk = fieldMatches(dom, date.getUTCDate(), 1, 31);
  // 7 is Sunday too, in cron.
  const dowOk = fieldMatches(dow, weekday, 0, 7) || (weekday === 0 && fieldMatches(dow, 7, 0, 7));
  // Cron's rule: when both day fields are restricted, either one matching is enough.
  const dayOk = dom !== '*' && dow !== '*' ? (domOk || dowOk) : (domOk && dowOk);
  return fieldMatches(minute, date.getUTCMinutes(), 0, 59)
    && fieldMatches(hour, date.getUTCHours(), 0, 23)
    && fieldMatches(month, date.getUTCMonth() + 1, 1, 12)
    && dayOk;
}

/**
 * The tick a wake-up belongs to: the nearest half hour. A scheduler that fires
 * a few seconds early or a couple of minutes late still runs the right jobs.
 */
export function tickFor(now = new Date()) {
  const ms = TICK_MINUTES * 60_000;
  return new Date(Math.round(now.getTime() / ms) * ms);
}

/** Paths due at this tick, each once even when two schedules for it coincide. */
export function pathsDueAt(tick, jobs = [...CRON_JOBS, ...SUB_DAILY_JOBS]) {
  return [...new Set(jobs.filter(j => cronMatches(j.schedule, tick)).map(j => j.path))];
}
