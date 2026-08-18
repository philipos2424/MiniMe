/**
 * GET /api/cron/weekly-reengagement-digest — Monday DM to platform admins.
 *
 * The re-engagement numbers live in the admin dashboard tab, but nobody opens
 * a dashboard on a schedule — so copy problems (a stage nobody answers, an
 * exit reason dominating, an A/B arm collapsing) surface only by accident.
 * This sends the same rollup as the admin view (same summary.mjs aggregation,
 * last 7 days) straight to every ADMIN_TELEGRAM_IDS admin on Monday morning.
 *
 * Quiet by design: weeks with no sends produce no message, so the digest is a
 * signal, not a subscription.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: registered in vercel.json (Monday 06:00 UTC = 09:00 Addis).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { aggregateSends, STAGE_LABELS } from '../../../../lib/server/reengage/summary.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A stage below this reply rate with meaningful volume is the "copy isn't
// landing" signal the digest exists to surface.
const WEAK_REPLY_PCT = 10;
const WEAK_MIN_SENDS = 3;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = getAdminIds();
  if (!token) return NextResponse.json({ ok: false, error: 'no_bot_token' }, { status: 500 });
  if (!adminIds.length) return NextResponse.json({ ok: false, error: 'no_admins' }, { status: 500 });

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: rows, error } = await fetchAllRows(() => supabase()
    .from('reengagement_sends')
    .select('id, telegram_id, business_id, stage, variant, sent_at, replied_at, exit_reason, outcome')
    .gte('sent_at', since)
    .order('sent_at', { ascending: false }));
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { totals, by_stage, by_variant, exit_reasons } = aggregateSends(rows || [], { days: 7, recentCount: 0 });
  if (!totals.sent) {
    return NextResponse.json({ ok: true, skipped: 'no_sends', since });
  }

  const lines = [];
  lines.push(`📨 <b>Re-engagement — week in review</b>`);
  lines.push(`<i>${totals.sent} nudges · ${totals.replied} replied · ${totals.reply_rate}% reply rate</i>`);
  lines.push('');

  const active = by_stage.filter(s => s.sent > 0);
  if (active.length) {
    lines.push('📊 <b>By stage</b>');
    for (const s of active) {
      const flag = s.sent >= WEAK_MIN_SENDS && s.reply_rate < WEAK_REPLY_PCT ? ' ⚠️' : '';
      lines.push(`• <b>${s.stage}</b> ${s.label}: ${s.sent} sent, ${s.replied} replied (${s.reply_rate}%)${flag}`);
    }
    const weak = active.filter(s => s.sent >= WEAK_MIN_SENDS && s.reply_rate < WEAK_REPLY_PCT);
    if (weak.length) {
      lines.push('');
      lines.push(`⚠️ <i>${weak.map(s => s.stage).join(', ')} under ${WEAK_REPLY_PCT}% reply — the copy or the ask isn't landing there.</i>`);
    }
    lines.push('');
  }

  lines.push('🧪 <b>Copy A/B (A1/B1)</b>');
  for (const v of by_variant) {
    lines.push(`• ${v.variant}: ${v.replied}/${v.sent} replied (${v.reply_rate}%)`);
  }

  if (exit_reasons.length) {
    lines.push('');
    lines.push('🚪 <b>Why they said they stopped</b>');
    for (const r of exit_reasons) {
      lines.push(`• ${r.label}: ${r.count}`);
    }
  }

  lines.push('');
  const o = totals.outcomes;
  const resolved = o.completed + o.advanced + o.no_change;
  if (resolved > 0) {
    lines.push(`✅ <b>Outcomes</b>: ${o.completed} went live · ${o.advanced} advanced · ${o.no_change} no change`);
  } else {
    lines.push(`⏳ Outcomes pending — the weekly sweep resolves last week's sends (${totals.sent} this week).`);
  }

  const web = process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (web) lines.push(`<a href="${web}/admin">Open the dashboard</a>`);

  const text = lines.join('\n');
  let sent = 0;
  for (const id of adminIds) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(7000),
      });
      if (r.ok) sent++;
      else console.warn(`[weekly-reengagement-digest] send to ${id} failed: ${r.status}`);
    } catch (e) {
      // One admin with a blocked bot must not stop the others.
      console.warn(`[weekly-reengagement-digest] send to ${id} failed:`, e.message);
    }
  }

  return NextResponse.json({ ok: true, sent, totals: { sent: totals.sent, replied: totals.replied, reply_rate: totals.reply_rate } });
}
