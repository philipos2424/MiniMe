/**
 * POST /api/agent/jobs/[id]/start — manually kick off (or re-fire) a job's pipeline.
 *
 * Works for any non-terminal status. Resets blocked/waiting steps to idle so
 * kickoffJob can re-activate them. Returns the kickoff result so the UI can
 * show the exact reason if nothing advanced.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../../../lib/server/businesses';
import { supabase } from '../../../../../../lib/server/db';
import { logEvent, findJobById } from '../../../../../../lib/server/jobs';
import { kickoffJob } from '../../../../../../lib/server/jobFanout';
import { decrypt } from '../../../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no business for this user' }, { status: 404 });

  const job = await findJobById(params.id);
  if (!job) return NextResponse.json({ error: `job ${params.id} not found` }, { status: 404 });
  if (job.business_id !== business.id) {
    return NextResponse.json({ error: 'job belongs to a different business' }, { status: 403 });
  }

  const sb = supabase();

  // Reset blocked/waiting steps back to idle so kickoffJob re-activates them.
  await sb.from('job_steps').update({ status: 'idle', started_at: null })
    .eq('job_id', job.id)
    .in('status', ['blocked', 'waiting']);

  await sb.from('jobs').update({ status: 'active', current_step: 0 }).eq('id', job.id);
  await logEvent(job.id, {
    kind: 'started', icon: '▶️', title: 'Pipeline re-fired',
    body: 'Owner triggered brief-the-team from the dashboard.', auto: false, color: 'blue',
  });

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); } catch {}
  }

  let kickResult = null;
  try {
    kickResult = await kickoffJob({ token, jobId: job.id });
  } catch (e) {
    console.error('kickoffJob failed:', e);
    await logEvent(job.id, {
      kind: 'error', icon: '⚠️', title: 'Kickoff failed',
      body: e.message || 'unknown', auto: true, color: 'red',
    });
    return NextResponse.json({ ok: false, error: e.message || 'kickoff failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: kickResult });
}
