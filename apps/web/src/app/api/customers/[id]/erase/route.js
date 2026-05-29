/**
 * POST /api/customers/[id]/erase
 * GDPR Article 17 — Right to Erasure.
 *
 * Anonymizes the customer record:
 *   - name → 'Deleted customer'
 *   - phone → null
 *   - telegram_id → null (detaches from Telegram)
 *   - telegram_username → null
 *   - birthday, tags, ai_notes, owner_notes → cleared
 *   - customer_memory → deleted
 *   - inbound messages content → '[deleted]'
 *
 * Preserves: orders (accounting records), order totals, timestamps.
 * The customer row itself is kept with a tombstone name for referential integrity.
 *
 * Two-step for safety: POST starts the request, returns a confirmation token.
 * POST with { confirm: true, token } executes the erasure.
 * Owner-authenticated only.
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';
import { requireOwner } from '../../../../../lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory confirmation tokens (TTL 10 minutes). In production, use Redis.
const pendingErasures = new Map();

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can erase customer data.' }, { status: 403 });
  }

  const sb = supabase();
  const { data: customer } = await sb.from('customers')
    .select('id, name, telegram_id').eq('id', params.id).eq('business_id', business.id).single();
  if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Step 2: Confirmed — execute erasure
  if (body.confirm && body.token) {
    const entry = pendingErasures.get(body.token);
    if (!entry || entry.customer_id !== params.id || entry.business_id !== business.id) {
      return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 400 });
    }
    if (Date.now() > entry.expires_at) {
      pendingErasures.delete(body.token);
      return NextResponse.json({ error: 'token_expired' }, { status: 400 });
    }
    pendingErasures.delete(body.token);

    // Execute erasure
    await Promise.all([
      // Anonymize customer profile
      sb.from('customers').update({
        name: 'Deleted customer',
        phone: null,
        telegram_id: null,
        telegram_username: null,
        birthday: null,
        tags: null,
        ai_notes: null,
        owner_notes: null,
        special_dates: null,
      }).eq('id', params.id).eq('business_id', business.id),
      // Delete AI-extracted facts
      sb.from('customer_memory').delete().eq('customer_id', params.id).eq('business_id', business.id),
    ]);

    // Anonymize inbound messages (keep outbound for AI training quality)
    await sb.from('messages')
      .update({ content: '[deleted by GDPR request]' })
      .eq('customer_id', params.id)
      .eq('business_id', business.id)
      .eq('direction', 'inbound');

    await audit({
      business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
      action: 'customer.erased', resource_type: 'customer', resource_id: params.id,
      metadata: { original_name: customer.name, original_telegram_id: customer.telegram_id }, request,
    });

    return NextResponse.json({ ok: true, message: 'Customer data anonymized. Orders preserved for accounting.' });
  }

  // Step 1: Generate confirmation token
  const token = crypto.randomBytes(16).toString('hex');
  pendingErasures.set(token, {
    customer_id: params.id,
    business_id: business.id,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  return NextResponse.json({
    ok: true,
    warning: `This will permanently anonymize ${customer.name}'s personal data. Orders are preserved for accounting. This cannot be undone.`,
    confirm_token: token,
    expires_in_minutes: 10,
    customer: { id: customer.id, name: customer.name },
  });
}
