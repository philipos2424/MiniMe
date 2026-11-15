'use client';
/**
 * Weekly shop funnel — the admin-page view of the Monday Telegram report
 * (pricing & funnel spec §1). Reads /api/admin/funnel-weekly, which uses the
 * same builder as the Telegram message, so the two always agree.
 *
 * Test (internal) shops are excluded server-side. "Paying" means a confirmed
 * payment only — never a trial, a grant, or an uploaded-but-unchecked receipt.
 */
import { useEffect, useState } from 'react';

const C = {
  surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', red: '#B85450', accent: '#8B2E1F',
};

const STEP_LABELS = {
  registered: 'Registered',
  onboarding_completed: 'Finished onboarding',
  first_customer_message: 'First customer message',
  activated: 'Activated (3 conversations in 7 days)',
  payment_submitted: 'Payment submitted',
  payment_confirmed: 'Payment confirmed',
};

const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', marginBottom: 14 };
const th = { textAlign: 'right', fontSize: 11, color: C.muted, fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' };
const td = { textAlign: 'right', fontSize: 13, color: C.ink, padding: '6px 8px', whiteSpace: 'nowrap' };
const day = iso => (iso ? new Date(new Date(iso).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) : '—');
const withPct = (n, p) => (p == null ? String(n) : `${n} · ${p}%`);

function Stat({ value, label, tone }) {
  return (
    <div style={{ flex: 1, minWidth: 130, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: tone || C.ink, fontFamily: "'Newsreader',Georgia,serif" }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function FunnelWeeklyPanel({ initData, onPick }) {
  const [state, setState] = useState({ loading: true, report: null, error: null });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!initData) return;
    let alive = true;
    fetch('/api/admin/funnel-weekly', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) setState({ loading: false, report: j.report || null, error: j.ok ? null : (j.error || 'failed') }); })
      .catch(e => { if (alive) setState({ loading: false, report: null, error: e.message }); });
    return () => { alive = false; };
  }, [initData]);

  if (state.loading) return <div style={{ ...card, color: C.muted, fontSize: 13 }}>Loading weekly funnel…</div>;
  if (state.error || !state.report) {
    return <div style={{ ...card, color: C.red, fontSize: 13 }}>Weekly funnel unavailable: {state.error || 'no data'}. It fills after the first weekly run.</div>;
  }

  const r = state.report;
  const conc = r.concentration.this_week;
  const never = showAll ? r.never_messaged.shops : r.never_messaged.shops.slice(0, 15);

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Weekly shop funnel</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        Week {day(r.week.from)} → {day(new Date(new Date(r.week.to).getTime() - 86400000).toISOString())} (Addis time) · {r.shops.internal_excluded} test shops excluded
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat value={r.paying_shops} label="Paying shops (confirmed only)" tone={C.teal} />
        <Stat value={r.conversations.this_week} label={`Customer conversations (last week ${r.conversations.last_week})`} />
        <Stat value={conc.pct == null ? '—' : `${conc.pct}%`} label={`From biggest shop${conc.name ? ` (${conc.name})` : ''}`} tone={conc.pct >= 40 ? C.red : C.ink} />
        <Stat value={r.customers.unique_people} label={`Unique customers (${r.customers.records} records)`} />
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Step</th>
              <th style={th}>This week</th>
              <th style={th}>Last week</th>
              <th style={th}>All time</th>
            </tr>
          </thead>
          <tbody>
            {r.steps.map(s => (
              <tr key={s.event} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ ...td, textAlign: 'left', color: C.inkSoft }}>{STEP_LABELS[s.event] || s.event}</td>
                <td style={{ ...td, fontWeight: 600 }}>{withPct(s.this_week, s.pct_this_week)}</td>
                <td style={td}>{withPct(s.last_week, s.pct_last_week)}</td>
                <td style={td}>{withPct(s.all_time, s.pct_all_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
          % = shops at this step ÷ shops at the step above, in the same period. Trials started {r.side.trial_started.this_week} · renewed {r.side.subscription_renewed.this_week} · churned {r.side.churned.this_week} this week.
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Top 10 shops by customer conversations</div>
        {r.top_shops.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No customer conversations this week.</div>}
        {r.top_shops.map((s, i) => (
          <div key={s.business_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
            <span style={{ color: C.inkSoft, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {s.name}</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              <b>{s.conversations}</b> <span style={{ color: C.muted }}>· {s.customers} customers</span>
              {onPick && <button onClick={() => onPick({ id: s.business_id })} style={{ appearance: 'none', border: 'none', background: 'transparent', color: C.accent, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 8 }}>Open ›</button>}
            </span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 2 }}>Onboarded, never got a customer message ({r.never_messaged.count})</div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Follow-up call list, newest first. ~ marks an approximate onboarding date.</div>
        {never.map((s, i) => (
          <div key={s.business_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
            <span style={{ color: C.inkSoft, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            <span style={{ whiteSpace: 'nowrap', color: C.muted }}>
              {day(s.onboarded_at)}{s.approximate ? ' ~' : ''}
              {onPick && <button onClick={() => onPick({ id: s.business_id })} style={{ appearance: 'none', border: 'none', background: 'transparent', color: C.accent, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 8 }}>Open ›</button>}
            </span>
          </div>
        ))}
        {r.never_messaged.count > 15 && (
          <button onClick={() => setShowAll(v => !v)} style={{ appearance: 'none', border: 'none', background: 'transparent', color: C.accent, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, padding: 0 }}>
            {showAll ? 'Show fewer' : `Show all ${r.never_messaged.count}`}
          </button>
        )}
      </div>
    </div>
  );
}
