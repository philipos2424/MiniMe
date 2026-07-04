/**
 * GET    /api/admin/businesses/:id/customers — list a tenant's customers
 * DELETE /api/admin/businesses/:id/customers — erase one customer (GDPR-grade)
 *
 * Deletion reuses eraseCustomerData (customerRights.js): messages, memory,
 * conversations and the customer row are purged; orders stay as ANONYMOUS
 * accounting records (customer_id nulled) per GDPR Art. 17(3)(b). Every
 * erase is audit-logged.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { isAdmin } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { eraseCustomerData } from '../../../../../../lib/server/customerRights';
import { audit } from '../../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function GET(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await supabase()
    .from('customers')
    .select('id, name, telegram_id, total_orders, total_spent, last_active_at, created_at')
    .eq('business_id', params.id)
    .order('last_active_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reading another tenant's customer list is a PII access — log it.
  audit({
    business_id: params.id,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.customers_viewed',
    resource_type: 'customer',
    request,
  }).catch(() => {});

  return NextResponse.json({ customers: data || [] });
}

export async function DELETE(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body = {};
  try { body = await request.json(); } catch {}
  const customerId = String(body.customer_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return NextResponse.json({ error: 'customer_id required' }, { status: 400 });
  }

  // Snapshot minimal identifiers for the audit trail BEFORE erasure.
  const { data: cust } = await supabase().from('customers')
    .select('id, name, telegram_id')
    .eq('id', customerId).eq('business_id', params.id).maybeSingle();
  if (!cust) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await eraseCustomerData(params.id, customerId);

  await audit({
    business_id: params.id,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.customer_erased',
    resource_type: 'customer',
    resource_id: customerId,
    metadata: { name: cust.name || null, telegram_id: cust.telegram_id || null },
    request,
  });

  return NextResponse.json({ ok: true });
}
