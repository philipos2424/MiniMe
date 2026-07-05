/**
 * POST /api/business/update
 *
 * SECURITY-CRITICAL: This is the single authenticated entry point for ALL
 * browser-side writes to the `businesses` table. We introduced it during the
 * pre-launch security audit so we could lock down RLS to service-role-only
 * without rewriting 15+ scattered direct-Supabase writes individually.
 *
 * Auth: Telegram initData (HMAC verified). The endpoint NEVER takes a
 * business_id from the client — it ALWAYS resolves the caller's own business
 * from their Telegram ID. This prevents cross-tenant writes even if RLS
 * somehow regresses.
 *
 * Field whitelist: only the fields explicitly listed in ALLOWED_FIELDS can be
 * written. Anything else is dropped silently (logged for audit). This prevents
 * an attacker who somehow bypasses CSRF from writing to sensitive columns like
 * `telegram_bot_token_enc`, `subscription_status`, `trial_ends_at`, etc.
 *
 * Body shape:
 *   { updates: { [field]: value, ... } }
 *
 * The body uses a single `updates` envelope (not flat fields) so adding new
 * allowed fields doesn't require call-site changes — callers always send the
 * same shape.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Field whitelist ─────────────────────────────────────────────────────────
// ONLY these columns can be written via this endpoint. To add a new one,
// confirm it's not security-sensitive (no auth/billing/tokens) and add here.
//
// NEVER add: telegram_bot_token_enc, webhook_secret, subscription_status,
//   subscription_plan, trial_ends_at, trial_started_at, owner_telegram_id,
//   sub_admin_telegram_ids, telegram_biz_conn_id, shop_code (auto-generated),
//   stripe_*, chapa_*, role, is_admin, ai_disclosed_business_ids.
const ALLOWED_FIELDS = new Set([
  // Profile + branding (Settings → Profile, Card)
  'name', 'description', 'category', 'categories', 'location', 'address',
  'business_hours', 'currency', 'website', 'instagram', 'tiktok', 'facebook',
  'telegram_channel', 'whatsapp', 'email', 'owner_phone', 'owner_name',
  'portfolio_url',
  // Voice / personalization (Settings → Voice, Character, Personalize)
  'voice_embedding', 'sample_replies', 'owner_instructions',
  'tone', 'languages',
  // AI behavior + brain (Settings → Modes, Trust, FAQ)
  'brain_mode', 'trust_level', 'trust_promoted_at',
  'panic_mode', 'panic_activated_at',
  'notification_prefs', 'workspace_type',
  // Catalog + discovery (Settings → Search)
  'b2b_discoverable', 'b2b_directory_opt_in', 'b2b_tags',
  // B2B network (Settings → Network)
  'b2b_auto_negotiate', 'b2b_blocklist',
  // Misc
  'tags', 'auto_tags', 'social_links',
]);

// Fields that are JSONB and MUST be objects/arrays — sanity check so a string
// or number can't sneak through and corrupt the column type.
const JSONB_FIELDS = new Set([
  'voice_embedding', 'notification_prefs', 'social_links', 'auto_tags',
  'owner_instructions', 'sample_replies', 'b2b_tags', 'tags',
  'b2b_blocklist', 'categories', 'languages',
]);

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Resolve THE CALLER'S OWN business from their Telegram ID — never trust a
  // client-supplied business_id. This is the cross-tenant write defense even
  // if RLS ever regresses or the whitelist is bypassed.
  const business = await findByOwnerTelegramId(tg.id);
  if (!business) return NextResponse.json({ error: 'no_business' }, { status: 404 });

  let body = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const raw = body?.updates;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'updates_required' }, { status: 400 });
  }

  // Filter to whitelist + sanity-check JSONB types
  const updates = {};
  const dropped = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_FIELDS.has(k)) {
      dropped.push(k);
      continue;
    }
    if (JSONB_FIELDS.has(k) && v != null && typeof v !== 'object') {
      dropped.push(`${k} (type)`);
      continue;
    }
    updates[k] = v;
  }
  if (dropped.length) {
    // Don't 4xx — silently drop AND log so legitimate callers can iterate
    // without breaking, but an attacker probing fields is visible in logs.
    console.warn(`[business/update] biz=${business.id} dropped fields:`, dropped.join(', '));
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, business, dropped }, { status: 200 });
  }

  const updated = await updateBusiness(business.id, updates);
  if (!updated) {
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Audit trail: panic_mode is just a boolean on the row — log the transition
  // itself so there's a history of when/why a business went dark.
  if ('panic_mode' in updates && !!updates.panic_mode !== !!business.panic_mode) {
    supabase().from('panic_events').insert({
      business_id: business.id,
      trigger_reason: 'owner_request',
      activated: !!updates.panic_mode,
      actor_type: 'owner',
    }).then(() => {}, e => console.warn('[panic_events] insert failed:', e.message));
  }

  return NextResponse.json({ ok: true, business: updated, dropped });
}
