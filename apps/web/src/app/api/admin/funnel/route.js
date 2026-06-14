/**
 * GET /api/admin/funnel — signup→activation funnel + per-owner journeys.
 *
 * Sources:
 *  - onboarding_events (telegram_id, step, created_at) — wizard telemetry
 *  - businesses — joins each telegram_id to its business + activation state
 *
 * Returns:
 *  - steps: ordered funnel with unique-owner counts (last 30 days)
 *  - journeys: one row per business, newest first — furthest step reached,
 *    event count, signup time, activation state. This is the "watch a signup
 *    move through MiniMe" view the master admin asked for.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Canonical funnel order — the Selam wizard path. Earlier/legacy steps map
// onto these so old signups still show a sensible journey.
const FUNNEL = [
  { key: 'signup',                label: 'Signed up',        match: ['signup'] },
  { key: 'welcome',               label: 'Opened wizard',    match: ['app_open', 'welcome'] },
  { key: 'shop_name',             label: 'Named shop',       match: ['shop_name', 'shop_name_saved'] },
  { key: 'customer_chat',         label: 'Selam chat',       match: ['customer_chat_started', 'customer_chat_reply', 'customer_chat_finished', 'conversation_started', 'conversation_finished'] },
  { key: 'tryit',                 label: 'Tried the AI',     match: ['tryit', 'tryit_sent', 'tryit_replied', 'tryit_edited', 'tryit_used_upload'] },
  { key: 'connect',               label: 'Reached Go Live',  match: ['connect', 'connect_custom', 'connect_shared', 'trial_disclosed'] },
  { key: 'connected',             label: 'Activated',        match: ['connected_custom', 'connected_shared', 'trial_started'] },
];

const STEP_TO_STAGE = {};
FUNNEL.forEach((s, i) => s.match.forEach(m => { STEP_TO_STAGE[m] = i; }));

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [{ data: events }, { data: businesses }] = await Promise.all([
    sb.from('onboarding_events')
      .select('telegram_id, step, created_at')
      .gte('created_at', monthAgo)
      .order('created_at', { ascending: true })
      .limit(20000),
    sb.from('businesses')
      .select('id, name, owner_name, owner_username, owner_telegram_id, onboarding_completed, telegram_bot_username, shop_code, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  // Per-owner rollup: furthest stage, event count, first/last event times.
  const byOwner = {};
  for (const e of events || []) {
    if (!e.telegram_id) continue;
    const stage = STEP_TO_STAGE[e.step];
    if (stage === undefined) continue;
    const o = byOwner[e.telegram_id] || (byOwner[e.telegram_id] = { maxStage: -1, count: 0, firstAt: e.created_at, lastAt: e.created_at, lastStep: e.step });
    o.count++;
    if (stage > o.maxStage) o.maxStage = stage;
    if (e.created_at > o.lastAt) { o.lastAt = e.created_at; o.lastStep = e.step; }
  }

  // Funnel counts: unique owners who reached AT LEAST each stage.
  const steps = FUNNEL.map((s, i) => ({
    key: s.key,
    label: s.label,
    owners: Object.values(byOwner).filter(o => o.maxStage >= i).length,
  }));

  // Journeys: one row per business, joined to its telemetry.
  const journeys = (businesses || []).map(b => {
    const o = byOwner[b.owner_telegram_id] || null;
    const activated = !!(b.onboarding_completed || b.telegram_bot_username);
    return {
      id: b.id,
      name: b.name,
      owner_name: b.owner_name,
      owner_username: b.owner_username || null,
      owner_telegram_id: b.owner_telegram_id,
      created_at: b.created_at,
      activated,
      bot: b.telegram_bot_username ? `@${b.telegram_bot_username}` : (b.shop_code ? `shop_${b.shop_code}` : null),
      subscription_status: b.subscription_status || null,
      trial_ends_at: b.trial_ends_at || null,
      furthest_stage: o ? FUNNEL[Math.max(o.maxStage, 0)]?.label : (activated ? 'Activated' : null),
      furthest_index: o ? o.maxStage : (activated ? FUNNEL.length - 1 : -1),
      events_30d: o?.count || 0,
      last_event_at: o?.lastAt || null,
      last_step: o?.lastStep || null,
    };
  });

  return NextResponse.json({ steps, journeys, total_stages: FUNNEL.length });
}
