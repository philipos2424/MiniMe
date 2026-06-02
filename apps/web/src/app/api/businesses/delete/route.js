/**
 * POST /api/businesses/delete
 * Account deletion — backs the privacy policy promise that deleting an account
 * removes personal data within 30 days. This executes immediately.
 *
 * Approach: ANONYMIZE-AND-CLOSE (not a hard row delete).
 *   - Purges personal / content data scoped to the business:
 *       customer_memory, messages, conversations, customers,
 *       documents, document_chunks, agent_thoughts, suppliers, discounts, products
 *   - Strips the business row of credentials + PII:
 *       telegram_bot_token_enc, webhook_secret, telegram_biz_conn_id,
 *       telegram_bot_username, phone, website, instagram, facebook, name
 *   - Sets panic_mode = true so the reply engine goes silent on every channel
 *     immediately, and detaches all channel links so no inbound can route in.
 *   - Stamps notification_prefs.account_deleted_at as a tombstone.
 *
 * PRESERVES (lawful basis / legal obligation):
 *   - orders            — accounting records
 *   - audit_logs        — security/compliance trail (separate retention)
 * These are anonymized at the customer layer (customer rows are deleted, but the
 * order rows themselves carry no live PII beyond what the merchant entered).
 *
 * Two-step for safety: POST starts the request and returns a confirmation token.
 * POST with { confirm: true, token } executes the deletion.
 * OWNER-ONLY (sub-admins cannot delete the account).
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { requireOwner } from '../../../../lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// In-memory confirmation tokens (TTL 10 minutes). In production, use Redis.
const pendingDeletions = new Map();

// Sensitive columns to clear from the business row IF they exist on the fetched
// row. Picking from the live row avoids PGRST204 on schema differences.
const SENSITIVE_BUSINESS_FIELDS = [
  'telegram_bot_token_enc',
  'webhook_secret',
  'telegram_biz_conn_id',
  'telegram_bot_username',
  'phone',
  'website',
  'instagram',
  'facebook',
];

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the account owner can delete the account.' }, { status: 403 });
  }

  const sb = supabase();
  const body = await request.json().catch(() => ({}));

  // ── Step 2: confirmed — execute deletion ──────────────────────────────────
  if (body.confirm && body.token) {
    const entry = pendingDeletions.get(body.token);
    if (!entry || entry.business_id !== business.id) {
      return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 400 });
    }
    if (Date.now() > entry.expires_at) {
      pendingDeletions.delete(body.token);
      return NextResponse.json({ error: 'token_expired' }, { status: 400 });
    }
    pendingDeletions.delete(body.token);

    const bid = business.id;

    // 1) Purge document chunks first (FK to documents), then documents.
    //    Each wrapped so one missing table never aborts the whole purge.
    const purge = async (table, builder) => {
      try { await builder(); }
      catch (e) { console.warn(`[business.delete] purge ${table} failed:`, e.message); }
    };

    await purge('document_chunks', () => sb.from('document_chunks').delete().eq('business_id', bid));
    await purge('documents',        () => sb.from('documents').delete().eq('business_id', bid));
    await purge('customer_memory',  () => sb.from('customer_memory').delete().eq('business_id', bid));
    await purge('messages',         () => sb.from('messages').delete().eq('business_id', bid));
    await purge('conversations',    () => sb.from('conversations').delete().eq('business_id', bid));
    await purge('customers',        () => sb.from('customers').delete().eq('business_id', bid));
    await purge('products',         () => sb.from('products').delete().eq('business_id', bid));
    await purge('discounts',        () => sb.from('discounts').delete().eq('business_id', bid));
    await purge('suppliers',        () => sb.from('suppliers').delete().eq('business_id', bid));
    await purge('agent_thoughts',   () => sb.from('agent_thoughts').delete().eq('business_id', bid));

    // 2) Anonymize + lock the business row. Only touch fields that exist on the
    //    fetched row to avoid PGRST204 on unknown columns.
    const updates = {};
    if ('name' in business) updates.name = 'Deleted business';
    if ('panic_mode' in business) updates.panic_mode = true;
    for (const f of SENSITIVE_BUSINESS_FIELDS) {
      if (f in business) updates[f] = null;
    }
    // Tombstone in notification_prefs (always-present JSON column).
    updates.notification_prefs = {
      ...(business.notification_prefs || {}),
      account_deleted_at: new Date().toISOString(),
      // Strip personal contacts + broadcast/owner config on close
      personal_contacts: [],
      broadcast_history: [],
    };

    const { error: updErr } = await sb.from('businesses').update(updates).eq('id', bid);
    if (updErr) {
      console.error('[business.delete] business row update failed:', updErr.message);
      return NextResponse.json({ error: 'delete_failed', detail: updErr.message }, { status: 500 });
    }

    // 3) BEST-EFFORT owner detach — so a returning user falls cleanly into fresh
    //    onboarding instead of a ghost dashboard. Done as a SEPARATE update that
    //    is allowed to fail (e.g. owner_telegram_id may be NOT NULL): the GDPR
    //    purge above is already committed and must not depend on this.
    try {
      const detach = {};
      if ('owner_telegram_id' in business) detach.owner_telegram_id = null;
      if ('sub_admin_telegram_ids' in business) detach.sub_admin_telegram_ids = [];
      if ('shop_code' in business) detach.shop_code = null;
      if (Object.keys(detach).length) {
        const { error: detErr } = await sb.from('businesses').update(detach).eq('id', bid);
        if (detErr) console.warn('[business.delete] owner detach skipped (non-fatal):', detErr.message);
      }
    } catch (e) { console.warn('[business.delete] owner detach threw (non-fatal):', e.message); }

    await audit({
      business_id: bid, actor_type: 'owner', actor_id: String(tg.id),
      action: 'business.deleted', resource_type: 'business', resource_id: bid,
      metadata: { original_name: entry.business_name, method: 'anonymize_and_close' }, request,
    });

    return NextResponse.json({
      ok: true,
      message: 'Account closed. Personal data has been deleted. Orders and audit records are retained as required for accounting and legal compliance.',
    });
  }

  // ── Step 1: generate confirmation token ───────────────────────────────────
  const token = crypto.randomBytes(16).toString('hex');
  pendingDeletions.set(token, {
    business_id: business.id,
    business_name: business.name,
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  return NextResponse.json({
    ok: true,
    warning: 'This permanently deletes your account and all personal data (customers, conversations, messages, documents, products). Your order history and audit log are retained for accounting and legal compliance. This cannot be undone.',
    confirm_token: token,
    expires_in_minutes: 10,
    business: { id: business.id, name: business.name },
  });
}
