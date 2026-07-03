/**
 * customerRights.js — GDPR self-service for the CUSTOMER side of a business
 * relationship (not the business owner).
 *
 * A customer talking to a MiniMe-powered bot has no mini-app login, so their
 * Article 15 (access), Article 17 (erasure) and Article 20 (portability)
 * rights are exercised directly in the chat — see the "/mydata" and
 * "delete my data" handlers in replyEngine.js `handleTenantUpdate`.
 *
 * Scope is always ONE customer at ONE business (customer_id + business_id),
 * never cross-business — a customer's data at Shop A is invisible to Shop B.
 */
import { supabase } from './db';

/**
 * Everything MiniMe holds about this customer, in the same shape as the
 * owner-facing /api/customers/[id]/export route (Article 20 portability —
 * the customer gets exactly what the business could pull about them).
 */
export async function exportCustomerData(businessId, customerId) {
  const sb = supabase();
  const [
    { data: customer },
    { data: messages },
    { data: orders },
    { data: memory },
  ] = await Promise.all([
    sb.from('customers')
      .select('id, name, phone, telegram_id, telegram_username, tier, total_orders, total_spent, birthday, created_at, last_active_at, tags, ai_notes, owner_notes, preferences, language_preference')
      .eq('id', customerId).eq('business_id', businessId).single(),
    sb.from('messages')
      .select('direction, content, created_at, content_type, is_ai_generated')
      .eq('customer_id', customerId).eq('business_id', businessId)
      .order('created_at', { ascending: true }).limit(2000),
    sb.from('orders')
      .select('id, status, items, total, currency, created_at, paid_at, delivery_status')
      .eq('customer_id', customerId).eq('business_id', businessId)
      .order('created_at', { ascending: true }).limit(500),
    sb.from('customer_memory')
      .select('kind, content, source, created_at')
      .eq('customer_id', customerId).eq('business_id', businessId)
      .order('created_at', { ascending: true }),
  ]);

  return {
    export_date: new Date().toISOString(),
    note: 'This is everything MiniMe holds about you for this business. You can request deletion any time by messaging "delete my data".',
    profile: customer || null,
    messages: (messages || []).map(m => ({
      direction: m.direction, content: m.content, type: m.content_type,
      is_ai_generated: m.is_ai_generated, sent_at: m.created_at,
    })),
    orders: (orders || []),
    ai_learned_about_you: (memory || []).map(m => ({
      kind: m.kind, content: m.content, source: m.source, learned_at: m.created_at,
    })),
  };
}

/**
 * Erase this customer's data at this ONE business (Article 17 — right to
 * erasure). Orders are preserved as anonymous accounting records (legal
 * obligation, GDPR Art. 17(3)(b)) — customer_id is nulled first so no live
 * PII link remains, matching the whole-business deletion in
 * /api/businesses/delete.
 */
export async function eraseCustomerData(businessId, customerId) {
  const sb = supabase();
  const purge = async (label, run) => {
    try { await run(); } catch (e) { console.warn(`[customerRights.erase] ${label} failed:`, e.message); }
  };

  // De-link orders from this customer BEFORE deleting the row — orders stay
  // as accounting records but carry no live PII pointer afterward.
  await purge('orders.customer_id', () =>
    sb.from('orders').update({ customer_id: null }).eq('customer_id', customerId).eq('business_id', businessId));

  await purge('customer_memory', () =>
    sb.from('customer_memory').delete().eq('customer_id', customerId).eq('business_id', businessId));
  await purge('messages', () =>
    sb.from('messages').delete().eq('customer_id', customerId).eq('business_id', businessId));
  await purge('conversations', () =>
    sb.from('conversations').delete().eq('customer_id', customerId).eq('business_id', businessId));
  await purge('customers', () =>
    sb.from('customers').delete().eq('id', customerId).eq('business_id', businessId));

  return true;
}
