'use client';

import { useEffect, useState } from 'react';
import styles from './today.module.css';

const TITLES = {
  freshness: 'Reporting freshness', payments: 'Payments awaiting review', ai: 'AI reply health',
  webhooks: 'Webhook deliveries', activity: 'Live shops', signups: 'New shops',
};
const formatTime = value => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Addis_Ababa',
}).format(new Date(value)) + ' EAT';

export default function TodayPanel({ panel, initData, ready, revision }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setState({ loading: true });
    fetch(`/api/admin/v2/today?panel=${panel}`, {
      headers: initData ? { 'x-telegram-init-data': initData } : {},
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      if (response.status === 401 || response.status === 403) {
        setState({ error: 'Admin sign-in is required.', forbidden: true });
        return;
      }
      const result = await response.json();
      if (!response.ok || result.error) throw new Error('unavailable');
      if (!controller.signal.aborted) setState({ data: result.data });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ error: 'This panel could not be loaded.' });
    });
    return () => controller.abort();
  }, [panel, initData, ready, revision, attempt]);

  const d = state.data;
  const warning = d && (d.stale || d.error || d.failed > 0 || (panel === 'payments' && d.count > 0));
  return (
    <section className={`${styles.card} ${panel === 'freshness' ? styles.wide : ''} ${warning ? styles.warning : ''}`} aria-labelledby={`title-${panel}`} aria-busy={state.loading || false}>
      <div className={styles.cardHeading}>
        <h2 id={`title-${panel}`}>{TITLES[panel]}</h2>
        {warning && <span className={styles.badge}>Needs attention</span>}
      </div>
      {state.loading && <p className={styles.muted} role="status">Checking…</p>}
      {state.error && <div role="alert">
        <p>{state.error}</p>
        {state.forbidden ? <a href="/admin/login">Sign in as admin →</a> : <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry this panel</button>}
      </div>}
      {d && <PanelContent panel={panel} data={d} retry={() => setAttempt(n => n + 1)} />}
      {d?.period && <p className={styles.meta}>{d.period} · Checked {formatTime(d.checked_at)}</p>}
    </section>
  );
}

function PanelContent({ panel, data: d, retry }) {
  if (panel === 'freshness') return <>
    <p className={styles.freshness}>{d.error ? 'Freshness unavailable' : d.data_as_of ? `Data as of ${formatTime(d.data_as_of)}` : 'Data as of: no successful reporting run'}</p>
    {d.error ? <><p role="alert">{d.error}</p><button type="button" onClick={retry}>Retry freshness check</button></> :
      <p className={styles.muted}>{d.stale
        ? `Historical reporting is ${d.data_as_of ? 'overdue' : 'not ready'}. A successful run is required every ${d.threshold_hours} hours. Check the reporting job.`
        : 'Historical reporting is current. The panels below query live activity when refreshed.'}</p>}
    {d.stale && <a href="/admin/legacy#health">Open platform health →</a>}
  </>;
  if (panel === 'payments') return <>
    <p className={styles.number}>{d.count}<span>shops</span></p>
    <p>{d.count ? 'Payment submissions are waiting for your decision.' : 'No shops are waiting in the payment review queue.'}</p>
    <a href="/admin/legacy#paid">Review payments →</a>
  </>;
  if (panel === 'ai') return <>
    <p className={styles.number}>{d.failure_pct == null ? '—' : `${d.failure_pct}%`}<span>failed</span></p>
    <p>{d.calls ? `${d.failed} failed out of ${d.calls} AI calls.` : 'No AI calls recorded today. Health is not yet known.'}</p>
    <p className={styles.muted}>Measures final call outcomes after fallback. Individual provider attempts are excluded; zero AI spend can be normal.</p>
    <a href="/admin/legacy#analytics">Open AI diagnostics →</a>
  </>;
  if (panel === 'webhooks') return <>
    <p className={styles.number}>{d.affected_shops}<span>shops with failures</span></p>
    <p>{d.deliveries ? `${d.failed} failed out of ${d.deliveries} observed deliveries.` : 'No deliveries recorded in the last hour. Health is not yet known.'}</p>
    <p className={styles.muted}>Custom-bot delivery history only. Use bot diagnostics to check current Telegram webhook configuration.</p>
    <a href="/admin/legacy#bots">Check connected bots →</a>
  </>;
  if (panel === 'activity') return <>
    <p className={styles.number}>{d.count}<span>live shops</span></p>
    <p>Shops that received at least one inbound customer message in the last 24 hours.</p>
    <a href="/admin/legacy#businesses">Open shops →</a>
  </>;
  return <>
    <p className={styles.number}>{d.count}<span>signups today</span></p>
    <p>{d.previous == null ? 'Last week’s comparison is unavailable.' : `${d.previous} on ${d.previous_day} — same weekday last week, full day.`}</p>
    <p className={styles.muted}>Today is a partial day; the comparison is a full EAT day.{d.previous_source === 'backfill' ? ' Comparison reconstructed from backfilled data.' : ''}</p>
    <details className={styles.limits}><summary>Historical data limits</summary><p>Owner events: 90 days. Messages: 18 months. Historical plan state is approximate. Signups use shop creation dates.</p></details>
  </>;
}
