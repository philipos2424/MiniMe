/**
 * Smoke-test the reminder-recovery features (migration 024).
 *
 *   node scripts/test-recovery.mjs seed    # insert one failing scheduled_message
 *                                           # + one stuck agent_task, print their ids
 *   node scripts/test-recovery.mjs check   # show current state of the seeded rows
 *   node scripts/test-recovery.mjs clean   # delete the seeded rows
 *
 * Then, between `seed` and `check`, hit the crons (locally or on the deploy):
 *   GET /api/cron/scheduled-messages   → the failing msg should gain retry_count,
 *                                         next_retry_at, status back to 'pending'
 *   GET /api/cron/agent-task-nudges    → the stuck task should gain nudge_count=1
 *                                         and the owner gets a re-ping DM
 *
 * Side effects to know about:
 *   - The scheduled_message targets a bogus telegram_id, so the send just fails
 *     (no real customer is messaged) — that failure is the point.
 *   - The agent-task-nudges cron DMs the REAL business owner (that's the feature).
 *     The draft text is clearly marked as a test.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '').replace(/\\n$/, '')]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MSG_LABEL = '__recovery_test__';
const cmd = process.argv[2] || 'check';

async function pickBusiness() {
  const { data } = await sb.from('businesses')
    .select('id, name, owner_telegram_id')
    .not('owner_telegram_id', 'is', null)
    .limit(1);
  return data?.[0] || null;
}

if (cmd === 'seed') {
  const biz = await pickBusiness();
  if (!biz) { console.error('No business with an owner_telegram_id found.'); process.exit(1); }
  console.log('Using business:', biz.name, biz.id);

  const past = new Date(Date.now() - 60_000).toISOString();
  const firedLongAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();

  const { data: msg, error: e1 } = await sb.from('scheduled_messages').insert({
    business_id: biz.id,
    target_type: 'customer',
    target_value: '000000000',          // bogus telegram_id → send fails
    message: 'Recovery test — please ignore.',
    label: MSG_LABEL,
    send_at: past,
    status: 'pending',
  }).select('id').single();
  if (e1) console.error('scheduled_messages insert error:', e1.message);
  else console.log('Seeded scheduled_message:', msg.id);

  const { data: task, error: e2 } = await sb.from('agent_tasks').insert({
    business_id: biz.id,
    type: 'owner_action',
    title: MSG_LABEL,
    status: 'awaiting_approval',
    requires_approval: true,
    scheduled_at: firedLongAgo,
    fired_at: firedLongAgo,
    payload: { action: 'dm_client', target: 'test', message_draft: '[recovery test] Hi — this is a test draft, ignore it.' },
  }).select('id').single();
  if (e2) console.error('agent_tasks insert error:', e2.message);
  else console.log('Seeded agent_task:', task.id);
  process.exit(0);
}

if (cmd === 'clean') {
  const { count: c1 } = await sb.from('scheduled_messages').delete({ count: 'exact' }).eq('label', MSG_LABEL);
  const { count: c2 } = await sb.from('agent_tasks').delete({ count: 'exact' }).eq('title', MSG_LABEL);
  console.log(`Deleted ${c1 || 0} scheduled_message(s), ${c2 || 0} agent_task(s).`);
  process.exit(0);
}

// default: check
const { data: msgs } = await sb.from('scheduled_messages')
  .select('id, status, retry_count, next_retry_at, owner_notified_failed, error_message')
  .eq('label', MSG_LABEL);
const { data: tasks } = await sb.from('agent_tasks')
  .select('id, status, nudge_count, last_nudged_at')
  .eq('title', MSG_LABEL);
console.log('scheduled_messages:', JSON.stringify(msgs, null, 2));
console.log('agent_tasks:', JSON.stringify(tasks, null, 2));
process.exit(0);
