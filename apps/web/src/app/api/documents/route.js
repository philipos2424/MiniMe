import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resolveBusiness(initData) {
  if (!initData) return { error: 'No initData', status: 401 };
  const valid = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (!valid) return { error: 'Invalid Telegram data', status: 401 };
  const user = parseTelegramUser(initData);
  if (!user) return { error: 'No user', status: 400 };
  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_telegram_id', user.id)
    .single();
  if (!business) return { error: 'No business', status: 404 };
  return { business };
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  const r = await resolveBusiness(initData);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  const { data } = await supabase
    .from('documents')
    .select('*')
    .eq('business_id', r.business.id)
    .order('created_at', { ascending: false });
  return NextResponse.json({ documents: data || [] });
}

export async function DELETE(request) {
  const initData = request.headers.get('x-telegram-init-data');
  const r = await resolveBusiness(initData);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('business_id', r.business.id)
    .single();
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (doc.storage_path) {
    await supabase.storage.from('documents').remove([doc.storage_path]);
  }
  await supabase.from('documents').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
