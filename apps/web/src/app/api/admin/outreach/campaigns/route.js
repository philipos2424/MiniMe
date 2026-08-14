/**
 * GET  /api/admin/outreach/campaigns — list saved campaigns
 * POST /api/admin/outreach/campaigns — create a campaign (draft, scheduled, or send now)
 *
 * Uses lib/server/outreach.js (the same module notify-owners uses) for
 * segment resolution and the flood-safe send loop, so this and the older
 * notify-owners panel never diverge.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';
import { str, oneOf, isoDate, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';
import { ALLOWED_SEGMENTS, selectRecipients, sendBroadcast } from '../../../../../lib/server/outreach';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data, error } = await sb.from('outreach_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  let name, message, segment, businessIds, scheduledFor, asDraft;
  try {
    name = str(body.name, { field: 'name', min: 1, max: 120, required: true, stripHtml: true });
    message = str(body.message, { field: 'message', min: 1, max: 3800, required: true, stripHtml: true });
    segment = oneOf(body.segment, ALLOWED_SEGMENTS, { field: 'segment', required: false }) || null;
    if (Array.isArray(body.business_ids) && body.business_ids.length) {
      businessIds = Array.from(new Set(body.business_ids
        .filter(x => typeof x === 'string' && /^[0-9a-f-]{20,40}$/i.test(x))))
        .slice(0, 2000);
    }
    if (!segment && !businessIds?.length) throw new ValidationError('segment', 'either segment or business_ids is required');
    scheduledFor = body.scheduled_for ? isoDate(body.scheduled_for, { field: 'scheduled_for', pastAllowed: false }) : null;
    asDraft = !!body.as_draft;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const segmentFilter = businessIds?.length ? { business_ids: businessIds } : { segment };
  const sb = supabase();

  // Draft or scheduled: just persist, the cron engine picks up due
  // scheduled campaigns.
  if (asDraft || scheduledFor) {
    const { data, error } = await sb.from('outreach_campaigns').insert({
      name, message, segment_filter: segmentFilter,
      status: scheduledFor ? 'scheduled' : 'draft',
      scheduled_for: scheduledFor,
      created_by: String(admin.id),
    }).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await audit({
      business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
      action: scheduledFor ? 'outreach_campaign.scheduled' : 'outreach_campaign.drafted',
      resource_type: 'outreach_campaign', resource_id: data.id,
      metadata: { name, scheduled_for: scheduledFor }, request,
    });

    return NextResponse.json({ campaign: data });
  }

  // Send now.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_platform_bot_token' }, { status: 500 });

  let recipients;
  if (businessIds?.length) {
    const { data } = await sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, notification_prefs')
      .in('id', businessIds).not('owner_telegram_id', 'is', null);
    recipients = data || [];
  } else {
    recipients = await selectRecipients(segment);
  }
  recipients = recipients.filter(b => b.notification_prefs?.owner_nudges?.opted_out !== true);

  const { data: campaign, error: insertError } = await sb.from('outreach_campaigns').insert({
    name, message, segment_filter: segmentFilter, status: 'sending',
    created_by: String(admin.id), recipient_count: recipients.length,
  }).select('*').single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  if (!recipients.length) {
    await sb.from('outreach_campaigns').update({ status: 'sent', sent_at: new Date().toISOString(), sent_count: 0, failed_count: 0 }).eq('id', campaign.id);
    return NextResponse.json({ campaign, sent: 0, failed: 0, total: 0, message: 'No reachable owners after filtering opt-outs.' });
  }

  const result = await sendBroadcast({ token, recipients, message, source: { type: 'campaign', campaign_id: campaign.id } });

  const { data: updated } = await sb.from('outreach_campaigns').update({
    status: 'sent', sent_at: new Date().toISOString(),
    sent_count: result.sent, failed_count: result.failed,
  }).eq('id', campaign.id).select('*').single();

  await audit({
    business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: 'outreach_campaign.sent', resource_type: 'outreach_campaign', resource_id: campaign.id,
    metadata: { name, sent: result.sent, failed: result.failed, blocked: result.blocked, total: recipients.length },
    request,
  });

  return NextResponse.json({ campaign: updated || campaign, sent: result.sent, failed: result.failed, blocked: result.blocked, total: recipients.length });
}
