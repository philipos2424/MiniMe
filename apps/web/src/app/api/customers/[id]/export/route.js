/**
 * GET /api/customers/[id]/export
 * GDPR Article 20 — Data Portability.
 *
 * Returns a JSON bundle of all personal data MiniMe holds for this customer:
 *   - Profile (name, phone, telegram info, loyalty)
 *   - All messages (inbound + outbound)
 *   - All orders
 *   - Customer memory (AI-extracted facts)
 *   - Feedback ratings
 *
 * Owner-authenticated only.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  const [
    { data: customer },
    { data: messages },
    { data: orders },
    { data: memory },
    { data: feedback },
  ] = await Promise.all([
    sb.from('customers')
      .select('id, name, phone, telegram_id, telegram_username, tier, loyalty_points, total_orders, total_spent, birthday, created_at, last_active_at, tags, ai_notes, owner_notes')
      .eq('id', params.id).eq('business_id', business.id).single(),
    sb.from('messages')
      .select('direction, content, created_at, content_type, file_type, is_ai_generated')
      .eq('customer_id', params.id).eq('business_id', business.id)
      .order('created_at', { ascending: true }).limit(2000),
    sb.from('orders')
      .select('id, status, items, total, currency, created_at, paid_at, delivery_status, customer_note')
      .eq('customer_id', params.id).eq('business_id', business.id)
      .order('created_at', { ascending: true }).limit(500),
    sb.from('customer_memory')
      .select('kind, content, source, created_at')
      .eq('customer_id', params.id).eq('business_id', business.id)
      .order('created_at', { ascending: true }),
    sb.from('feedback')
      .select('helpful, rating, comment, created_at')
      .eq('customer_id', params.id).eq('business_id', business.id)
      .order('created_at', { ascending: true }),
  ]);

  if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await audit({
    business_id: business.id,
    actor_type: String(tg.id) === String(business.owner_telegram_id) ? 'owner' : 'staff',
    actor_id: String(tg.id),
    action: 'customer.data_exported', resource_type: 'customer', resource_id: params.id,
    metadata: { customer_name: customer.name }, request,
  });

  const bundle = {
    export_date: new Date().toISOString(),
    business: business.name,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      telegram_id: customer.telegram_id,
      telegram_username: customer.telegram_username,
      tier: customer.tier,
      loyalty_points: customer.loyalty_points,
      total_orders: customer.total_orders,
      total_spent: customer.total_spent,
      birthday: customer.birthday,
      created_at: customer.created_at,
      last_active_at: customer.last_active_at,
      tags: customer.tags,
      ai_notes: customer.ai_notes,
      owner_notes: customer.owner_notes,
    },
    messages: (messages || []).map(m => ({
      direction: m.direction,
      content: m.content,
      type: m.content_type,
      is_ai: m.is_ai_generated,
      sent_at: m.created_at,
    })),
    orders: (orders || []).map(o => ({
      id: o.id,
      status: o.status,
      items: o.items,
      total: o.total,
      currency: o.currency,
      ordered_at: o.created_at,
      paid_at: o.paid_at,
    })),
    ai_memory: (memory || []).map(m => ({
      kind: m.kind,
      content: m.content,
      source: m.source,
      learned_at: m.created_at,
    })),
    feedback: (feedback || []),
  };

  const filename = `customer-data-${params.id.slice(-6)}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
