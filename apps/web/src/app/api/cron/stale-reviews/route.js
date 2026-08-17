/**
 * GET /api/cron/stale-reviews — chase payments that are waiting on a human.
 *
 * Proof uploads no longer activate anything: they sit in pending_review until
 * an admin presses Approve. That makes the review a single point of failure
 * that nothing watches. One missed Telegram message and a merchant who has
 * genuinely paid waits indefinitely — and at REVIEW_HOLD_DAYS their expiry
 * hold lapses and they silently drop to Free, having paid us.
 *
 * The Pulse tab shows "payments waiting", but only while somebody has it open.
 * This pages the admins on a schedule instead, and escalates as the hold
 * approaches expiry, because that is the deadline that actually costs a
 * merchant something.
 *
 * Deduped through platform_settings on the same principle as pulse-alert: an
 * alert that fires every run gets muted by the reader, which is the same as
 * having no alert. One nudge per queue-state per RE_ALERT_HOURS.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { REVIEW_HOLD_DAYS } from '../../../../lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATE_KEY = 'stale_review_alert_state';
const RE_ALERT_HOURS = 12;

// Don't nag the moment someone uploads — a few hours is a reasonable window to
// notice the original notification and act on it without a second prompt.
const QUIET_HOURS = 6;

// Days of hold left below which a payment is URGENT: past zero the merchant
// loses access despite having paid, so this must fire well before it.
const URGENT_DAYS_LEFT = 4;

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
      console.warn('[stale-reviews] send to', id, 'failed:', e.message);
    }
  }
  return { sent };
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const now = Date.now();

  const { data: rows, error } = await sb.from('businesses')
    .select('id, name, owner_name, payment_ref, payment_bank_ref, payment_submitted_at, payment_notes, verifyet_plan')
    .eq('subscription_status', 'pending_review')
    .order('payment_submitted_at', { ascending: true, nullsFirst: true })
    .limit(200);

  if (error) {
    console.error('[stale-reviews]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A row with no payment_submitted_at predates that column (or the migration
  // hasn't run). It still needs reviewing — it just has no measurable age, so
  // treat it as waiting rather than dropping it from the queue entirely.
  const waiting = (rows || []).map(b => {
    const since = b.payment_submitted_at ? new Date(b.payment_submitted_at).getTime() : null;
    const hoursWaiting = since ? (now - since) / 3600000 : null;
    const daysLeft = since ? REVIEW_HOLD_DAYS - (now - since) / 86400000 : null;
    return { ...b, hoursWaiting, daysLeft };
  }).filter(b => b.hoursWaiting === null || b.hoursWaiting >= QUIET_HOURS);

  // Same persistence shape as pulse-alert — a plain platform_settings row.
  let state = {};
  try {
    const { data } = await sb.from('platform_settings').select('value').eq('key', STATE_KEY).maybeSingle();
    if (data?.value) state = JSON.parse(data.value);
  } catch { /* first run, or table not migrated — treat as no previous state */ }

  const saveState = async next => {
    try {
      await sb.from('platform_settings').upsert(
        { key: STATE_KEY, value: JSON.stringify(next), encrypted: false, updated_by: 'cron/stale-reviews' },
        { onConflict: 'key' });
    } catch (e) {
      console.warn('[stale-reviews] could not persist state:', e.message);
    }
  };

  if (!waiting.length) {
    if (state.count) await saveState({ count: 0, urgent: 0, at: now });
    return NextResponse.json({ ok: true, waiting: 0 });
  }

  const urgent = waiting.filter(b => b.daysLeft !== null && b.daysLeft <= URGENT_DAYS_LEFT);

  // Re-alert when the queue GROWS or an item turns urgent, regardless of the
  // cooldown — a new merchant waiting is new information. Otherwise respect it.
  const grew = (state.count || 0) < waiting.length;
  const newlyUrgent = (state.urgent || 0) < urgent.length;
  const cooledDown = !state.at || (now - state.at) / 3600000 >= RE_ALERT_HOURS;
  if (!grew && !newlyUrgent && !cooledDown) {
    return NextResponse.json({ ok: true, waiting: waiting.length, skipped: 'cooldown' });
  }

  const lines = waiting.slice(0, 12).map(b => {
    const age = b.hoursWaiting === null
      ? 'age unknown'
      : b.hoursWaiting < 48
        ? `${Math.round(b.hoursWaiting)}h`
        : `${Math.round(b.hoursWaiting / 24)}d`;
    const flag = (b.daysLeft !== null && b.daysLeft <= URGENT_DAYS_LEFT)
      ? ` ⚠️ ${Math.max(0, Math.round(b.daysLeft))}d of access left`
      : '';
    const plan = b.verifyet_plan === 'pro_annual' ? 'annual' : 'monthly';
    return `• <b>${b.name || 'Unnamed'}</b> — ${plan}, waiting ${age}${flag}\n  ref <code>${b.payment_ref || '—'}</code>${b.payment_bank_ref ? ` · bank <code>${b.payment_bank_ref}</code>` : ''}`;
  });

  const more = waiting.length > 12 ? `\n…and ${waiting.length - 12} more.` : '';
  const text =
    `💳 <b>${waiting.length} payment${waiting.length === 1 ? '' : 's'} waiting for your approval</b>\n\n` +
    lines.join('\n') + more +
    (urgent.length
      ? `\n\n<b>${urgent.length} will lose access soon.</b> They have paid — approving is what keeps them on Pro.`
      : '\n\nApprove or reject from the proof message, or in the admin dashboard.');

  const { sent, reason } = await notifyAdmins(text);
  await saveState({ count: waiting.length, urgent: urgent.length, at: now });

  return NextResponse.json({ ok: true, waiting: waiting.length, urgent: urgent.length, sent, reason });
}
