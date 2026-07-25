/**
 * GET /api/cron/team-standup — end-of-day team report to the owner.
 *
 * At 6pm EAT (15:00 UTC) sends each opted-in owner a rollup of their delegated
 * tasks grouped by outcome: done today, in progress, blocked, overdue. Opt-in
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
          .select('title, supplier_name, status, due_at')
          .eq('business_id', b.id).eq('type', 'delegated_task')
          .in('status', ['pending', 'in_progress', 'blocked']),
      ]);

      const done = doneToday || [];
      const inProgress = (live || []).filter(t => t.status === 'in_progress' && !(t.due_at && Date.parse(t.due_at) < now));
      const blocked = (live || []).filter(t => t.status === 'blocked');
      const overdue = (live || []).filter(t => t.due_at && Date.parse(t.due_at) < now && t.status !== 'completed');

      // Nothing to report → stay silent.
      if (!done.length && !inProgress.length && !blocked.length && !overdue.length) continue;

      const lines = [`📊 *End of day — ${b.name}*`, ''];
      if (done.length) {
        lines.push(`✅ *Done today (${done.length}):*`);
        for (const t of done.slice(0, 10)) lines.push(`• ${t.title}${t.supplier_name ? ` — ${t.supplier_name}` : ''}`);
        lines.push('');
      }
      if (inProgress.length) {
        lines.push(`⏳ *In progress (${inProgress.length}):*`);
        for (const t of inProgress.slice(0, 10)) lines.push(`• ${t.title}${t.supplier_name ? ` — ${t.supplier_name}` : ''}`);
        lines.push('');
      }
      if (overdue.length) {
        lines.push(`🚨 *Overdue (${overdue.length}):*`);
        for (const t of overdue.slice(0, 10)) lines.push(`• ${t.title}${t.supplier_name ? ` — ${t.supplier_name}` : ''} · due ${fmtDue(t.due_at)}`);
        lines.push('');
      }
      if (blocked.length) {
        lines.push(`⛔ *Blocked (${blocked.length}):*`);
        for (const t of blocked.slice(0, 10)) lines.push(`• ${t.title}${t.supplier_name ? ` — ${t.supplier_name}` : ''}`);
        lines.push('');
      }

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: lines.join('\n').trim(), parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(8000),
      });

      sent.push({ business: b.name, done: done.length, overdue: overdue.length, blocked: blocked.length });
    } catch (e) {
      console.warn('[team-standup] failed for', b.name, e.message);
    }
  }

  return NextResponse.json({ ok: true, sent_count: sent.length, sent });
}
