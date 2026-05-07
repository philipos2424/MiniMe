/**
 * GET /api/admin/bots
 * Returns all businesses with a connected bot + live webhook health from Telegram API.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const dayAgo  = new Date(Date.now() - 86400000).toISOString();

  // Fetch all businesses with a bot token
  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, owner_name, owner_telegram_id, telegram_bot_username, telegram_bot_token_enc, webhook_secret, panic_mode, brain_mode, trust_level, created_at, updated_at, category, subscription_status')
    .not('telegram_bot_token_enc', 'is', null)
    .order('updated_at', { ascending: false });

  if (!businesses?.length) return NextResponse.json({ bots: [] });

  const ids = businesses.map(b => b.id);

  // Fetch activity stats in parallel
  const [
    { data: msgWeek },
    { data: msgDay },
    { data: lastMsgs },
  ] = await Promise.all([
    sb.from('messages').select('business_id').in('business_id', ids).gte('created_at', weekAgo).limit(50000),
    sb.from('messages').select('business_id').in('business_id', ids).gte('created_at', dayAgo).limit(10000),
    sb.from('messages')
      .select('business_id, created_at')
      .in('business_id', ids)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(businesses.length * 3),
  ]);

  const msgsWeekByBiz = {}, msgsDayByBiz = {}, lastMsgByBiz = {};
  for (const m of msgWeek  || []) msgsWeekByBiz[m.business_id] = (msgsWeekByBiz[m.business_id] || 0) + 1;
  for (const m of msgDay   || []) msgsDayByBiz[m.business_id]  = (msgsDayByBiz[m.business_id]  || 0) + 1;
  for (const m of lastMsgs || []) {
    if (!lastMsgByBiz[m.business_id]) lastMsgByBiz[m.business_id] = m.created_at;
  }

  // Check webhook health for each bot (call Telegram getWebhookInfo)
  const MINIAPP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app';

  async function checkWebhook(enc, webhookSecret) {
    try {
      const token = decrypt(enc);
      const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(4000) });
      const j = await res.json();
      if (!j.ok) return { healthy: false, error: j.description || 'API error', pending: 0 };
      const info = j.result;
      const expectedUrl = `${MINIAPP_BASE}/api/telegram/webhook/${webhookSecret}`;
      const urlMatch = info.url === expectedUrl;
      return {
        healthy: !!info.url && urlMatch,
        url: info.url || null,
        pending: info.pending_update_count || 0,
        lastError: info.last_error_message || null,
        lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
        urlMatch,
      };
    } catch (e) {
      return { healthy: false, error: e.message, pending: 0 };
    }
  }

  // Run webhook checks in parallel (with concurrency cap to avoid rate limits)
  const CONCURRENCY = 5;
  const webhookResults = {};
  for (let i = 0; i < businesses.length; i += CONCURRENCY) {
    const batch = businesses.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(b => checkWebhook(b.telegram_bot_token_enc, b.webhook_secret))
    );
    batch.forEach((b, idx) => { webhookResults[b.id] = results[idx]; });
  }

  const bots = businesses.map(b => ({
    id: b.id,
    name: b.name,
    owner_name: b.owner_name,
    owner_telegram_id: b.owner_telegram_id,
    telegram_bot_username: b.telegram_bot_username,
    panic_mode: b.panic_mode,
    brain_mode: b.brain_mode,
    trust_level: b.trust_level,
    subscription_status: b.subscription_status,
    created_at: b.created_at,
    updated_at: b.updated_at,
    category: b.category,
    stats: {
      messages_week: msgsWeekByBiz[b.id] || 0,
      messages_day: msgsDayByBiz[b.id] || 0,
      last_message_at: lastMsgByBiz[b.id] || null,
    },
    webhook: webhookResults[b.id] || { healthy: false, error: 'not checked', pending: 0 },
  }));

  return NextResponse.json({ bots, total: bots.length });
}
