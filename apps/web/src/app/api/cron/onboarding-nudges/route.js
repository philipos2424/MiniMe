/**
 * Stuck-onboarding re-engagement nudges.
 *
 * Sends a DM from @MiniMeAgentBot to owners who created a business but never
 * finished activation (`onboarding_completed = false`). The wizard already
 * resumes them at the `connect` step on return (see DashboardShell +
 * needsOnboarding + ONB_RESUME_KEY) — the gap is that nothing ever tells them
 * to come back.
 *
 * Eligibility: onboarding_completed = false, owner_telegram_id set,
 * created_at older than 30 minutes (don't ping someone mid-signup), not
 * opted out (notification_prefs.owner_nudges.opted_out).
 *
 * Cooldown: notification_prefs.onboarding_nudge — at most 3 sends, 24h apart.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: registered in vercel.json.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HOUR_MS = 3_600_000;
const MIN_AGE_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 24 * HOUR_MS;
const MAX_SENDS = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

function nudgeContent(business) {
  const first = (business.owner_name || '').split(' ')[0] || 'there';
  return {
    text:
      `Hi ${first} 👋\n\n` +
      `Quick one — your *${business.name || 'shop'}* setup on MiniMe didn't finish (we just fixed a small bug on our end). ` +
      `Reopen MiniMe and tap *Go Live* again — should take 10 seconds now.\n\n` +
      `_Tap "📱 Open MiniMe" below — or reply STOP to silence these reminders._`,
  };
}

async function sendNudge(token, chatId, content) {
  const url = appUrl();
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: content.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: url ? { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url } }]] } : undefined,
    }),
    signal: AbortSignal.timeout(8000),
  });
  return r;
}

function isCooledDown(history, now) {
  if ((history?.sent_count || 0) >= MAX_SENDS) return false;
  const last = history?.last_sent_at ? new Date(history.last_sent_at).getTime() : 0;
  return now - last >= COOLDOWN_MS;
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();
  const sb = supabase();

  const { data: businesses, error } = await sb
    .from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, created_at, notification_prefs')
    .eq('onboarding_completed', false)
    .not('owner_telegram_id', 'is', null)
    .limit(2000);

  if (error) {
    console.error('[cron/onboarding-nudges] businesses query failed:', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!businesses?.length) return NextResponse.json({ ok: true, eligible: 0, sent: 0, skipped: 0 });

  const summary = { eligible: 0, sent: 0, failed: 0, skipped_optout: 0, skipped_cooldown: 0, skipped_too_new: 0, dry_run: dryRun };

  for (const b of businesses) {
    const ownerNudges = b.notification_prefs?.owner_nudges || {};
    if (ownerNudges.opted_out === true) { summary.skipped_optout++; continue; }

    if (now - new Date(b.created_at).getTime() < MIN_AGE_MS) { summary.skipped_too_new++; continue; }

    const history = b.notification_prefs?.onboarding_nudge || {};
    if (!isCooledDown(history, now)) { summary.skipped_cooldown++; continue; }

    summary.eligible++;
    if (dryRun) continue;

    const content = nudgeContent(b);
    const chatId = b.owner_private_chat_id || b.owner_telegram_id;
    try {
      const r = await sendNudge(token, chatId, content);
      if (r.ok) {
        summary.sent++;
        const next = {
          ...history,
          last_sent_at: new Date(now).toISOString(),
          sent_count: (history.sent_count || 0) + 1,
        };
        await sb.from('businesses')
          .update({ notification_prefs: { ...(b.notification_prefs || {}), onboarding_nudge: next } })
          .eq('id', b.id)
          .then(() => {}, e => console.warn(`[cron/onboarding-nudges] history write failed for ${b.id}:`, e?.message));
      } else {
        summary.failed++;
        const j = await r.json().catch(() => ({}));
        console.warn(`[cron/onboarding-nudges] send failed for ${b.id}: ${r.status} ${j?.description || ''}`);
        if (r.status === 403) {
          const next = { ...ownerNudges, opted_out: true, opted_out_reason: 'telegram_403', opted_out_at: new Date(now).toISOString() };
          await sb.from('businesses')
            .update({ notification_prefs: { ...(b.notification_prefs || {}), owner_nudges: next } })
            .eq('id', b.id).then(() => {}, () => {});
        }
      }
    } catch (e) {
      summary.failed++;
      console.warn(`[cron/onboarding-nudges] send error for ${b.id}:`, e.message);
    }
    await sleep(60);
  }

  console.log('[cron/onboarding-nudges]', JSON.stringify(summary));

  if (!dryRun && (summary.sent || summary.failed)) {
    await audit({
      business_id: null,
      actor_type: 'system',
      actor_id: 'cron',
      action: 'onboarding_nudges.run',
      resource_type: 'cron',
      resource_id: null,
      metadata: summary,
      request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
