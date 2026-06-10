/**
 * GET /api/admin/check-secretary
 *
 * Diagnoses secretary mode setup for all businesses.
 * Shows: connection status, agent bot webhook health, owner ID match.
 * Protected by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } });
  const agentToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  // 1. Check agent bot webhook
  let webhookOk = false;
  let webhookUrl = '';
  let allowedUpdates = [];
  if (agentToken) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${agentToken}/getWebhookInfo`);
      const j = await r.json();
      webhookUrl = j.result?.url || '';
      allowedUpdates = j.result?.allowed_updates || [];
      webhookOk = webhookUrl.includes('/api/agent-bot/webhook') &&
        allowedUpdates.includes('business_message') &&
        allowedUpdates.includes('business_connection');
    } catch {}
  }

  // 2. Check businesses with secretary connected
  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, owner_telegram_id, telegram_biz_conn_id, trust_level, brain_mode')
    .not('owner_telegram_id', 'is', null)
    .order('created_at', { ascending: false });

  const results = (businesses || []).map(b => ({
    name: b.name,
    bot: b.telegram_bot_username || '—',
    owner_telegram_id: b.owner_telegram_id,
    secretary_connected: !!b.telegram_biz_conn_id,
    connection_id: b.telegram_biz_conn_id ? b.telegram_biz_conn_id.slice(0, 12) + '…' : null,
    trust_level: b.trust_level ?? 2,
    ai_active: b.brain_mode !== false,
    status: !!b.telegram_biz_conn_id ? '✅ Secretary active' : '— No secretary',
  }));

  const connectedCount = results.filter(r => r.secretary_connected).length;

  return NextResponse.json({
    agent_bot: {
      webhook_ok: webhookOk,
      webhook_url: webhookUrl.slice(-50),
      has_business_connection: allowedUpdates.includes('business_connection'),
      has_business_message: allowedUpdates.includes('business_message'),
    },
    businesses: {
      total: results.length,
      secretary_connected: connectedCount,
      results,
    },
    instructions: webhookOk
      ? 'Agent bot webhook is correctly configured.'
      : 'Run GET /api/agent-bot/setup to fix the webhook.',
  });
}
