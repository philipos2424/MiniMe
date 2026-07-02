/**
 * POST /api/onboarding/signup
 *
 * The explicit account-creation + consent moment at the top of the mini-app
 * funnel. The bot's /start now routes new users straight here (the mini-app is
 * the single front door), so this is where the `businesses` row is created on
 * purpose — instead of the old silent lazy-create — and where we record the
 * owner's consent (terms + AI-disclosure) for the GDPR / Ethiopia-PDP audit
 * trail.
 *
 * Idempotent: re-tapping "Let's go" or re-entering the wizard finds the existing
 * business and never overwrites the original consent timestamp.
 *
 * Returns: { business } so the client can setBusiness(...) immediately.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bump when the terms / AI-disclosure copy materially changes so we can tell
// which version each owner agreed to.
const CONSENT_VERSION = '2026-06-v1';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Find or create the business (idempotent) — same lazy-create shape used by
  // /api/onboarding/interview so the row is identical whichever path runs first.
  let business = await findByOwnerTelegramId(tg.id);
  if (!business) {
    const ownerName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null;
    business = await createBusiness({
      owner_telegram_id: tg.id,
      owner_name: ownerName,
      owner_username: tg.username || null,
      name: tg.first_name ? `${tg.first_name}'s Business` : 'My Business',
      workspace_type: 'business',
      onboarding_completed: false,
      brain_mode: true,
      trust_level: 2,
      shop_code: generateShopCode(),
      consent_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
    });
    if (!business) return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  } else if (!business.consent_at) {
    // Existing row (e.g. created by an earlier interview call) without consent —
    // record it now. Only set once; never overwrite an existing timestamp.
    const { data } = await supabase()
      .from('businesses')
      .update({ consent_at: new Date().toISOString(), consent_version: CONSENT_VERSION })
      .eq('id', business.id)
      .select('*')
      .single();
    if (data) business = data;
  }

  return NextResponse.json({ business });
}
