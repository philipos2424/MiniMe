/**
 * GET /api/cron/pulse-alert — page the platform admins when the platform breaks.
 *
 * /api/admin/pulse already decides whether the platform is red (messages
 * collapsed, AI pipeline silent, webhooks failing). Until now that decision
 * only existed while somebody had the admin tab open — an outage at 2am was
 * discovered at 9am by a merchant complaining. This runs the same checks on a
 * schedule and DMs every ADMIN_TELEGRAM_IDS admin.
 *
 * Deliberately re-implements the checks against the DB rather than calling the
 * admin route: the admin route is auth-gated on a human identity, and a cron
 * with a bearer secret is not one.
 *
 * Deduped through platform_settings: an ongoing incident alerts once, then
 * stays quiet until it either clears (which sends a recovery message) or
 * RE_ALERT_HOURS elapse. An alert that fires every 15 minutes gets muted by
 * the reader, which is the same as having no alert.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATE_KEY = 'pulse_alert_state';
const RE_ALERT_HOURS = 6;
const EAT_MS = 3 * 3600 * 1000;

function eatDayStartUtc(daysAgo = 0) {
  const eatNow = Date.now() + EAT_MS;
  const dayStartEat = Math.floor(eatNow / 86400000) * 86400000 - daysAgo * 86400000;
  return new Date(dayStartEat - EAT_MS).toISOString();
}

async function notifyAdmins(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = getAdminIds();
  if (!token || !ids.length) return { sent: 0, reason: !token ? 'no bot token' : 'no ADMIN_TELEGRAM_IDS' };
  let sent = 0;
  for (const id of ids) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(7000),
      });
      if (r.ok) sent++;
    } catch (e) {
      // One admin with a blocked bot must not stop the others being paged.
      console.warn('[pulse-alert] send to', id, 'failed:', e.message);
    }
  }
  return { sent };
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const todayStart = eatDayStartUtc(0);
  const yesterdayStart = eatDayStartUtc(1);
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  // Same-time-yesterday, so a morning run isn't compared against a full day.
  const elapsedMs = Date.now() - new Date(todayStart).getTime();
  const yesterdaySameTime = new Date(new Date(yesterdayStart).getTime() + elapsedMs).toISOString();

  const [
    { count: msgsToday },
    { count: msgsYestSoFar },
    { data: costToday },
    { data: recentWebhooks },
  ] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', todayStart).lt('created_at', nowIso),
    sb.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', yesterdayStart).lt('created_at', yesterdaySameTime),
    fetchAllRows(() => sb.from('llm_call_log').select('total_cost_usd')
      .gte('created_at', todayStart).order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('webhook_events').select('delivery_status')
      .gte('created_at', oneHourAgo).order('created_at', { ascending: true })),
  ]);

  const aiCostToday = (costToday || []).reduce((s, r) => s + Number(r.total_cost_usd || 0), 0);
  const webhookTotal = (recentWebhooks || []).length;
  const webhookOk = (recentWebhooks || []).filter(w => w.delivery_status === 'success').length;
  const webhookRate = webhookTotal > 0 ? Math.round((webhookOk / webhookTotal) * 100) : null;

  // Same three conditions, same thresholds, as the Pulse tab — one definition
  // of "red" so the alert and the dashboard can never disagree.
  const reasons = [];
  const msgDropPct = (msgsYestSoFar || 0) > 0
    ? Math.round((1 - (msgsToday || 0) / msgsYestSoFar) * 100)
    : 0;
  if (msgDropPct > 50) {
    reasons.push(`Messages down ${msgDropPct}% vs same time yesterday (${msgsToday} vs ${msgsYestSoFar})`);
  }
  if ((msgsToday || 0) > 0 && aiCostToday === 0) {
    reasons.push(`Zero AI cost today despite ${msgsToday} messages — LLM pipeline may be down`);
  }
  if (webhookRate != null && webhookTotal >= 10 && webhookRate < 90) {
    reasons.push(`Webhook success ${webhookRate}% in the last hour (${webhookOk}/${webhookTotal})`);
  }

  const isRed = reasons.length > 0;
  const fingerprint = reasons.map(r => r.split(' ').slice(0, 3).join(' ')).sort().join('|');

  // ── Previous state, so an ongoing incident doesn't re-page every run ────────
  let prev = null;
  try {
    const { data } = await sb.from('platform_settings').select('value').eq('key', STATE_KEY).maybeSingle();
    if (data?.value) prev = JSON.parse(data.value);
  } catch { /* first run, or table not migrated — treat as no previous state */ }

  const hoursSince = prev?.last_alert_at
    ? (Date.now() - new Date(prev.last_alert_at).getTime()) / 3600000
    : Infinity;

  let action = 'none';
  if (isRed) {
    // Alert on: a new incident, a changed cause, or a stale one still burning.
    if (!prev?.red || prev.fingerprint !== fingerprint || hoursSince >= RE_ALERT_HOURS) {
      action = prev?.red && prev.fingerprint === fingerprint ? 're-alert' : 'alert';
    }
  } else if (prev?.red) {
    action = 'recovered';
  }

  let delivery = null;
  if (action === 'alert' || action === 're-alert') {
    const web = process.env.WEB_URL || '';
    const body = [
      `🔴 <b>MiniMe platform is RED</b>${action === 're-alert' ? ' (still)' : ''}`,
      '',
      ...reasons.map(r => `• ${r}`),
      '',
      `Today: ${msgsToday} messages · $${aiCostToday.toFixed(4)} AI spend`,
      web ? `\n${web}/admin` : '',
    ].join('\n');
    delivery = await notifyAdmins(body);
  } else if (action === 'recovered') {
    delivery = await notifyAdmins(`✅ <b>MiniMe recovered</b> — platform checks are green again.\n\nToday: ${msgsToday} messages · $${aiCostToday.toFixed(4)} AI spend`);
  }

  // Persist state. last_alert_at only moves when we actually sent, so the
  // re-alert clock measures time since the last page, not since the last run.
  const nextState = {
    red: isRed,
    fingerprint,
    last_alert_at: (action === 'alert' || action === 're-alert')
      ? nowIso
      : (isRed ? prev?.last_alert_at || nowIso : null),
    last_checked_at: nowIso,
  };
  try {
    await sb.from('platform_settings')
      .upsert({ key: STATE_KEY, value: JSON.stringify(nextState), encrypted: false, updated_by: 'cron/pulse-alert' }, { onConflict: 'key' });
  } catch (e) {
    console.warn('[pulse-alert] could not persist state:', e.message);
  }

  return NextResponse.json({
    ok: true,
    status: isRed ? 'red' : 'ok',
    reasons,
    action,
    delivery,
    checked_at: nowIso,
  });
}
