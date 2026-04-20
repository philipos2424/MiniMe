/**
 * GET /api/cron/healthcheck
 * Scheduled via vercel.json — runs daily and DMs the platform-bot owner
 * (CRON_OWNER_CHAT_ID) on any regression.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We also accept
 * calls from the Vercel cron infra via the built-in `x-vercel-cron` header.
 *
 * Read-only — no DB mutations.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  // Auth
  const auth = request.headers.get('authorization') || '';
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const secret = process.env.CRON_SECRET;
  if (!isVercelCron && (!secret || auth !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const results = [];
  const add = (area, name, status, detail) => results.push({ area, name, status, detail });

  // 1. Env
  const required = ['OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'WEB_URL'];
  for (const k of required) {
    add('env', k, process.env[k] ? 'ok' : 'fail', process.env[k] ? 'set' : 'MISSING');
  }

  // 2. ENCRYPTION_KEY roundtrip
  if (process.env.ENCRYPTION_KEY) {
    try {
      const { encrypt, decrypt } = require('../../../../../../../packages/shared/crypto');
      const rt = decrypt(encrypt('rt'));
      add('env', 'ENCRYPTION_KEY roundtrip', rt === 'rt' ? 'ok' : 'fail', rt === 'rt' ? 'ok' : 'mismatch');
    } catch (e) {
      add('env', 'ENCRYPTION_KEY roundtrip', 'fail', e.message);
    }
  }

  // 3. DB — migrations applied?
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabase } = require('../../../../../../../packages/db/client');
      const { error: m5 } = await supabase.from('businesses')
        .select('telegram_bot_token_enc,webhook_secret,workspace_type,plan').limit(1);
      add('db', 'migration 005', m5 ? 'fail' : 'ok', m5 ? m5.message : 'ok');

      const { error: m4 } = await supabase.from('suppliers')
        .select('contact_email,country,currency,is_international,incoterms').limit(1);
      add('db', 'migration 004', m4 ? 'fail' : 'ok', m4 ? m4.message : 'ok');

      const { error: m3 } = await supabase.from('agent_tasks').select('scheduled_at').limit(1);
      add('db', 'migration 003', m3 ? 'fail' : 'ok', m3 ? m3.message : 'ok');
    } catch (e) {
      add('db', 'connection', 'fail', e.message);
    }
  }

  // 4. External
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(7000) });
    const j = await r.json();
    add('ext', 'telegram', j.ok ? 'ok' : 'fail', j.ok ? `@${j.result.username}` : JSON.stringify(j));
  } catch (e) {
    add('ext', 'telegram', 'fail', e.message);
  }

  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(7000),
    });
    add('ext', 'openai', r.ok ? 'ok' : 'fail', r.ok ? 'reachable' : `${r.status}`);
  } catch (e) {
    add('ext', 'openai', 'fail', e.message);
  }

  const pass = results.filter(r => r.status === 'ok').length;
  const fail = results.filter(r => r.status === 'fail').length;

  // Alert on failure via platform bot DM
  if (fail > 0 && process.env.TELEGRAM_BOT_TOKEN && process.env.CRON_OWNER_CHAT_ID) {
    try {
      const failing = results.filter(r => r.status === 'fail');
      const lines = failing.map(r => `• ${r.area}/${r.name}: ${r.detail}`).join('\n');
      const text = `⚠️ MiniMe healthcheck — ${fail} failing / ${pass} passing\n\n${lines}`;
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
    pass,
    fail,
    checked_at: new Date().toISOString(),
    results,
  }, { status: fail === 0 ? 200 : 500 });
}
