/**
 * PATCH  /api/agent/team/[id]  → update a team member's fields
 * DELETE /api/agent/team/[id]  → soft-delete (is_active=false)
 *
 * Both enforce that supplier.business_id matches the authenticated caller.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'];

async function resolveBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return null;
  return findBusinessForUser(tg.id);
}

async function ownedSupplier(businessId, id) {
  const { data } = await supabase().from('suppliers').select('id, business_id').eq('id', id).maybeSingle();
  if (!data) return null;
  if (data.business_id !== businessId) return null;
  return data;
}

export async function PATCH(request, { params }) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const existing = await ownedSupplier(business.id, params.id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const update = {};
  if (body.name !== undefined) update.name = String(body.name).trim();
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });
    update.role = body.role;
  }
  if (body.telegramUsername !== undefined) {
    update.telegram_username = body.telegramUsername
      ? String(body.telegramUsername).replace(/^@/, '').trim() : null;
  }
  if (body.telegramId !== undefined) {
    const n = body.telegramId ? Number(body.telegramId) : null;
    update.contact_telegram = Number.isFinite(n) ? n : null;
  }
  if (body.phone !== undefined) update.contact_phone = body.phone ? String(body.phone).trim() : null;
  if (body.specialties !== undefined) update.specialties = body.specialties ? String(body.specialties).trim() : null;
  if (body.notes !== undefined) update.notes = body.notes ? String(body.notes).trim() : null;
  if (body.contactChannel !== undefined) {
    // 'auto' (default) = personal when proven reachable, else the bot; 'bot'
    // forces the bot always; 'personal' still falls back to the bot on a
    // failed send (sendAsOwnerOrBot never drops a message silently) — it just
    // expresses a preference to try personal first.
    if (!['auto', 'bot', 'personal'].includes(body.contactChannel)) {
      return NextResponse.json({ error: 'invalid contactChannel' }, { status: 400 });
    }
    update.contact_channel = body.contactChannel;
  }
  if (body.maxDailyTasks !== undefined) {
    const n = Number(body.maxDailyTasks);
    update.max_daily_tasks = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  if (body.activeHours !== undefined) {
    // "HH:MM-HH:MM" (EAT wall-clock) or null to clear. Validated loosely here;
    // delegationLogic.parseActiveHours treats anything malformed as "no window".
    update.active_hours = body.activeHours ? String(body.activeHours).trim() : null;
  }

  const { data, error } = await supabase().from('suppliers')
    .update(update).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ member: data });
}

export async function DELETE(request, { params }) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const existing = await ownedSupplier(business.id, params.id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { error } = await supabase().from('suppliers')
    .update({ is_active: false }).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
