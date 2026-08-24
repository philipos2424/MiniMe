/**
 * Did the nudge work?
 *
 * A send is resolved by re-deriving the person's stage today and comparing it
 * to the stage recorded when we messaged them. Advancing any rung counts;
 * reaching a connected state counts as completed. Without this sweep the
 * attribution table records only that we sent something, which answers nothing.
 */
import { supabase } from '../db';
import { detectStage, STAGES } from './stages.mjs';

const RESOLVE_AFTER_MS = 7 * 86400000;

export async function recentReengagementSend(telegramId) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data } = await supabase()
    .from('reengagement_sends')
    .select('id, telegram_id, business_id, stage, variant, sent_at, replied_at')
    .eq('telegram_id', telegramId)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function resolveOutcomes({ now = Date.now() } = {}) {
  const sb = supabase();
  const cutoff = new Date(now - RESOLVE_AFTER_MS).toISOString();

  const { data: pending } = await sb
    .from('reengagement_sends')
    .select('id, telegram_id, stage, sent_at')
    .is('outcome', null)
    .lte('sent_at', cutoff)
    .limit(500);
  if (!pending?.length) return { checked: 0, advanced: 0 };

  const ids = pending.map(p => p.telegram_id);

  const { data: events } = await sb
    .from('onboarding_events')
    .select('telegram_id, step')
    .in('telegram_id', ids);
  const stepsByUser = new Map();
  for (const e of events || []) {
    const key = String(e.telegram_id);
    if (!stepsByUser.has(key)) stepsByUser.set(key, []);
    stepsByUser.get(key).push(e.step);
  }

  const { data: businesses } = await sb
    .from('businesses')
    .select('id, owner_telegram_id, onboarding_completed, telegram_bot_username')
    .in('owner_telegram_id', ids);
  const bizByOwner = new Map((businesses || []).map(b => [String(b.owner_telegram_id), b]));

  let advanced = 0;
  for (const row of pending) {
    const key = String(row.telegram_id);
    const business = bizByOwner.get(key) || null;
    const nowStage = detectStage({ steps: stepsByUser.get(key) || [], business });

    // detectStage returns null once they are live — that is the win condition.
    let outcome = 'no_change';
    if (nowStage === null) outcome = 'completed';
    else if (STAGES.indexOf(nowStage) > STAGES.indexOf(row.stage)) outcome = 'advanced';

    if (outcome !== 'no_change') advanced++;
    await sb.from('reengagement_sends').update({ outcome }).eq('id', row.id).then(() => {}, () => {});
  }

  return { checked: pending.length, advanced };
}
