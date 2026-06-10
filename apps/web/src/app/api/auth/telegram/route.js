import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { createClient } from '@supabase/supabase-js';
import { noStoreFetch } from '../../../../lib/server/db';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { global: { fetch: noStoreFetch } }
);

export async function POST(request) {
  try {
    const { initData } = await request.json();

    if (!initData) {
      return NextResponse.json({ error: 'No initData provided' }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const isValid = verifyTelegramInitData(initData, botToken);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid Telegram data' }, { status: 401 });
    }

    const telegramUser = parseTelegramUser(initData);
    if (!telegramUser) {
      return NextResponse.json({ error: 'No user data' }, { status: 400 });
    }

    // Find the business for this Telegram user
    const { data: business } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_telegram_id', telegramUser.id)
      .single();

    // Keep the owner's Telegram @username fresh — it's not part of signup
    // historically, and people rename. Fire-and-forget; never blocks auth.
    if (business && telegramUser.username && telegramUser.username !== business.owner_username) {
      supabase
        .from('businesses')
        .update({ owner_username: telegramUser.username })
        .eq('id', business.id)
        .then(() => {}, () => {});
    }

    return NextResponse.json({
      success: true,
      telegramUser,
      business: business || null,
    });
  } catch (error) {
    console.error('Telegram auth error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
