/**
 * GET /api/cron/funnel-weekly — weekly founder funnel report (spec §1).
 *
 * 1. Syncs funnel_events from the source tables (first ever run backfills
 *    the full history).
 * 2. Builds the report for the last completed Mon–Sun week, Addis time.
 * 3. Sends it to every platform admin on Telegram, in Amharic + English.
 *
 * Query params:
 *   dry_run=1   compute everything, insert nothing, send nothing
 *   backfill=1  force a full-history sync
 *   send=0      sync and return the report without messaging admins
 *
 * Off switch: platform setting `funnel.tracking` = off (or env FUNNEL_TRACKING=off).
 * Schedule: vercel.json, Monday 06:00 UTC = 09:00 Addis.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { getAdminIds } from '../../../../lib/server/admin';
import { sendTelegramMessage } from '../../../../lib/server/telegram-send.mjs';
import { syncFunnelEvents, funnelEventsEmpty, funnelTrackingEnabled, loadWeeklyReport } from '../../../../lib/server/funnel/sync';
import { buildWeeklyReport, formatWeeklyReport } from '../../../../lib/server/funnel/weeklyReport.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!(await funnelTrackingEnabled())) {
    return NextResponse.json({ ok: true, skipped: 'funnel_tracking_off' });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const send = !dryRun && url.searchParams.get('send') !== '0';
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const adminIds = getAdminIds();

  try {
    const backfill = url.searchParams.get('backfill') === '1' || await funnelEventsEmpty();
    const sync = await syncFunnelEvents({ backfill, dryRun });

    // A dry run inserted nothing, so the stored events can't describe what
    // the report WOULD say — report on an empty funnel rather than mislead.
    const report = dryRun
      ? buildWeeklyReport({ events: [] })
      : await loadWeeklyReport();

    let sent = 0;
    if (send && token) {
      const text = formatWeeklyReport(report, { webUrl: (process.env.WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim() });
      for (const id of adminIds) {
        const r = await sendTelegramMessage(token, { chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true })
          .catch(e => ({ ok: false, error: e?.message }));
        if (r?.ok) sent++;
        else console.warn(`[funnel-weekly] send to ${id} failed`);
      }
    }

    return NextResponse.json({ ok: true, sync, sent, report: dryRun ? null : report });
  } catch (e) {
    console.error('[cron/funnel-weekly] failed:', e.message);
    if (send && token) {
      for (const id of adminIds) {
        await sendTelegramMessage(token, { chat_id: id, text: `⚠️ Weekly funnel report failed: ${String(e.message).slice(0, 300)}` }).catch(() => {});
      }
    }
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
