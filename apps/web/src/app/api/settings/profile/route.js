/**
 * PATCH /api/settings/profile
 * Update the business profile (name, category, website, address, etc.).
 *
 * All URL fields are validated for SSRF (no private IPs), all text fields
 * have length caps, and phone numbers are stripped of dangerous characters.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { str, name as nameVal, url as urlVal, oneOf, ValidationError, validationResponse } from '../../../../lib/server/sanitize';
import { generateAutoTags, generateSearchEmbedding } from '../../../../lib/server/openai-wrapper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CATEGORIES = [
  // Spec taxonomy (14 + other)
  'branding_design', 'printing_signage', 'photography_video', 'catering_food',
  'food_beverage', 'it_tech', 'events_entertainment', 'clothing_fashion',
  'beauty_wellness', 'construction_interior', 'transport_delivery',
  'training_consulting', 'wholesale_supply', 'electronics_phones', 'other',
  // Legacy (accepted for backwards compat)
  'food', 'fashion', 'beauty', 'electronics', 'grocery', 'services', 'crafts',
  'education', 'health', 'entertainment', 'retail', 'hospitality', 'logistics',
  'real_estate', 'consulting', 'tech',
];

export async function PATCH(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const updates = {};

  try {
    if (body.name !== undefined)
      updates.name = nameVal(body.name, { field: 'name', min: 1, max: 100, required: true });

    if (body.category !== undefined)
      updates.category = oneOf(body.category, ALLOWED_CATEGORIES, { field: 'category' });

    if (body.categories !== undefined) {
      // Accept array of up to 3 valid categories
      if (!Array.isArray(body.categories)) throw new Error('categories must be an array');
      const cleaned = body.categories
        .map(c => String(c).trim())
        .filter(c => ALLOWED_CATEGORIES.includes(c))
        .slice(0, 3);
      updates.categories = cleaned;
      // Keep primary category in sync with first element
      if (cleaned.length > 0 && !updates.category) updates.category = cleaned[0];
    }

    if (body.description !== undefined)
      updates.description = str(body.description, { field: 'description', max: 1000, required: false });

    if (body.address !== undefined)
      updates.address = str(body.address, { field: 'address', max: 300, required: false });

    if (body.phone !== undefined) {
      // Strip all non-phone characters (allow digits, +, -, spaces, parentheses)
      const rawPhone = String(body.phone || '').replace(/[^0-9+\-() ]/g, '').slice(0, 20);
      updates.phone = rawPhone || null;
    }

    if (body.website !== undefined)
      updates.website = body.website ? urlVal(body.website, { field: 'website' }) : null;

    if (body.instagram !== undefined)
      updates.instagram = body.instagram ? urlVal(body.instagram, { field: 'instagram' }) : null;

    if (body.facebook !== undefined)
      updates.facebook = body.facebook ? urlVal(body.facebook, { field: 'facebook' }) : null;

    if (body.tiktok !== undefined)
      updates.tiktok = body.tiktok ? urlVal(body.tiktok, { field: 'tiktok' }) : null;

    if (body.portfolio_url !== undefined)
      updates.portfolio_url = body.portfolio_url ? urlVal(body.portfolio_url, { field: 'portfolio_url' }) : null;

    if (body.whatsapp !== undefined) {
      const wa = String(body.whatsapp || '').replace(/[^0-9+]/g, '').slice(0, 20);
      updates.whatsapp = wa || null;
    }

    if (body.telegram_channel !== undefined) {
      // Telegram channel: allow @handle or t.me/handle
      const ch = String(body.telegram_channel || '').replace(/[^a-zA-Z0-9_@./]/g, '').slice(0, 100);
      updates.telegram_channel = ch || null;
    }

    if (body.tagline !== undefined)
      updates.tagline = str(body.tagline, { field: 'tagline', max: 50, required: false });

    if (body.location !== undefined)
      updates.location = str(body.location, { field: 'location', max: 200, required: false });

    if (body.owner_name !== undefined)
      updates.owner_name = nameVal(body.owner_name, { field: 'owner_name', max: 100, required: false });

    if (body.language !== undefined)
      updates.language = oneOf(body.language, ['en', 'am', 'ar', 'fr', 'om', 'ti', 'auto'], { field: 'language' });

    if (body.workspace_type !== undefined)
      updates.workspace_type = oneOf(body.workspace_type, ['personal', 'business'], { field: 'workspace_type' });

  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const { data: updated, error } = await supabase()
    .from('businesses')
    .update(updates)
    .eq('id', business.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire-and-forget: regenerate AI tags + search embedding on ANY profile change
  // (name, description, category, tags, location all affect search relevance)
  if (updated) {
    const seed = [updated.name, updated.category, updated.description, ...(updated.tags || [])].filter(Boolean).join(' — ');
    if (seed.trim()) {
      generateAutoTags(business.id, seed).catch(() => {});
      generateSearchEmbedding(business.id, seed).catch(() => {}); // fetches products internally
    }
  }

  return NextResponse.json({ ok: true, business: updated });
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ business });
}
