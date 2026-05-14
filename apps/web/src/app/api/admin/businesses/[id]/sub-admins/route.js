/**
 * POST   /api/admin/businesses/:id/sub-admins  — add a sub-admin Telegram ID
 * DELETE /api/admin/businesses/:id/sub-admins  — remove a sub-admin Telegram ID
 * Body: { telegram_id: number }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { isAdmin } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function POST(request, { params }) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body = {};
  try { body = await request.json(); } catch {}
  const tid = Number(body.telegram_id);
  if (!Number.isFinite(tid) || tid <= 0) {
    return NextResponse.json({ error: 'invalid telegram_id' }, { status: 400 });
  }
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('id, sub_admin_telegram_ids, owner_telegram_id').eq('id', params.id).maybeSingle();
  if (!biz) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (Number(biz.owner_telegram_id) === tid) {
    return NextResponse.json({ error: 'That Telegram ID is already the business owner' }, { status: 400 });
  }
  const current = biz.sub_admin_telegram_ids || [];
  if (current.includes(tid)) {
    return NextResponse.json({ ok: true, sub_admin_telegram_ids: current });
  }
  const updated = [...current, tid];
  const { error } = await sb.from('businesses').update({ sub_admin_telegram_ids: updated }).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sub_admin_telegram_ids: updated });
}

export async function DELETE(request, { params }) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body = {};
  try { body = await request.json(); } catch {}
  const tid = Number(body.telegram_id);
  if (!Number.isFinite(tid) || tid <= 0) {
    return NextResponse.json({ error: 'invalid telegram_id' }, { status: 400 });
  }
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select('id, sub_admin_telegram_ids').eq('id', params.id).maybeSingle();
  if (!biz) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const updated = (biz.sub_admin_telegram_ids || []).filter(id => Number(id) !== tid);
  const { error } = await sb.from('businesses').update({ sub_admin_telegram_ids: updated }).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sub_admin_telegram_ids: updated });
}
