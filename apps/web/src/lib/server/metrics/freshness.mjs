import { rollupFreshness } from './definitions.mjs';

export async function readRollupFreshness(sb, now = Date.now()) {
  try {
    const { data, error } = await sb.from('metrics_rollup_runs')
      .select('finished_at').eq('ok', true).not('finished_at', 'is', null)
      .order('finished_at', { ascending: false }).order('id', { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw error;
    return rollupFreshness(data?.finished_at, now);
  } catch {
    return { ...rollupFreshness(null, now), error: 'Reporting freshness could not be checked.' };
  }
}

export function rollupPulseAlert(freshness) {
  if (!freshness.stale && !freshness.error) return null;
  return {
    severity: 'amber', icon: '⚠️', type: freshness.error ? 'rollup_unavailable' : 'stale_rollup',
    tab: 'health', businesses: [],
    summary: freshness.error || (freshness.data_as_of
      ? `Reporting is overdue: no successful rollup within ${freshness.threshold_hours} hours. Historical numbers may be outdated.`
      : 'No successful reporting run is available. Historical numbers are not ready.'),
  };
}
