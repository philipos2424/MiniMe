/**
 * GET /api/cron/agent-tasks — draft any due owner-assigned tasks.
 *
 * Scans agent_tasks of type 'owner_action' with status 'pending' whose
 * scheduled_at has passed, drafts each in the owner's voice, flips it to
 * 'awaiting_approval', and DMs the owner an Approve / Cancel preview. The actual
 * send happens only after the owner taps ✅ Send (replyEngine `task_send_<id>`).
 *
 * Registered in vercel.json (a few times a day) — so deferred tasks fire within
 * a few hours, same precision as the reminders cron.
 *
 * Disjoint from the legacy bot scheduler (apps/bot), which fires
 * status='scheduled' + type IN (reminder/followup/scheduled_message/briefing).
 * Our rows are status='pending' + type='owner_action' → never double-executed.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { draftDueOwnerTask } from '../../../../lib/server/taskRunner';
import { resolveToken } from '../../../../lib/server/sendAs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// draftDueOwnerTask handles two payload shapes under the same 'owner_action'
// type: a plain scheduled preview (sent to the owner's own chat, no business
// connection needed) AND createFollowUpTask's auto-send chase path
// (taskRunner.js:143-146), which attaches business.telegram_biz_conn_id to a
// send aimed at a CUSTOMER. Business connections belong only to the shared
// @MiniMeAgentBot, so any business with Secretary Mode configured must use
// the shared token here regardless of whether it also has its own bot —
// otherwise the auto-send chase silently fails with a token/connection
// mismatch (this was a live bug: the old resolveToken() always preferred the
// tenant's own token when present).

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await sb.from('agent_tasks')
    .select('id, business_id, payload, scheduled_at, status')
    .eq('type', 'owner_action')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due?.length) return NextResponse.json({ ok: true, drafted: 0 });

  // Batch-fetch the businesses these tasks belong to.
  const bizIds = [...new Set(due.map(t => t.business_id))];
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, telegram_biz_conn_id, panic_mode')
    .in('id', bizIds);
  const bizById = new Map((businesses || []).map(b => [b.id, b]));

  const results = [];
  for (const task of due) {
    const business = bizById.get(task.business_id);
    if (!business) { results.push({ id: task.id, skipped: 'no_business' }); continue; }
    if (business.panic_mode) { results.push({ id: task.id, skipped: 'panic_mode' }); continue; }
    const token = resolveToken(business, { as: business.telegram_biz_conn_id ? 'owner' : 'bot' });
    if (!token) { results.push({ id: task.id, skipped: 'no_token' }); continue; }
    try {
      const r = await draftDueOwnerTask({ sb, token, business, task });
      results.push({ id: task.id, ...r });
    } catch (e) {
      console.warn('[cron/agent-tasks] task failed', task.id, e.message);
      results.push({ id: task.id, ok: false, error: e.message });
    }
  }

  const drafted = results.filter(r => r.ok).length;
  return NextResponse.json({ ok: true, drafted, total: due.length, results });
}
