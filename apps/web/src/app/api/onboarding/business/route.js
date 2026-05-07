/**
 * POST /api/onboarding/business
 * Body: { name, workspace_type }
 *
 * Creates (or updates) a business row for the signed-in Telegram owner.
 * Idempotent — safe to call multiple times during onboarding.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, create as createBusiness, update as updateBusiness } from '../../../../lib/server/businesses';

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
  const name = (body.name || '').trim();
  const workspace_type = ['personal', 'business'].includes(body.workspace_type) ? body.workspace_type : 'business';
  const category = (body.category || '').trim() || null;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const existing = await findByOwnerTelegramId(tg.id);
  if (existing) {
    const updates = { name, workspace_type };
    if (category) updates.category = category;
    const updated = await updateBusiness(existing.id, updates);
    return NextResponse.json({ ok: true, business: updated || existing });
  }

  const created = await createBusiness({
    owner_telegram_id: tg.id,
    owner_name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || null,
    name,
    workspace_type,
    category,
    onboarding_completed: false,
  });
  if (!created) return NextResponse.json({ error: 'create failed' }, { status: 500 });
  return NextResponse.json({ ok: true, business: created });
}
