/**
 * GET /api/admin/notify-owners/engagement?broadcast_id=...
 *
 * Post-send engagement for one notify-owners broadcast. Telegram never tells
 * a bot whether a message was read — there's no such thing as a delivery or
 * read receipt on the Bot API — so "opened" here means something we CAN
 * observe: the owner's business showed any activity in our own telemetry
 * after we sent them the message.
 *
 * Two signals, both keyed off outreach_sends.sent_at for that business:
 *   - opened_app:  a ux_events row (any dashboard nav/click) after sent_at.
 *     This already fires on every Mini App open (see components/Tracker.jsx),
 *     so no new client instrumentation was needed to get this signal.
 *   - progressed:  an onboarding_events row (funnel step) after sent_at, for
 *     owners who hadn't finished onboarding — i.e. did the nudge actually
 *     move them forward, not just get them to look.
 *
 * This is a "did something happen after" correlation, not proof the message
 * itself caused it — there's no click-through tag on the broadcast button.
 * Good enough to tell a real re-engagement from a dead one.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { fetchAllRows, fetchAllRowsForIds } from '../../../../../lib/server/fetch-all.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const broadcastId = new URL(request.url).searchParams.get('broadcast_id') || '';
  if (!UUID_RE.test(broadcastId)) {
    return NextResponse.json({ error: 'invalid_broadcast_id' }, { status: 400 });
  }

  const sb = supabase();

  const { data: sends } = await fetchAllRows(() => sb.from('outreach_sends')
    .select('business_id, status, sent_at')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'sent')
    .order('business_id'));

  if (!sends?.length) {
    return NextResponse.json({ broadcast_id: broadcastId, total_sent: 0, opened: 0, progressed: 0, businesses: [] });
  }

  const sentAtByBusiness = new Map(sends.map(s => [s.business_id, s.sent_at]));
  const businessIds = [...sentAtByBusiness.keys()];
  const earliestSentAt = sends.reduce((min, s) => (s.sent_at < min ? s.sent_at : min), sends[0].sent_at);

  const [{ data: businesses }, { data: uxRows }] = await Promise.all([
    fetchAllRowsForIds(businessIds, ids => sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, onboarding_completed')
      .in('id', ids)
      .order('id')),
    fetchAllRowsForIds(businessIds, ids => sb.from('ux_events')
      .select('business_id, created_at')
      .in('business_id', ids)
      .gte('created_at', earliestSentAt)
      .order('created_at', { ascending: true })),
  ]);

  // Earliest post-send ux_events row per business — that's "first opened at".
  const firstOpenByBusiness = new Map();
  for (const row of uxRows || []) {
    if (firstOpenByBusiness.has(row.business_id)) continue;
    const sentAt = sentAtByBusiness.get(row.business_id);
    if (sentAt && row.created_at > sentAt) firstOpenByBusiness.set(row.business_id, row.created_at);
  }

  // Funnel progress only makes sense for owners who weren't done onboarding —
  // "sent" businesses that were mid-signup when notified.
  const incomplete = (businesses || []).filter(b => !b.onboarding_completed && b.owner_telegram_id);
  const telegramIds = incomplete.map(b => Number(b.owner_telegram_id));
  const byTelegramId = new Map(incomplete.map(b => [Number(b.owner_telegram_id), b.id]));

  let onboardingRows = [];
  if (telegramIds.length) {
    const { data } = await fetchAllRowsForIds(telegramIds, ids => sb.from('onboarding_events')
      .select('telegram_id, step, created_at')
      .in('telegram_id', ids)
      .gte('created_at', earliestSentAt)
      .order('created_at', { ascending: true }));
    onboardingRows = data || [];
  }

  const progressByBusiness = new Map(); // business_id -> { at, step }
  for (const row of onboardingRows) {
    const businessId = byTelegramId.get(Number(row.telegram_id));
    if (!businessId) continue;
    const sentAt = sentAtByBusiness.get(businessId);
    if (!sentAt || row.created_at <= sentAt) continue;
    if (!progressByBusiness.has(businessId)) progressByBusiness.set(businessId, { at: row.created_at, step: row.step });
  }

  const businessById = new Map((businesses || []).map(b => [b.id, b]));
  const rows = businessIds.map(id => {
    const b = businessById.get(id);
    const opened_at = firstOpenByBusiness.get(id) || null;
    const progress = progressByBusiness.get(id) || null;
    return {
      business_id: id,
      name: b?.name || null,
      owner_name: b?.owner_name || null,
      sent_at: sentAtByBusiness.get(id),
      opened_app: !!opened_at,
      opened_at,
      progressed: !!progress,
      progressed_at: progress?.at || null,
      progressed_step: progress?.step || null,
    };
  }).sort((a, b) => (b.opened_at || '').localeCompare(a.opened_at || ''));

  return NextResponse.json({
    broadcast_id: broadcastId,
    total_sent: businessIds.length,
    opened: rows.filter(r => r.opened_app).length,
    progressed: rows.filter(r => r.progressed).length,
    eligible_for_progress: incomplete.length,
    businesses: rows,
  });
}
