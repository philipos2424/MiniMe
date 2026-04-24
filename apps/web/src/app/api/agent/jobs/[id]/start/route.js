/**
 * POST /api/agent/jobs/[id]/start — manually kick off a job's pipeline.
 *
 * Used for jobs created via "+ New" (no Telegram approval callback).
 * Marks job active, fires kickoffJob which briefs the first supplier.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../../../lib/server/businesses';
import { supabase } from '../../../../../../lib/server/db';
import { logEvent } from '../../../../../../lib/server/jobs';
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
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  const sb = supabase();
  const { data: job } = await sb.from('jobs').select('*')
    .eq('id', params.id).eq('business_id', business.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await sb.from('jobs').update({ status: 'active' }).eq('id', job.id);
  await logEvent(job.id, {
    kind: 'started', icon: '▶️', title: 'Job started manually',
    body: 'Owner started this job from the dashboard.', auto: false, color: 'blue',
  });

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); } catch {}
  }

  try {
    await kickoffJob({ token, jobId: job.id });
  } catch (e) {
    await logEvent(job.id, {
      kind: 'error', icon: '⚠️', title: 'Kickoff failed',
      body: e.message || 'unknown', auto: true, color: 'red',
    });
  }

  return NextResponse.json({ ok: true });
}
