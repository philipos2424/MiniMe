import { fetchAllRows } from '../fetch-all.mjs';
import { dayKeyEAT, eatMidnightIso, TODAY_METRICS, countTodaySignups, liveShopCount, aiOutcomes, webhookOutcomes, pendingReviewCount } from './definitions.mjs';
import { readRollupFreshness } from './freshness.mjs';

export const TODAY_PANELS = ['freshness', ...Object.keys(TODAY_METRICS)];
const MAX_ROWS = 200000;

async function rows(query) {
  const { data, error } = await fetchAllRows(query, { maxRows: MAX_ROWS });
  // Never present a partial query or a capped result as a complete count.
  if (error || data.length >= MAX_ROWS) throw new Error('Panel data unavailable');
  return data;
}

export async function loadTodayPanel(sb, panel, now = Date.now()) {
  if (!TODAY_PANELS.includes(panel)) throw new Error('Unknown panel');
  if (panel === 'freshness') return readRollupFreshness(sb, now);

  const snapshot = new Date(now).toISOString();
  const today = dayKeyEAT(now);
  const start = eatMidnightIso(today);
  const businesses = await rows(() => sb.from('businesses')
    .select('id,is_internal,created_at,subscription_status').order('id'));
  const base = { ...TODAY_METRICS[panel], checked_at: snapshot };

  if (panel === 'signups') {
    const previousDay = dayKeyEAT(now - 7 * 86400000);
    const history = await rows(() => sb.from('platform_daily')
      .select('day,signups,source').eq('day', previousDay).order('day'));
    return { ...base, count: countTodaySignups(businesses, now), previous: history[0]?.signups ?? null,
      previous_day: previousDay, previous_source: history[0]?.source ?? null };
  }
  if (panel === 'payments') return { ...base, count: pendingReviewCount(businesses) };
  if (panel === 'activity') {
    const messages = await rows(() => sb.from('messages').select('business_id,direction')
      .eq('direction', 'inbound').gte('created_at', new Date(now - 86400000).toISOString())
      .lt('created_at', snapshot).order('created_at').order('id'));
    return { ...base, count: liveShopCount(businesses, messages) };
  }
  if (panel === 'ai') {
    const calls = await rows(() => sb.from('llm_call_log').select('business_id,route,ok')
      .gte('created_at', start).lt('created_at', snapshot).order('created_at').order('id'));
    return { ...base, ...aiOutcomes(businesses, calls) };
  }
  const events = await rows(() => sb.from('webhook_events').select('business_id,delivery_status')
    .gte('created_at', new Date(now - 3600000).toISOString()).lt('created_at', snapshot)
    .order('created_at').order('id'));
  return { ...base, ...webhookOutcomes(businesses, events) };
}
