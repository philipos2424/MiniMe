/**
 * Netlify's stand-in for the "crons" block of vercel.json.
 *
 * Wakes every 30 minutes and calls each /api/cron/* route that is due at that
 * tick (src/lib/cronSchedule.mjs), with the same CRON_SECRET bearer the routes
 * already require. Netlify only fires scheduled functions on the published
 * production deploy, so previews never run crons.
 *
 * This must answer FAST. Netlify's scheduler waits about 15 seconds for a
 * scheduled function and then calls it again, up to three times. The first
 * version waited 25s for the routes, so any tick with one slow route ran
 * every cron due at that tick three times over. Now it fires the requests,
 * waits a few seconds for whatever answers quickly, and returns; a route keeps
 * running after its caller hangs up (it has 60 seconds of its own). A repeat
 * of a tick this instance already handled is ignored as well.
 *
 * Only ONE host may run the crons. If the app is also live on Vercel, set
 * CRON_DISPATCH_DISABLED=1 here, or every briefing and reminder goes out twice.
 */
import { pathsDueAt, tickFor } from '../../src/lib/cronSchedule.mjs';

// Well under the scheduler's ~15s patience, with room for a cold start.
const WAIT_MS = 6_000;

// The last tick this warm instance dispatched: a retry of the same tick lands
// on the same instance seconds later and must not fire the routes again.
let lastTickDispatched = null;

export default async (_req, context) => {
  if (process.env.CRON_DISPATCH_DISABLED === '1') {
    console.log('[cron-dispatch] disabled by CRON_DISPATCH_DISABLED');
    return new Response('disabled');
  }
  const base = (process.env.WEB_URL || context?.site?.url || process.env.URL || '').trim()
    .replace(/^http:\/\//, 'https://').replace(/\/$/, '');
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!base || !secret) {
    console.error(`[cron-dispatch] cannot run: ${!base ? 'no WEB_URL/URL' : 'no CRON_SECRET'}`);
    return new Response('not configured', { status: 500 });
  }

  const tick = tickFor(new Date());
  if (lastTickDispatched === tick.getTime()) {
    console.log(`[cron-dispatch] ${tick.toISOString()} already dispatched, ignoring the repeat`);
    return new Response('already dispatched');
  }
  lastTickDispatched = tick.getTime();
  const paths = pathsDueAt(tick);
  if (!paths.length) return new Response('nothing due');

  const results = await Promise.all(paths.map(async (path) => {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(WAIT_MS),
      });
      return { path, status: res.status };
    } catch (e) {
      // A timeout here is this function giving up waiting, not the route failing.
      return { path, status: e?.name === 'TimeoutError' ? 'still running' : `error: ${e?.message || e}` };
    }
  }));

  const failed = results.filter(r => typeof r.status === 'number' ? r.status >= 300 : String(r.status).startsWith('error'));
  console.log(`[cron-dispatch] ${tick.toISOString()} ran ${results.length}: ${results.map(r => `${r.path}=${r.status}`).join(' ')}`);
  if (failed.length) console.error(`[cron-dispatch] ${failed.length} failed: ${failed.map(r => `${r.path}=${r.status}`).join(' ')}`);
  return new Response(JSON.stringify({ tick: tick.toISOString(), results }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const config = {
  // Every half hour, UTC — the finest grain any schedule in the table uses.
  schedule: '*/30 * * * *',
};
