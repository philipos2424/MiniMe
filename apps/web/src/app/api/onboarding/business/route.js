/**
 * POST /api/onboarding/business
 * Body: { name, workspace_type }
 *
 * Creates (or updates) a business row for the signed-in Telegram owner.
 * Idempotent — safe to call multiple times during onboarding.
 * On first creation, seeds category-specific sample replies and owner instructions.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, update as updateBusiness, generateShopCode } from '../../../../lib/server/businesses';
import { getCategoryTemplate } from '../../../../lib/server/categoryTemplates';
import { name as nameVal, oneOf, str, ValidationError, validationResponse } from '../../../../lib/server/sanitize';
import { generateAutoTags, generateSearchEmbedding } from '../../../../lib/server/openai-wrapper';

const ALLOWED_CATEGORIES = [
  'branding_design', 'printing_signage', 'photography_video', 'catering_food',
  'food_beverage', 'it_tech', 'events_entertainment', 'clothing_fashion',
  'beauty_wellness', 'construction_interior', 'transport_delivery',
  'training_consulting', 'wholesale_supply', 'electronics_phones', 'other',
  // Legacy
  'food', 'fashion', 'beauty', 'electronics', 'grocery', 'services', 'crafts',
  'education', 'health', 'entertainment', 'retail', 'hospitality', 'logistics',
  'real_estate', 'consulting', 'tech',
];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  let name, workspace_type, category;
  try {
    name           = nameVal(body.name, { field: 'name', min: 1, max: 100, required: true });
    workspace_type = oneOf(body.workspace_type, ['personal', 'business'], { field: 'workspace_type', required: false }) || 'business';
    // Category is optional — validate against allowlist if provided
    category = body.category
      ? (oneOf(body.category, ALLOWED_CATEGORIES, { field: 'category' }) || null)
      : null;
    // Description is optional — validated for length
    var description = body.description
      ? str(body.description, { field: 'description', max: 1000, required: false })
      : null;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const existing = await findByOwnerTelegramId(tg.id);
  if (existing) {
    const updates = { name, workspace_type };
    if (description !== undefined && description !== null) updates.description = description;
    if (category) {
      updates.category = category;
      // If category changed and they had no custom instructions yet, seed the new template
      const categoryChanged = category !== existing.category;
      const hasNoCustomInstructions = !(existing.owner_instructions?.length > 0) ||
        existing.owner_instructions.every(r => r.source === 'category_template');
      if (categoryChanged && hasNoCustomInstructions) {
        const tmpl = getCategoryTemplate(category);
        if (tmpl.sampleReplies?.length) updates.sample_replies = tmpl.sampleReplies;
        if (tmpl.ownerInstructions?.length) {
          updates.owner_instructions = tmpl.ownerInstructions.map(r => ({ ...r, created_at: new Date().toISOString() }));
        }
      }
    }
    const updated = await updateBusiness(existing.id, updates);
    return NextResponse.json({ ok: true, business: updated || existing });
  }

  // Seed category-specific sample replies and owner instructions so the bot
  // immediately knows how to behave for this type of business.
  const tmpl = getCategoryTemplate(category);
  const created = await createBusiness({
    owner_telegram_id: tg.id,
    owner_name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null,
    name,
    workspace_type,
    category,
    description,
    onboarding_completed: false,
    brain_mode: true,
    trust_level: 2,
    shop_code: generateShopCode(),
    // Pre-seed category intelligence
    sample_replies: tmpl.sampleReplies?.length ? tmpl.sampleReplies : [],
    owner_instructions: tmpl.ownerInstructions?.length
      ? tmpl.ownerInstructions.map(r => ({ ...r, created_at: new Date().toISOString() }))
      : [],
  });
  if (!created) return NextResponse.json({ error: 'create failed' }, { status: 500 });

  // Fire-and-forget: generate AI tags + search embedding from name + category + description
  const tagSeed = [name, category, description].filter(Boolean).join(' — ');
  if (tagSeed.trim()) {
    generateAutoTags(created.id, tagSeed).catch(() => {});
    generateSearchEmbedding(created.id, tagSeed).catch(() => {});
  }

  // Notify platform admin of new signup
  const adminId  = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && botToken) {
    const ownerName = created.owner_name || tg.first_name || 'Unknown';
    const categoryLabel = category ? ` · ${category}` : '';
    const tgHandle = tg.username ? ` (@${tg.username})` : '';
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminId,
        parse_mode: 'Markdown',
        text: `🆕 *New signup!*\n\n🏪 *${name}*${categoryLabel}\n👤 ${ownerName}${tgHandle}\n🆔 Telegram ID: \`${tg.id}\`\n📋 Plan: trial\n\n_Onboarding started — bot not yet connected._`,
      }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, business: created });
}
