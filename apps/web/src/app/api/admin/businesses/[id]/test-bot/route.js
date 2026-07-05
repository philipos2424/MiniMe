/**
 * GET /api/admin/businesses/:id/test-bot — one-click "is this bot alive?"
 * check for a single business, used by the Pulse triage buttons.
 *
 * Custom bot: decrypt its token, call getMe + getWebhookInfo directly.
 * Shared-mode business (no own bot): checks the platform's shared
 * @MiniMeAgentBot instead — a shared tenant has no bot of its own to fail.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { isAdmin } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { decrypt } from '../../../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function GET(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data: biz } = await supabase().from('businesses')
    .select('id, name, telegram_bot_username, telegram_bot_token_enc')
    .eq('id', params.id).maybeSingle();
  if (!biz) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const expectedBase = (process.env.WEB_URL || 'https://web-theta-one-68.vercel.app').trim();
  const usingShared = !biz.telegram_bot_token_enc;
  let token;
  try {
    token = usingShared ? (process.env.TELEGRAM_BOT_TOKEN || '').trim() : decrypt(biz.telegram_bot_token_enc);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `token decrypt failed: ${e.message}` });
  }
  if (!token) return NextResponse.json({ ok: false, error: 'no bot token available' });

  try {
    const [meRes, whRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()),
    ]);
    const wh = whRes.result || {};
    const webhookHealthy = usingShared ? true : !!wh.url?.startsWith(expectedBase);
    return NextResponse.json({
      ok: true,
      bot_alive: meRes.ok === true,
      webhook_healthy: webhookHealthy,
      pending_updates: wh.pending_update_count ?? null,
      last_error: wh.last_error_message || null,
      used_shared_bot: usingShared,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
