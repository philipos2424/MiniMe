/**
 * GET /api/admin/check-webhooks
 * Checks Telegram's actual webhook info for every bot — shows pending updates,
 * last errors, and whether the URL is correct.
 * Protected by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } });
  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, telegram_bot_token_enc, webhook_secret')
    .not('telegram_bot_token_enc', 'is', null);

  const expected = (process.env.WEB_URL || 'https://web-theta-one-68.vercel.app').trim();
  const results = [];

  for (const biz of businesses || []) {
    try {
      const token = decrypt(biz.telegram_bot_token_enc);
      const [meRes, whRes] = await Promise.all([
        fetch(`https://api.telegram.org/bot${token}/getMe`).then(r => r.json()),
        fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then(r => r.json()),
      ]);

      const wh = whRes.result || {};
      const urlOk = wh.url?.startsWith(expected);

      results.push({
        name: biz.name,
        bot: biz.telegram_bot_username,
        token_valid: meRes.ok === true,
        webhook_url_ok: urlOk,
        pending: wh.pending_update_count ?? '?',
        last_error: wh.last_error_message || null,
        status: meRes.ok && urlOk ? '✅' : '❌',
      });
    } catch (e) {
      results.push({ name: biz.name, bot: biz.telegram_bot_username, status: '❌', error: e.message });
    }
    await new Promise(r => setTimeout(r, 60));
  }

  const allOk = results.every(r => r.status === '✅');
  return NextResponse.json({ all_ok: allOk, count: results.length, expected_base: expected, bots: results });
}
