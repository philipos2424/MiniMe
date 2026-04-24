/**
 * GET /api/agent/brain  → { enabled: boolean, recent: [thought] }
 * POST /api/agent/brain → body {enabled: boolean} → flip brain_mode
 *
 * Brain mode turns on Alfred's autonomous tool-calling loop.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function auth(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findByOwnerTelegramId(tg.id) : null;
}

export async function GET(request) {
  const business = await auth(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = supabase();
  const { data: recent } = await sb.from('agent_thoughts')
    .select('id, trigger, outcome, tool_calls, created_at, duration_ms')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(15);
  return NextResponse.json({ enabled: !!business.brain_mode, recent: recent || [] });
}

export async function POST(request) {
  const business = await auth(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const enabled = !!body.enabled;
  await supabase().from('businesses').update({ brain_mode: enabled }).eq('id', business.id);
  return NextResponse.json({ enabled });
}
