/**
 * Lapsed-searcher re-engagement nudges.
 *
 * Sends a DM from @MiniMeSearchBot to people who searched MiniMe before but
 * have gone quiet (no search in the last LAPSED_DAYS days), nudging them to
 * come back. Mirrors the signup re-engagement cron's cooldown/opt-out pattern
 * (see ../reengagement/route.js) but keyed by searcher_telegram_id in
 * search_bot_nudges instead of businesses.notification_prefs, since search
 * users aren't tied to a business row — they're pseudonymous (see
 * apps/web/src/app/api/admin/searcher/route.js for the privacy rationale).
 *
 * Eligibility: last search older than LAPSED_DAYS, not opted out (STOP),
 * cooldown COOLDOWN_DAYS since last nudge, at most MAX_SENDS total.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: registered in vercel.json — weekly.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_MS = 86_400_000;
const LAPSED_DAYS = 14;     // hasn't searched in this long → eligible
const LOOKBACK_DAYS = 120;  // only consider searchers active within this window (avoid ancient one-off testers)
const COOLDOWN_DAYS = 30;   // don't re-nudge the same person more than once a month
const MAX_SENDS = 3;
const MAX_PER_RUN = 500;    // safety cap per invocation

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nudgeContent() {
  return {
    text:
      `👋 Haven't searched on *MiniMe* in a while — new Ethiopian businesses join every week!\n\n` +
      `Tell me what you're looking for, or browse what's new below.\n\n` +
      `_Reply STOP to stop these reminders._`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📂 Browse categories', callback_data: 'sb:categories' }],
        [{ text: '🏢 See all businesses', callback_data: 'sb:all' }],
      ],
    },
  };
}

async function sendNudge(token, chatId, content) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: content.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: content.reply_markup,
    }),
    signal: AbortSignal.timeout(8000),
  });
  return r;
}

function isCooledDown(row, now) {
  if ((row?.sent_count || 0) >= MAX_SENDS) return false;
  const last = row?.last_sent_at ? new Date(row.last_sent_at).getTime() : 0;
  return now - last >= COOLDOWN_DAYS * DAY_MS;
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.SEARCH_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_search_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();
  const sb = supabase();

  // 1. Find each searcher's most recent search within the lookback window.
  const lookbackISO = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data: logs, error } = await sb.from('search_logs')
    .select('searcher_telegram_id, created_at')
    .gte('created_at', lookbackISO)
    .not('searcher_telegram_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20000);

  if (error) {
    console.error('[cron/search-engagement-nudge] search_logs query failed:', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const lastSearchAt = new Map();
  for (const row of logs || []) {
    if (!lastSearchAt.has(row.searcher_telegram_id)) {
      lastSearchAt.set(row.searcher_telegram_id, new Date(row.created_at).getTime());
    }
  }

  const lapsedCutoff = now - LAPSED_DAYS * DAY_MS;
  const lapsedIds = [...lastSearchAt.entries()]
    .filter(([, t]) => t < lapsedCutoff)
    .map(([id]) => id)
    .slice(0, MAX_PER_RUN);

  const summary = { candidates: lapsedIds.length, eligible: 0, sent: 0, failed: 0, skipped_optout: 0, skipped_cooldown: 0, dry_run: dryRun };

  if (!lapsedIds.length) return NextResponse.json({ ok: true, ...summary });

  // 2. Pull existing nudge history for these searchers.
  const { data: nudgeRows } = await sb.from('search_bot_nudges')
    .select('searcher_telegram_id, sent_count, last_sent_at, opted_out')
    .in('searcher_telegram_id', lapsedIds);
  const nudgeById = new Map((nudgeRows || []).map(r => [r.searcher_telegram_id, r]));

  if (dryRun) {
    summary.sample = lapsedIds.slice(0, 5).map(id => ({ id, history: nudgeById.get(id) || null }));
  }

  for (const searcherId of lapsedIds) {
    const row = nudgeById.get(searcherId);
    if (row?.opted_out) { summary.skipped_optout++; continue; }
    if (!isCooledDown(row, now)) { summary.skipped_cooldown++; continue; }

    summary.eligible++;
    if (dryRun) continue;

    const content = nudgeContent();
    try {
      const r = await sendNudge(token, searcherId, content);
      if (r.ok) {
        summary.sent++;
        await sb.from('search_bot_nudges').upsert({
          searcher_telegram_id: searcherId,
          sent_count: (row?.sent_count || 0) + 1,
          last_sent_at: new Date(now).toISOString(),
          opted_out: false,
        }, { onConflict: 'searcher_telegram_id' })
          .then(() => {}, e => console.warn(`[cron/search-engagement-nudge] history write failed for ${searcherId}:`, e?.message));
      } else {
        summary.failed++;
        const j = await r.json().catch(() => ({}));
        console.warn(`[cron/search-engagement-nudge] send failed for ${searcherId}: ${r.status} ${j?.description || ''}`);
        if (r.status === 403) {
          await sb.from('search_bot_nudges').upsert({
            searcher_telegram_id: searcherId,
            opted_out: true,
            opted_out_at: new Date(now).toISOString(),
          }, { onConflict: 'searcher_telegram_id' }).then(() => {}, () => {});
        }
      }
    } catch (e) {
      summary.failed++;
      console.warn(`[cron/search-engagement-nudge] send error for ${searcherId}:`, e.message);
    }
    await sleep(60);
  }

  console.log('[cron/search-engagement-nudge]', JSON.stringify(summary));

  if (!dryRun && (summary.sent || summary.failed)) {
    await audit({
      business_id: null,
      actor_type: 'system',
      actor_id: 'cron',
      action: 'search_engagement_nudge.run',
      resource_type: 'cron',
      resource_id: null,
      metadata: summary,
      request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
