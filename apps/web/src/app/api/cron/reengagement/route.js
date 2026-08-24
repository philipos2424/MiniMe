/**
 * Stage-aware signup re-engagement.
 *
 * Replaces /api/cron/onboarding-nudges, which could only see people who
 * already had a businesses row and said the same thing to all of them. This
 * route reads the whole funnel from onboarding_events, works out where each
 * person stalled, and sends copy built from what that person actually gave us.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Dry run: `?dry_run=1` reports stage and variant per candidate, sends nothing.
 * Schedule: registered in vercel.json (17:00 UTC = 20:00 EAT).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { audit } from '../../../../lib/server/audit';
import { loadCandidates, DEFAULT_CAP } from '../../../../lib/server/reengage/audience';
import { buildFacts } from '../../../../lib/server/reengage/artifacts';
import { sendReengagement } from '../../../../lib/server/reengage/send';
import { resolveOutcomes } from '../../../../lib/server/reengage/outcomes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();

  let candidates;
  try {
    candidates = await loadCandidates({ now, cap: DEFAULT_CAP });
  } catch (e) {
    console.error('[cron/reengagement] audience load failed:', e.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const summary = { eligible: candidates.length, sent: 0, failed: 0, cap: DEFAULT_CAP, dry_run: dryRun, by_stage: {} };
  for (const c of candidates) summary.by_stage[c.stage] = (summary.by_stage[c.stage] || 0) + 1;

  if (dryRun) {
    summary.sample = candidates.slice(0, 10).map(c => ({
      telegram_id: c.telegramId,
      stage: c.stage,
      variant: c.variant,
      is_final: c.decision.isFinal,
      stalled_at: c.stalledAt,
      shop: c.business?.name || null,
    }));
    return NextResponse.json({ ok: true, ...summary });
  }

  for (const c of candidates) {
    try {
      const facts = await buildFacts({ stage: c.stage, business: c.business, telegramId: c.telegramId });
      const r = await sendReengagement({ token, candidate: c, facts });
      if (r.ok) summary.sent++; else summary.failed++;
    } catch (e) {
      // One bad recipient must never take down the run.
      summary.failed++;
      console.warn(`[cron/reengagement] ${c.telegramId} errored:`, e.message);
    }
    await sleep(60); // stay under Telegram's rate limit
  }

  // Resolve last week's sends before reporting — cheap, and it is the only
  // thing that turns the attribution table into an answer.
  if (!dryRun) {
    try {
      summary.outcomes = await resolveOutcomes({ now });
    } catch (e) {
      console.warn('[cron/reengagement] outcome sweep failed:', e.message);
    }
  }

  console.log('[cron/reengagement]', JSON.stringify(summary));

  if (summary.sent || summary.failed) {
    await audit({
      business_id: null,
      actor_type: 'system',
      actor_id: 'cron',
      action: 'reengagement.run',
      resource_type: 'cron',
      resource_id: null,
      metadata: summary,
      request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
