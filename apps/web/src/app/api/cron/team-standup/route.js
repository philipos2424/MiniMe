/**
 * GET /api/cron/team-standup — end-of-day team report to the owner.
 *
 * At 6pm EAT (15:00 UTC) sends each opted-in owner a rollup of their delegated
 * tasks grouped by outcome: done today, overdue, silent, blocked, in progress.
 * "Silent" — assigned long enough ago that acceptance should have landed and
 * didn't — is what makes this a management report rather than a status list;
 * blocked lines carry the reason so the owner can act without asking. Opt-in
 * flag: notification_prefs.team_standup.enabled (mirrors morning_summary).
 * Posted to the business's team group when one is configured
 * (business_group_chat_id), so the whole team sees it — falls back to the
 * owner's DM when there's no group.
 *
 * Registered in vercel.json ("0 15 * * *").
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { bucketStandupTasks, needsChasing } from '../../../../lib/server/delegationLogic.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const EAT = 3 * 60 * 60 * 1000;

function fmtDue(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const now = Date.now();
  const startOfDayEAT = new Date(now + EAT); startOfDayEAT.setUTCHours(0, 0, 0, 0);
  const startOfDayUTC = new Date(startOfDayEAT.getTime() - EAT).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, notification_prefs, panic_mode, business_group_chat_id')
    .not('owner_telegram_id', 'is', null);

  const sent = [];

  for (const b of businesses || []) {
    if (b.panic_mode) continue;
    if (!b.notification_prefs?.team_standup?.enabled) continue;

    let token = AGENT_TOKEN;
    if (b.telegram_bot_token_enc) {
      try { token = decrypt(b.telegram_bot_token_enc); } catch { continue; }
    }
    const chatId = b.business_group_chat_id || b.owner_private_chat_id || b.owner_telegram_id;
    if (!chatId || !token) continue;

    try {
      const [{ data: doneToday }, { data: live }] = await Promise.all([
        sb.from('agent_tasks')
          .select('title, supplier_name')
          .eq('business_id', b.id).eq('type', 'delegated_task').eq('status', 'completed')
          .gte('completed_at', startOfDayUTC),
        sb.from('agent_tasks')
          .select('title, supplier_name, status, due_at, assigned_at, accepted_at, chase_count, blocked_reason')
          .eq('business_id', b.id).eq('type', 'delegated_task')
          .in('status', ['pending', 'in_progress', 'blocked']),
      ]);

      const done = doneToday || [];
      const { blocked, overdue, silent, inProgress } = bucketStandupTasks(live, now);

      // Nothing to report → stay silent.
      if (!done.length && !inProgress.length && !blocked.length && !overdue.length && !silent.length) continue;

      const lines = [`📊 *End of day — ${b.name}*`, ''];
      const who = (t) => t.supplier_name ? ` — ${t.supplier_name}` : '';
      const section = (icon, label, rows, detail) => {
        if (!rows.length) return;
        lines.push(`${icon} *${label} (${rows.length}):*`);
        for (const t of rows.slice(0, 10)) lines.push(`• ${t.title}${who(t)}${detail ? detail(t) : ''}`);
        if (rows.length > 10) lines.push(`_…and ${rows.length - 10} more_`);
        lines.push('');
      };

      // Ordered by how much each bucket needs the owner, most urgent first —
      // the report is read on a phone and the top of it has to be the part
      // worth acting on tonight.
      section('✅', 'Done today', done);
      section('🚨', 'Overdue', overdue, (t) => ` · due ${fmtDue(t.due_at)}`);
      section('⛔', 'Blocked', blocked, (t) => t.blocked_reason ? ` · ${String(t.blocked_reason).slice(0, 80)}` : '');
      section('🤐', 'No word yet', silent, (t) => {
        const since = Math.floor((now - Date.parse(t.assigned_at)) / 3600000);
        const chased = t.chase_count > 0 ? `, chased ${t.chase_count}×` : '';
        return ` · assigned ${since}h ago${chased}, not confirmed`;
      });
      section('⏳', 'In progress', inProgress);

      // Closing line, only when it's true: who is costing the most chasing.
      // chase_count is incremented by the delegation cron and, until now, read
      // by nothing — it is the clearest per-person signal the loop produces.
      const chasing = needsChasing(live);
      if (chasing.length) {
        lines.push(`🐢 *Needed chasing:* ${chasing.slice(0, 4).map(c => `${c.name} (${c.chases}×)`).join(', ')}`);
      }

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n').trim(), parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(8000),
      });

      sent.push({ business: b.name, done: done.length, overdue: overdue.length, blocked: blocked.length, silent: silent.length });
    } catch (e) {
      console.warn('[team-standup] failed for', b.name, e.message);
    }
  }

  return NextResponse.json({ ok: true, sent_count: sent.length, sent });
}
