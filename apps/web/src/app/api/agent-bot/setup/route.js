/**
 * GET /api/agent-bot/setup
 *
 * Registers (or re-registers) the main MiniMe bot webhook with Telegram.
 * Also enables business_message and business_connection update types.
 *
 * Call once after deploying or if messages stop coming through.
 * Protected by CRON_SECRET.
 *
 * Usage: GET https://web-theta-one-68.vercel.app/api/agent-bot/setup
 *        Authorization: Bearer <CRON_SECRET>
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token   = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const secret  = (process.env.AGENT_BOT_WEBHOOK_SECRET || '').trim();
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim();

  if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 });

  const webhookUrl = `${baseUrl}/api/agent-bot/webhook`;

  const body = {
    url: webhookUrl,
    allowed_updates: [
      'message',
      'edited_message',
      'callback_query',
      'pre_checkout_query',
      'business_connection',
      'business_message',
      'edited_business_message',
    ],
    max_connections: 40,
    drop_pending_updates: false,
  };
  if (secret) body.secret_token = secret;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await r.json();

  // Also get current webhook info
  const infoR = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoR.json();

  // ── Apply missing DB constraints (idempotent) ──────────────────────────
  const migrations = [];
  try {
    const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false }, global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } });
      // Test: try upserting on (business_id, customer_id) — if it fails, constraint is missing
      const { error: testErr } = await sb.from('conversations')
        .upsert({ business_id: '00000000-0000-0000-0000-000000000000', customer_id: '00000000-0000-0000-0000-000000000000', message_count: 0 },
          { onConflict: 'business_id,customer_id', ignoreDuplicates: true })
        .select('id').maybeSingle();

      if (testErr?.code === '42P10') {
        // Constraint missing — create it via raw SQL through the pg endpoint
        migrations.push('conversations_business_customer_unq: MISSING — add via Supabase SQL Editor');
        migrations.push('RUN: CREATE UNIQUE INDEX IF NOT EXISTS conversations_business_customer_unq ON conversations (business_id, customer_id) WHERE customer_id IS NOT NULL;');
      } else {
        migrations.push('conversations_business_customer_unq: OK');
      }
    }
  } catch (e) {
    migrations.push(`migration check error: ${e.message}`);
  }

  return NextResponse.json({
    set_webhook: result,
    webhook_info: info.result,
    registered_url: webhookUrl,
    migrations,
  });
}
