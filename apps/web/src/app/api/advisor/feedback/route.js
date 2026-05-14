/**
 * POST /api/advisor/feedback
 * Body: { helpful: boolean, note?: string, target_id?: string }
 * Records thumbs-up/down feedback on an advisor response.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.helpful !== 'boolean') {
    return NextResponse.json({ error: 'helpful (boolean) required' }, { status: 400 });
  }

  const row = {
    business_id: business.id,
    source: 'advisor_reply',
    helpful: body.helpful,
    ...(body.target_id ? { target_id: body.target_id } : {}),
    ...(body.note ? { note: String(body.note).slice(0, 500) } : {}),
  };

  const sb = supabase();
  const { error } = await sb.from('feedback').insert(row);
  if (error) {
    console.warn('feedback insert:', error.message);
  }

  return NextResponse.json({ ok: true });
}