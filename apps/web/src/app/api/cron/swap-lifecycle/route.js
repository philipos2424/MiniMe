/**
 * GET /api/cron/swap-lifecycle
 *
 * Daily. Asks listers whether they still have an item before its post ages
 * out, asks whether a swap happened three days after the first handle reveal,
 * and retires posts that answered neither.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { runSwapLifecycle } from '../../../../lib/server/swap/swapLifecycle.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.SEARCH_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: true, skipped: 'no SEARCH_BOT_TOKEN' });

  const send = async ({ chatId, text, keyboard }) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: 'Markdown',
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      }),
    });
    const j = await r.json();
    if (!j?.ok) throw new Error(j?.description || 'send failed');
  };

  const result = await runSwapLifecycle(supabase(), { send });
  return NextResponse.json({ ok: true, ...result });
}
