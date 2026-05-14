/**
 * GET  /api/agent/team  → list active suppliers (team members) for the business
 * POST /api/agent/team  → add a team member
 *
 * Auth: x-telegram-init-data (same pattern as /api/agent/jobs).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

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

export async function GET(request) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase()
    .from('suppliers')
    .select('*')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .order('role', { ascending: true, nullsFirst: false })
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ team: data || [] });
}

export async function POST(request) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name || '').trim();
  const role = (body.role || '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });

  const telegramId = body.telegramId ? Number(body.telegramId) : null;
  const insert = {
    business_id: business.id,
    name,
    role,
    telegram_username: body.telegramUsername ? String(body.telegramUsername).replace(/^@/, '').trim() : null,
    contact_telegram: Number.isFinite(telegramId) ? telegramId : null,
    contact_phone: body.phone ? String(body.phone).trim() : null,
    specialties: body.specialties ? String(body.specialties).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    is_active: true,
  };

  const { data, error } = await supabase().from('suppliers').insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ member: data });
}
