/**
 * GET /api/cron/funnel-daily — Daily onboarding funnel report to admins.
 *
 * Pulls the last 24 hours of onboarding_events, compares conversion rates
 * against the baseline (pre-optimization numbers), and sends a concise
 * summary to every admin via Telegram.
 *
 * Baseline numbers (updated Aug 20, 2026 after onboarding simplification):
 *   welcome → gift_claimed:   62%
 *   gift_claimed → shop_name: 91%
 *   shop_name → saved:        89%
 *   chat_started → finished:  37%
 *   connect → activated:      58%  (was 24% before custom bot removal)
 *
 * Regression threshold: 10pp below baseline triggers ⚠️ alert
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: registered in vercel.json (daily 06:00 UTC = 09:00 Addis).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Baseline conversion rates — used for comparison arrows.
// Updated Aug 2026 after onboarding simplification (custom bot removal, CTA tightening).
// Old baselines for reference: connect_to_activate was 24% pre-optimization.
const BASELINE = {
  welcome_to_gift:      62,
  gift_to_shop:         91,
  shop_name_to_saved:   89,
  chat_started_to_done: 37,
  connect_to_activate:  58,  // Was 24% before custom bot removal (Aug 20, 2026)
};

// Thresholds for flagging regressions (percentage points below baseline).
const REGRESS_THRESHOLD = 10;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds = getAdminIds();
  if (!token) return NextResponse.json({ ok: false, error: 'no_bot_token' }, { status: 500 });
  if (!adminIds.length) return NextResponse.json({ ok: false, error: 'no_admins' }, { status: 500 });

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Pull all onboarding events in the window.
  const { data: rows, error } = await fetchAllRows(() => supabase()
    .from('onboarding_events')
    .select('step, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true }));

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ ok: true, skipped: 'no_events', since });

  // Count events by step.
  const counts = {};
  for (const r of rows) {
    counts[r.step] = (counts[r.step] || 0) + 1;
  }

  // Compute conversion rates.
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

  const funnel = {
    welcome:       counts.welcome || 0,
    gift_claimed:  counts.gift_claimed || 0,
    shop_name:     counts.shop_name || 0,
    saved:         counts.shop_name_saved || 0,
    chat_started:  counts.customer_chat_started || 0,
    chat_done:     counts.customer_chat_finished || 0,
    chat_skipped:  counts.customer_chat_skipped || 0,
    connect:       counts.connect || 0,
    activated:     (counts.connected_shared || 0) + (counts.connected_custom || 0),
    connected_shared:  counts.connected_shared || 0,
    connected_custom:  counts.connected_custom || 0,
    trial_started: counts.trial_started || 0,
  };

  const rates = {
    welcome_to_gift:     pct(funnel.gift_claimed, funnel.welcome),
    gift_to_shop:        pct(funnel.shop_name, funnel.gift_claimed),
    shop_to_saved:       pct(funnel.saved, funnel.shop_name),
    chat_to_done:        pct(funnel.chat_done, funnel.chat_started),
    connect_to_activate: pct(funnel.activated, funnel.connect),
  };

  // Build the report.
  const arrow = (actual, baseline) => {
    const diff = actual - baseline;
    if (diff > 5) return `📈 +${diff}pp`;
    if (diff < -5) return `📉 ${diff}pp`;
    return `➡️ ~${diff >= 0 ? '+' : ''}${diff}pp`;
  };

  const lines = [];
  lines.push(`📊 <b>Funnel — last 24h</b>`);
  lines.push(`<i>${funnel.welcome} welcome · ${funnel.activated}/${funnel.connect} activated</i>`);
  lines.push('');

  // Funnel steps with conversion rates vs baseline.
  const steps = [
    ['welcome → gift',     rates.welcome_to_gift,     BASELINE.welcome_to_gift,      funnel.welcome],
    ['gift → shop_name',   rates.gift_to_shop,        BASELINE.gift_to_shop,         funnel.gift_claimed],
    ['shop_name → saved',  rates.shop_to_saved,       BASELINE.shop_name_to_saved,   funnel.shop_name],
    ['chat → done',        rates.chat_to_done,        BASELINE.chat_started_to_done, funnel.chat_started],
    ['connect → activate', rates.connect_to_activate, BASELINE.connect_to_activate,  funnel.connect],
  ];

  for (const [label, rate, base, denom] of steps) {
    if (denom === 0) {
      lines.push(`• <b>${label}</b>: no traffic`);
      continue;
    }
    const flag = rate < base - REGRESS_THRESHOLD ? ' ⚠️' : '';
    lines.push(`• <b>${label}</b>: ${rate}% ${arrow(rate, base)}${flag}`);
  }

  // Custom bot check — should be zero after the optimization.
  if (funnel.connected_custom > 0) {
    lines.push('');
    lines.push(`⚠️ <i>${funnel.connected_custom} custom bot activations — the old path is still being used.</i>`);
  }

  // Chat abandonment.
  if (funnel.chat_started > 0 && funnel.chat_skipped > 0) {
    const skipRate = pct(funnel.chat_skipped, funnel.chat_started);
    lines.push('');
    lines.push(`💬 Chat: ${funnel.chat_done} done · ${funnel.chat_skipped} skipped (${skipRate}% skip rate)`);
  }

  lines.push('');
  const web = process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (web) lines.push(`<a href="${web}/admin">Open dashboard →</a>`);

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
      else console.warn(`[funnel-daily] send to ${id} failed: ${r.status}`);
    } catch (e) {
      console.warn(`[funnel-daily] send to ${id} failed:`, e.message);
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    period: { since, until: new Date().toISOString() },
    funnel,
    rates,
  });
}
