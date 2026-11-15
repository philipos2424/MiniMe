/**
 * GET /api/admin/funnel-weekly — the weekly founder funnel report as JSON,
 * for the admin page (spec §1). Same builder as the Monday Telegram message,
 * so the two can never disagree. Read-only: the sync runs in the cron.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { loadWeeklyReport } from '../../../../lib/server/funnel/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, report: await loadWeeklyReport() });
  } catch (e) {
    console.error('[admin/funnel-weekly] failed:', e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
