/**
 * GET /api/admin/outreach/sends — paginated outreach send history
 * Query params: rule_id, campaign_id, business_id, status, from, to, page (0-based), page_size (default 50, max 200)
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['sent', 'failed', 'skipped_optout', 'skipped_cooldown', 'blocked'];

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const ruleId = url.searchParams.get('rule_id');
  const campaignId = url.searchParams.get('campaign_id');
  const businessId = url.searchParams.get('business_id');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('page_size') || '50', 10) || 50));

  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  const sb = supabase();
  let q = sb.from('outreach_sends')
    .select('id, business_id, source_type, rule_id, campaign_id, rule_key, status, telegram_error, message_preview, sent_at, businesses(name, owner_name)', { count: 'exact' })
    .order('sent_at', { ascending: false });

  if (ruleId) q = q.eq('rule_id', ruleId);
  if (campaignId) q = q.eq('campaign_id', campaignId);
  if (businessId) q = q.eq('business_id', businessId);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('sent_at', from);
  if (to) q = q.lte('sent_at', to);

  const start = page * pageSize;
  const { data, error, count } = await q.range(start, start + pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sends: (data || []).map(s => ({
      id: s.id, business_id: s.business_id, business_name: s.businesses?.name || 'Unknown',
      owner_name: s.businesses?.owner_name || null, source_type: s.source_type,
      rule_id: s.rule_id, campaign_id: s.campaign_id, rule_key: s.rule_key,
      status: s.status, telegram_error: s.telegram_error, message_preview: s.message_preview, sent_at: s.sent_at,
    })),
    total: count || 0,
    page, page_size: pageSize,
  });
}
