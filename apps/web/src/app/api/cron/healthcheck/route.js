/**
 * GET /api/cron/healthcheck
 * Scheduled via vercel.json - runs daily and DMs the platform-bot owner.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { allowedUpdates, isPlatformBotToken } from '../../../../lib/server/telegramConfig';
import { ensureSharedWebhook } from '../../../../lib/server/sharedWebhookGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

function isOllamaMode() {
  return process.env.USE_OLLAMA === 'true'
    || process.env.OLLAMA_ENABLED === 'true'
    || process.env.OPENAI_API_KEY === 'ollama'
    || !!process.env.OLLAMA_API_KEY
    || !!process.env.OLLAMA_BASE_URL
    || !!(process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('11434'));
}

function ollamaBaseUrl() {
  const raw = process.env.OLLAMA_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';
  return raw.replace('localhost', '127.0.0.1').replace(/\/+$/, '');
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const results = [];
  const add = (area, name, status, detail) => results.push({ area, name, status, detail });

  const required = ['TELEGRAM_BOT_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'WEB_URL', 'CRON_SECRET'];
  for (const k of required) {
    add('env', k, process.env[k] ? 'ok' : 'fail', process.env[k] ? 'set' : 'missing env var');
  }
  if (isOllamaMode()) {
    add('env', 'OLLAMA mode', 'ok', `using ${ollamaBaseUrl()}`);
  } else {
    add('env', 'OPENAI_API_KEY', process.env.OPENAI_API_KEY ? 'ok' : 'fail',
      process.env.OPENAI_API_KEY ? 'set' : 'missing env var');
  }
  if (!process.env.CHAPA_SECRET_KEY) {
    add('env', 'CHAPA_SECRET_KEY', 'warn', 'missing - payments will silently fail');
  }

  if (process.env.ENCRYPTION_KEY) {
    try {
      const { encrypt, decrypt } = require('../../../../lib/server/crypto');
      const rt = decrypt(encrypt('rt'));
      add('env', 'ENCRYPTION_KEY roundtrip', rt === 'rt' ? 'ok' : 'fail', rt === 'rt' ? 'ok' : 'mismatch');
    } catch (e) {
      add('env', 'ENCRYPTION_KEY roundtrip', 'fail', e.message);
    }
  }

  if (SB_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabase } = require('../../../../lib/server/db');
      const sb = supabase();
      const { error: m5 } = await sb.from('businesses')
        .select('telegram_bot_token_enc,webhook_secret,workspace_type,plan').limit(1);
      add('db', 'migration 005', m5 ? 'fail' : 'ok', m5 ? m5.message : 'ok');

      const { error: m4 } = await sb.from('suppliers')
        .select('contact_email,country,currency,is_international,incoterms').limit(1);
      add('db', 'migration 004', m4 ? 'fail' : 'ok', m4 ? m4.message : 'ok');

      const { error: m3 } = await sb.from('agent_tasks').select('scheduled_at').limit(1);
      add('db', 'migration 003', m3 ? 'fail' : 'ok', m3 ? m3.message : 'ok');
    } catch (e) {
      add('db', 'connection', 'fail', e.message);
    }
  }

  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(7000) });
    const j = await r.json();
    add('ext', 'telegram', j.ok ? 'ok' : 'fail', j.ok ? `@${j.result.username}` : JSON.stringify(j));
  } catch (e) {
    add('ext', 'telegram', 'fail', e.message);
  }

  try {
    if (isOllamaMode()) {
      const r = await fetch(`${ollamaBaseUrl()}/models`, {
        signal: AbortSignal.timeout(7000),
      });
      add('ext', 'ollama', r.ok ? 'ok' : 'fail', r.ok ? 'reachable' : `${r.status}`);
    } else {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(7000),
      });
      add('ext', 'openai', r.ok ? 'ok' : 'fail', r.ok ? 'reachable' : `${r.status}`);
    }
  } catch (e) {
    add('ext', isOllamaMode() ? 'ollama' : 'openai', 'fail', e.message);
  }

  const autoHealed = [];

  {
    const res = await ensureSharedWebhook({ force: true });
    if (res.healed) {
      autoHealed.push('@MiniMeAgentBot (shared)');
      add('shared-bot', 'webhook', 'healed', `was url=${res.was || 'none'} -> /api/agent-bot/webhook`);
    } else if (res.ok) {
      add('shared-bot', 'webhook', 'ok', 'correctly registered');
    } else if (res.error) {
      add('shared-bot', 'webhook', 'fail', res.error);
    } else {
      add('shared-bot', 'webhook', 'warn', 'skipped - TELEGRAM_BOT_TOKEN or WEB_URL missing');
    }
  }

  if (SB_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabase } = require('../../../../lib/server/db');
      const { decrypt } = require('../../../../lib/server/crypto');
      const sb = supabase();
      const { data: bizs } = await sb.from('businesses')
        .select('id, name, telegram_bot_token_enc, telegram_bot_username, webhook_secret')
        .not('telegram_bot_token_enc', 'is', null)
        .limit(20);

      for (const b of bizs || []) {
        try {
          const token = decrypt(b.telegram_bot_token_enc);
          if (isPlatformBotToken(token)) {
            add('bot', b.telegram_bot_username || b.name, 'warn',
              'stores a MiniMe system bot token - clear telegram_bot_token_enc on this row');
            continue;
          }

          const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`,
            { signal: AbortSignal.timeout(8000) });
          const j = await r.json();
          const errMsg = j.result?.last_error_message || '';
          const errAge = j.result?.last_error_date
            ? Math.floor((Date.now() / 1000) - j.result.last_error_date)
            : null;

          if (errMsg && errAge !== null && errAge < 3600) {
            add('bot', b.telegram_bot_username || b.name, 'warn',
              `${errMsg} (${Math.round(errAge / 60)}min ago)`);

            if (errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('connect')) {
              const baseUrl = (process.env.WEB_URL || '').replace(/\/$/, '');
              const webhookUrl = `${baseUrl}/api/telegram/webhook/${b.webhook_secret}`;
              await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: webhookUrl,
                  secret_token: b.webhook_secret,
                  drop_pending_updates: false,
                  allowed_updates: allowedUpdates(),
                }),
                signal: AbortSignal.timeout(8000),
              });
              autoHealed.push(b.telegram_bot_username || b.name);
              add('bot', b.telegram_bot_username || b.name, 'healed', 'webhook reset');
            }
          } else {
            add('bot', b.telegram_bot_username || b.name, 'ok',
              `${j.result?.pending_update_count || 0} pending`);
          }
        } catch (e) {
          add('bot', b.telegram_bot_username || b.name, 'fail', e.message.slice(0, 80));
        }
      }
    } catch (e) {
      add('bot', 'all_bots', 'fail', e.message);
    }
  }

  const pass = results.filter(r => r.status === 'ok' || r.status === 'healed').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const warn = results.filter(r => r.status === 'warn').length;

  if ((fail > 0 || warn > 0 || autoHealed.length > 0) && process.env.TELEGRAM_BOT_TOKEN && process.env.CRON_OWNER_CHAT_ID) {
    try {
      const failing = results.filter(r => r.status === 'fail' || r.status === 'warn');
      const lines = failing.map(r => `• ${r.area}/${r.name}: ${r.detail}`).join('\n');
      const healedLine = autoHealed.length ? `\n\n🔧 Auto-healed: ${autoHealed.join(', ')}` : '';
      const text = `⚠️ MiniMe health: ${fail} fail / ${warn} warn / ${pass} ok${healedLine}\n\n${lines}`;
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.CRON_OWNER_CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(7000),
      });
    } catch (e) {
      console.warn('cron alert send failed:', e.message);
    }
  }

  return NextResponse.json({
    ok: fail === 0,
    pass, fail, warn,
    auto_healed: autoHealed,
    checked_at: new Date().toISOString(),
    results,
  }, { status: fail === 0 ? 200 : 500 });
}
