/**
 * GET   /api/admin/outreach/campaigns/:id — campaign detail + per-recipient send results
 * PATCH /api/admin/outreach/campaigns/:id — cancel a scheduled campaign
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { audit } from '../../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data: campaign, error } = await sb.from('outreach_campaigns').select('*').eq('id', params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: sends } = await sb.from('outreach_sends')
    .select('id, business_id, status, telegram_error, sent_at, businesses(name, owner_name)')
    .eq('campaign_id', params.id)
    .order('sent_at', { ascending: false })
    .limit(2000);

  return NextResponse.json({
    campaign,
    sends: (sends || []).map(s => ({
      id: s.id, business_id: s.business_id, business_name: s.businesses?.name || 'Unknown',
      owner_name: s.businesses?.owner_name || null, status: s.status, telegram_error: s.telegram_error, sent_at: s.sent_at,
    })),
  });
}

export async function PATCH(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  if (body.action !== 'cancel') return NextResponse.json({ error: 'unsupported_action' }, { status: 400 });

  const sb = supabase();
  const { data, error } = await sb.from('outreach_campaigns')
    .update({ status: 'cancelled' })
    .eq('id', params.id)
    .eq('status', 'scheduled') // only a still-pending scheduled campaign can be cancelled
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found_or_not_cancellable' }, { status: 409 });

  await audit({
    business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: 'outreach_campaign.cancelled', resource_type: 'outreach_campaign', resource_id: params.id, request,
  });

  return NextResponse.json({ campaign: data });
}
