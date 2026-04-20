#!/usr/bin/env node
/**
 * MiniMe health check — run from repo root:
 *   node scripts/healthcheck.js
 *
 * Prints a pass/fail grid for every moving part so you can see at a glance
 * what's wired up vs. what still needs configuring.
 *
 * Safe to run repeatedly — read-only checks, no mutations.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const results = [];
const add = (area, name, status, detail) => results.push({ area, name, status, detail });

async function main() {
  // ─────────────────────────────────────────────────────────────
  // 1. Environment variables
  // ─────────────────────────────────────────────────────────────
  const envSpec = [
    ['OPENAI_API_KEY', true, 'AI replies, embeddings, Whisper'],
    ['TELEGRAM_BOT_TOKEN', true, 'Platform bot (Mini App auth)'],
    ['SUPABASE_URL', true, 'Database connection'],
    ['SUPABASE_SERVICE_ROLE_KEY', true, 'Database writes'],
    ['ENCRYPTION_KEY', true, 'Bot-token encryption (Phase 1 multi-tenant)'],
    ['WEB_URL', true, 'Webhook base URL for linked bots'],
    ['CHAPA_SECRET_KEY', false, 'Payments — optional'],
    ['RESEND_API_KEY', false, 'Email to intl suppliers — optional (falls back to mailto:)'],
    ['RESEND_FROM_EMAIL', false, 'Same as above'],
  ];
  for (const [key, required, why] of envSpec) {
    const set = !!process.env[key];
    add('env', key, set ? 'ok' : (required ? 'fail' : 'warn'),
        set ? `set (${String(process.env[key]).slice(0, 4)}…)` : (required ? `MISSING — ${why}` : `not set — ${why}`));
  }

  // Validate ENCRYPTION_KEY decodes to exactly 32 bytes
  if (process.env.ENCRYPTION_KEY) {
    try {
      const { encrypt, decrypt } = require('../packages/shared/crypto');
      const rt = decrypt(encrypt('roundtrip-test'));
      add('env', 'ENCRYPTION_KEY roundtrip', rt === 'roundtrip-test' ? 'ok' : 'fail',
          rt === 'roundtrip-test' ? 'encrypt/decrypt works' : 'mismatch — key may be wrong');
    } catch (e) {
      add('env', 'ENCRYPTION_KEY roundtrip', 'fail', e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. File presence — did all the new code land?
  // ─────────────────────────────────────────────────────────────
  const fs = require('fs');
  const path = require('path');
  const files = [
    // Migrations
    'packages/db/migrations/004_international_suppliers.sql',
    'packages/db/migrations/005_multi_tenant_bots.sql',
    // Shared
    'packages/shared/crypto.js',
    // Bot
    'apps/bot/src/services/email.js',
    'apps/bot/src/services/supplierReply.js',
    'apps/bot/src/botFactory.js',
    // Web API
    'apps/web/src/app/api/bot/link/route.js',
    'apps/web/src/app/api/bot/unlink/route.js',
    'apps/web/src/app/api/telegram/webhook/[secret]/route.js',
    // Web UI
    'apps/web/src/app/(dashboard)/settings/bot/page.js',
    'apps/web/src/components/ui/Skeleton.jsx',
    'apps/web/src/components/ui/EmptyState.jsx',
    'apps/web/src/components/ui/Toast.jsx',
    'apps/web/src/components/ui/PageHeader.jsx',
  ];
  for (const rel of files) {
    const abs = path.resolve(__dirname, '..', rel);
    add('files', rel, fs.existsSync(abs) ? 'ok' : 'fail', fs.existsSync(abs) ? 'present' : 'MISSING');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Syntax — all JS files parse?
  // ─────────────────────────────────────────────────────────────
  const { execSync } = require('child_process');
  const jsFiles = [
    'apps/bot/src/services/agent.js',
    'apps/bot/src/services/supplierReply.js',
    'apps/bot/src/services/email.js',
    'apps/bot/src/services/ai.js',
    'apps/bot/src/botFactory.js',
    'apps/bot/src/handlers/message.js',
    'apps/bot/src/handlers/command.js',
    'apps/bot/src/handlers/callback.js',
    'packages/db/queries/businesses.js',
    'packages/db/queries/suppliers.js',
    'packages/shared/crypto.js',
    'packages/shared/prompts.js',
  ];
  for (const rel of jsFiles) {
    const abs = path.resolve(__dirname, '..', rel);
    try {
      execSync(`node -c "${abs}"`, { stdio: 'pipe' });
      add('syntax', rel, 'ok', 'parses');
    } catch (e) {
      add('syntax', rel, 'fail', e.stderr?.toString().split('\n')[1] || 'syntax error');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Database — are the migrations applied?
  // ─────────────────────────────────────────────────────────────
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabase } = require('../packages/db/client');

      // Check businesses columns (migration 005)
      const phase1Cols = ['telegram_bot_token_enc', 'webhook_secret', 'workspace_type', 'plan', 'ai_messages_today'];
      const { error: bizErr } = await supabase
        .from('businesses')
        .select(phase1Cols.join(','))
        .limit(1);
      if (bizErr) {
        add('db', 'migration 005 (multi-tenant bots)', 'fail', `columns missing: ${bizErr.message}`);
      } else {
        add('db', 'migration 005 (multi-tenant bots)', 'ok', 'all phase-1 columns present');
      }

      // Check suppliers columns (migration 004)
      const intlCols = ['contact_email', 'country', 'currency', 'is_international', 'incoterms', 'min_order_quantity'];
      const { error: supErr } = await supabase
        .from('suppliers')
        .select(intlCols.join(','))
        .limit(1);
      if (supErr) {
        add('db', 'migration 004 (international suppliers)', 'fail', `columns missing: ${supErr.message}`);
      } else {
        add('db', 'migration 004 (international suppliers)', 'ok', 'all intl columns present');
      }

      // Agent_tasks + knowledge (migration 003)
      const { error: tasksErr } = await supabase
        .from('agent_tasks')
        .select('scheduled_at')
        .limit(1);
      add('db', 'migration 003 (knowledge + agent)', tasksErr ? 'fail' : 'ok',
          tasksErr ? tasksErr.message : 'agent_tasks.scheduled_at present');

      // Row counts
      const tables = ['businesses', 'products', 'customers', 'suppliers', 'agent_tasks', 'documents'];
      for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        if (error) add('db', `count ${t}`, 'warn', error.message);
        else add('db', `count ${t}`, 'ok', `${count} rows`);
      }

      // How many businesses have bots linked?
      const { data: linked } = await supabase
        .from('businesses')
        .select('id, name, telegram_bot_username, workspace_type')
        .not('telegram_bot_token_enc', 'is', null);
      add('db', 'linked bots',
          linked && linked.length ? 'ok' : 'warn',
          linked && linked.length
            ? linked.map(b => `@${b.telegram_bot_username} (${b.workspace_type})`).join(', ')
            : 'no businesses have linked their own bot yet');
    } catch (e) {
      add('db', 'connection', 'fail', e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. External — can we reach Telegram + OpenAI?
  // ─────────────────────────────────────────────────────────────
  const axios = require('axios');
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const r = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, { timeout: 7000 });
      add('ext', 'telegram platform bot', 'ok', `@${r.data.result.username} (${r.data.result.first_name})`);

      // Is a webhook set on the platform bot? (usually no, it uses polling)
      const w = await axios.get(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, { timeout: 7000 });
      add('ext', 'platform webhook info',
          w.data.result.url ? 'warn' : 'ok',
          w.data.result.url ? `webhook set: ${w.data.result.url}` : 'no webhook (polling mode)');
    } catch (e) {
      add('ext', 'telegram platform bot', 'fail', e.message);
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout: 7000,
      });
      const hasGpt4o = (r.data.data || []).some(m => m.id === 'gpt-4o');
      add('ext', 'openai api', hasGpt4o ? 'ok' : 'warn',
          hasGpt4o ? `${r.data.data.length} models, gpt-4o available` : 'gpt-4o NOT in your model list');
    } catch (e) {
      add('ext', 'openai api', 'fail', e.response?.data?.error?.message || e.message);
    }
  }

  if (process.env.WEB_URL) {
    try {
      const r = await axios.get(process.env.WEB_URL, { timeout: 7000, validateStatus: () => true });
      add('ext', 'web app reachable', r.status < 500 ? 'ok' : 'fail', `${r.status} ${r.statusText}`);
    } catch (e) {
      add('ext', 'web app reachable', 'fail', e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Print the grid
  // ─────────────────────────────────────────────────────────────
  const icons = { ok: '✅', warn: '⚠️ ', fail: '❌' };
  const areas = [...new Set(results.map(r => r.area))];
  console.log('\n╭─────────────────────────────────────────────────────────────╮');
  console.log('│                  MINIME HEALTH CHECK                        │');
  console.log('╰─────────────────────────────────────────────────────────────╯\n');

  for (const area of areas) {
    const title = {
      env: '1. Environment variables',
      files: '2. Files on disk',
      syntax: '3. Syntax check',
      db: '4. Database (Supabase)',
      ext: '5. External services',
    }[area] || area;
    console.log(`\n${title}`);
    console.log('─'.repeat(65));
    for (const r of results.filter(x => x.area === area)) {
      const name = r.name.padEnd(48);
      console.log(`  ${icons[r.status]} ${name} ${r.detail || ''}`);
    }
  }

  const pass = results.filter(r => r.status === 'ok').length;
  const warn = results.filter(r => r.status === 'warn').length;
  const fail = results.filter(r => r.status === 'fail').length;
  console.log('\n' + '─'.repeat(65));
  console.log(`  ${icons.ok} ${pass} passing   ${icons.warn} ${warn} warnings   ${icons.fail} ${fail} failing`);
  console.log('─'.repeat(65) + '\n');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Healthcheck crashed:', e);
  process.exit(2);
});
