/**
 * GET /api/businesses/export
 * Returns a complete JSON export of the authenticated business's data.
 *
 * Includes:
 *  - Business profile and settings
 *  - All products
 *  - All customers (with their profiles, not message content)
 *  - All orders (full history)
 *  - All conversations (metadata + message count, not full content)
 *  - All documents (URLs only — not raw content)
 *  - Active discounts
 *  - Audit log entries for this business
 *
 * For message content export, use /api/conversations/[id]/export per conversation.
 *
 * SOC 2 CC7.3 / GDPR Art. 20 (data portability)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const exportedAt = new Date().toISOString();

  // Fetch all data in parallel
  const [
    { data: products },
    { data: customers },
    { data: orders },
    { data: conversations },
    { data: documents },
    { data: discounts },
    { data: auditLogs },
    { data: suppliers },
  ] = await Promise.all([
    sb.from('products').select('*').eq('business_id', business.id).order('created_at'),
    sb.from('customers')
      .select('id, name, phone, telegram_username, tier, loyalty_points, total_orders, total_spent, last_active_at, birthday, tags, owner_notes, created_at')
      .eq('business_id', business.id)
      .order('created_at'),
    sb.from('orders')
      .select('id, status, items, total, currency, payment_method, customer_note, owner_note, created_at, paid_at, fulfilled_at, refunded_at, refund_reason, meta')
      .eq('business_id', business.id)
      .order('created_at'),
    sb.from('conversations')
      .select('id, status, platform, message_count, requires_owner, last_message_at, created_at, customers(name, telegram_username)')
      .eq('business_id', business.id)
      .order('last_message_at', { ascending: false })
      .limit(1000),
    sb.from('documents')
      .select('id, title, tag, description, mime_type, original_filename, status, created_at')
      .eq('business_id', business.id)
      .order('created_at'),
    sb.from('discounts')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at')
      .catch(() => ({ data: [] })),
    sb.from('audit_logs')
      .select('actor_type, actor_id, action, resource_type, resource_id, metadata, created_at')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(500)
      .catch(() => ({ data: [] })),
    sb.from('suppliers')
      .select('name, role, contact_telegram, specialties, is_active, created_at')
      .eq('business_id', business.id)
      .order('created_at'),
  ]);

  // Sanitize business profile for export (remove sensitive encrypted fields)
  const profile = {
    id: business.id,
    name: business.name,
    category: business.category,
    description: business.description,
    location: business.location,
    address: business.address,
    phone: business.phone,
    website: business.website,
    instagram: business.instagram,
    facebook: business.facebook,
    telegram_bot_username: business.telegram_bot_username,
    workspace_type: business.workspace_type,
    subscription_status: business.subscription_status,
    plan_tier: business.plan_tier,
    created_at: business.created_at,
    // Omit: telegram_bot_token_enc, encryption keys, webhook_secret, owner_telegram_id
  };

  const exportData = {
    export_version: '2.0',
    exported_at: exportedAt,
    business: profile,
    summary: {
      products: (products || []).length,
      customers: (customers || []).length,
      orders: (orders || []).length,
      conversations: (conversations || []).length,
      documents: (documents || []).length,
      discounts: (discounts || []).length,
    },
    products: products || [],
    customers: customers || [],
    orders: orders || [],
    conversations: (conversations || []).map(c => ({
      id: c.id,
      customer: c.customers?.name || c.customers?.telegram_username || 'Unknown',
      platform: c.platform || 'telegram',
      message_count: c.message_count || 0,
      status: c.status,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
    })),
    documents: documents || [],
    discounts: discounts || [],
    team: suppliers || [],
    audit_log: auditLogs || [],
  };

  // Log the export for audit trail
  audit({
    business_id: business.id,
    actor_type: 'owner',
    actor_id: String(tg.id),
    action: 'business.data_exported',
    resource_type: 'business',
    resource_id: business.id,
    metadata: { record_counts: exportData.summary },
    request,
  }).catch(() => {});

  const filename = `minime-export-${business.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}-${exportedAt.slice(0, 10)}.json`;

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
