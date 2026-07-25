/**
 * GET /api/cron/delegation — the hourly chase engine for delegated tasks.
 *
 * Scans agent_tasks of type 'delegated_task' that are live (pending/in_progress/
 * blocked) and due for evaluation (scheduled_at <= now), and runs one state
 * machine pass per task: nudge for acceptance, remind before the deadline, chase
 * when overdue, escalate to the owner when the assignee goes silent.
 *
 * Runs on an hourly grid (vercel.json: "0 * * * *") — production has no
 * sub-hourly scheduler. Shares the auth/batching/skip shape of
 * /api/cron/agent-tasks. Disjoint from that cron: it only touches
 * type='delegated_task', which agent-tasks never scans.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { runDelegationPass } from '../../../../lib/server/delegation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

function resolveToken(b) {
  if (b?.telegram_bot_token_enc) {
    try { return decrypt(b.telegram_bot_token_enc); } catch {}
  }
  return AGENT_TOKEN || null;
}

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await sb.from('agent_tasks')
    .select('*')
    .eq('type', 'delegated_task')
    .in('status', ['pending', 'in_progress', 'blocked'])
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due?.length) return NextResponse.json({ ok: true, processed: 0 });

  const bizIds = [...new Set(due.map(t => t.business_id))];
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, telegram_biz_conn_id, trust_level, panic_mode, business_group_chat_id')
    .in('id', bizIds);
  const bizById = new Map((businesses || []).map(b => [b.id, b]));

  const results = [];
  for (const task of due) {
    const business = bizById.get(task.business_id);
    if (!business) { results.push({ id: task.id, skipped: 'no_business' }); continue; }
    if (business.panic_mode) { results.push({ id: task.id, skipped: 'panic_mode' }); continue; }
    const token = resolveToken(business);
    if (!token) { results.push({ id: task.id, skipped: 'no_token' }); continue; }
    try {
      const r = await runDelegationPass({ sb, token, business, task });
      results.push(r);
    } catch (e) {
      console.warn('[cron/delegation] task failed', task.id, e.message);
      results.push({ id: task.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
