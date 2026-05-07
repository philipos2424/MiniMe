import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../../lib/server/businesses';
import { findJobById } from '../../../../../lib/server/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const job = await findJobById(params.id);
  if (!job || job.business_id !== business.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Preflight: for each non-passive step, show whether a DM-able supplier exists.
  const sb = (await import('../../../../../lib/server/db')).supabase();
  const { data: suppliers } = await sb.from('suppliers')
    .select('role, contact_telegram, is_active, name')
    .eq('business_id', business.id);
  const byRole = {};
  for (const s of suppliers || []) {
    if (!s.is_active) continue;
    (byRole[s.role] ||= []).push(s);
  }
  const preflight = (job.steps || []).map(st => {
    if (!st.auto || st.role === 'agent' || st.role === 'client') {
      return { step_id: st.id, role: st.role, ready: true, reason: 'passive' };
    }
    const matches = byRole[st.role] || [];
    if (!matches.length) return { step_id: st.id, role: st.role, ready: false, reason: `no ${st.role} on team` };
    const dmAble = matches.filter(m => m.contact_telegram);
    if (!dmAble.length) return { step_id: st.id, role: st.role, ready: false, reason: `${matches[0].name} has no Telegram ID` };
    return { step_id: st.id, role: st.role, ready: true, reason: `will DM ${dmAble[0].name}` };
  });

  return NextResponse.json({ job, preflight });
}

export async function DELETE(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = (await import('../../../../../lib/server/db')).supabase();
  const { data: job } = await sb.from('jobs').select('id, business_id').eq('id', params.id).maybeSingle();
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.business_id !== business.id) return NextResponse.json({ error: 'wrong business' }, { status: 403 });

  const { error } = await sb.from('jobs').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
