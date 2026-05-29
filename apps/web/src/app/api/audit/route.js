/**
 * GET /api/audit?limit=50&offset=0&action=refund.issued
 * Returns audit log entries for the authenticated business owner.
 * Platform admins can pass &admin=1 for cross-business view.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { isAdmin } from '../../../lib/server/admin';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit  = Math.min(Math.max(1, parseInt(searchParams.get('limit')  || '50', 10)), 200);
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
  const action = searchParams.get('action') || null;

  const sb = supabase();
  const adminMode = isAdmin(tg.id) && searchParams.get('admin') === '1';

  let businessId = null;
  if (!adminMode) {
    const business = await findBusinessForUser(tg.id);
    if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    businessId = business.id;
  }

  let q = sb.from('audit_logs')
    .select('id, actor_type, actor_id, action, resource_type, resource_id, metadata, ip, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (businessId) q = q.eq('business_id', businessId);
  if (action) q = q.eq('action', action);

  const { data: logs, error } = await q;
  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ logs: [], total: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Partially redact IPs — show /16 only (first 2 octets)
  const safe = (logs || []).map(l => ({
    ...l,
    ip: l.ip ? l.ip.split('.').slice(0, 2).join('.') + '.x.x' : null,
  }));

  return NextResponse.json({ logs: safe, total: safe.length });
}
