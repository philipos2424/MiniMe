'use client';

import { useState, useEffect } from 'react';
import { PAYMENT_STATE_LABELS } from '../../../lib/paymentState';

const TONE = {
  good:    { fg: '#10B981', bg: 'rgba(16,185,129,.14)',  bd: 'rgba(16,185,129,.35)' },
  warn:    { fg: '#F59E0B', bg: 'rgba(245,158,11,.14)',  bd: 'rgba(245,158,11,.35)' },
  danger:  { fg: '#F87171', bg: 'rgba(239,68,68,.14)',   bd: 'rgba(239,68,68,.35)' },
  neutral: { fg: '#38BDF8', bg: 'rgba(56,189,248,.14)',  bd: 'rgba(56,189,248,.35)' },
  muted:   { fg: '#94A3B8', bg: 'rgba(148,163,184,.12)', bd: 'rgba(148,163,184,.3)' },
};

const CARD = {
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '16px',
  padding: '20px',
};

function Pill({ state }) {
  const meta = PAYMENT_STATE_LABELS[state] || PAYMENT_STATE_LABELS.free;
  const t = TONE[meta.tone];
  return (
    <span title={meta.hint} style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      color: t.fg, background: t.bg, border: `1px solid ${t.bd}`,
    }}>
      {meta.label}
    </span>
  );
}

function Kpi({ label, value, color = '#F8FAFC', hint }) {
  return (
    <div style={CARD}>
      <div style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 800, color, marginTop: '4px' }}>{value}</div>
      {hint && <div style={{ fontSize: '11.5px', color: '#64748B', marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

export default function AdminPaymentsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(state) {
    setLoading(true);
    try {
      const qs = state ? `?state=${state}` : '';
      const res = await fetch(`/api/admin/payments${qs}`, { cache: 'no-store' });
      if (res.status === 403) { setError('Not signed in as an admin.'); return; }
      const d = await res.json();
      if (d.ok) { setData(d); setError(''); } else setError(d.error || 'Failed to load');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(filter); }, [filter]);

  if (error) return <div style={{ color: '#F87171', padding: 40, textAlign: 'center' }}>{error}</div>;
  if (!data && loading) return <div style={{ color: '#FFF', padding: 40, textAlign: 'center' }}>Loading payments…</div>;

  const s = data?.summary || {};
  const t = data?.totals || {};

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: "'Geist','Inter',sans-serif", color: '#F8FAFC' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>💰 Payments</h1>
      <p style={{ color: '#94A3B8', fontSize: 14, marginBottom: 28, lineHeight: 1.5 }}>
        Who has actually paid — as opposed to who merely has Pro access. These are different
        questions, and conflating them is why the platform can show hundreds of “Pro” shops
        with no money behind them.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px,1fr))', gap: 16, marginBottom: 28 }}>
        <Kpi label="Collected (ETB)" value={(t.revenue_etb || 0).toLocaleString()} color="#10B981"
             hint="Completed inbound payments recorded in ETB." />
        <Kpi label="Paying shops" value={(s.paid || 0) + (s.claimed || 0)} color="#10B981"
             hint={`${s.paid || 0} verified · ${s.claimed || 0} awaiting spot-check`} />
        <Kpi label="Granted, unpaid" value={t.granted_unpaid || 0} color="#F87171"
             hint="Pro access with no payment on record. Reconcile these." />
        <Kpi label="On trial" value={s.trial || 0} color="#38BDF8"
             hint="Inside the free month." />
        <Kpi label="Free / expired" value={(s.free || 0) + (s.expired || 0)} color="#94A3B8"
             hint="No Pro access today." />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['', 'paid', 'claimed', 'granted', 'trial', 'free', 'expired'].map(k => (
          <button key={k || 'all'} onClick={() => setFilter(k)} style={{
            padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            background: filter === k ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${filter === k ? '#6366F1' : 'rgba(255,255,255,.08)'}`,
            color: '#F8FAFC',
          }}>
            {k ? (PAYMENT_STATE_LABELS[k]?.label || k) : 'All'}
            {k && s[k] != null ? ` (${s[k]})` : ''}
          </button>
        ))}
      </div>

      {/* Businesses */}
      <div style={{ ...CARD, padding: 0, overflowX: 'auto', marginBottom: 32 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
          <thead>
            <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              {['Business', 'Status', 'Payments', 'Paid (ETB)', 'Method', 'Reference', 'Expires'].map(h => (
                <th key={h} style={{ padding: '12px 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.businesses || []).map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <td style={{ padding: '11px 14px' }}>
                  <div style={{ fontWeight: 600 }}>{b.name || '—'}</div>
                  <div style={{ color: '#64748B', fontSize: 11 }}>
                    {b.owner || '—'}{b.onboarded ? '' : ' · not onboarded'}
                  </div>
                </td>
                <td style={{ padding: '11px 14px' }}><Pill state={b.state} /></td>
                <td style={{ padding: '11px 14px', color: b.payments ? '#F8FAFC' : '#64748B' }}>{b.payments}</td>
                <td style={{ padding: '11px 14px', color: b.paid_etb ? '#10B981' : '#64748B', fontWeight: b.paid_etb ? 600 : 400 }}>
                  {b.paid_etb ? b.paid_etb.toLocaleString() : '—'}
                </td>
                <td style={{ padding: '11px 14px', color: '#94A3B8' }}>{b.method || '—'}</td>
                <td style={{ padding: '11px 14px', color: '#94A3B8', fontFamily: 'monospace', fontSize: 11 }}>{b.reference || '—'}</td>
                <td style={{ padding: '11px 14px', color: '#94A3B8', whiteSpace: 'nowrap' }}>
                  {b.expires_at ? new Date(b.expires_at).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
            {!(data?.businesses || []).length && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>Nothing in this bucket.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Payment ledger */}
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Recent payments</h2>
      <div style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
          <thead>
            <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              {['Date', 'Amount', 'Method', 'Status', 'Reference'].map(h => (
                <th key={h} style={{ padding: '12px 14px', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.recent_payments || []).map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                <td style={{ padding: '11px 14px', color: '#94A3B8' }}>{new Date(p.created_at).toLocaleDateString('en-GB')}</td>
                <td style={{ padding: '11px 14px', fontWeight: 600, color: '#10B981' }}>
                  {Number(p.amount).toLocaleString()} {p.currency}
                </td>
                <td style={{ padding: '11px 14px', color: '#94A3B8', textTransform: 'capitalize' }}>{p.method}</td>
                <td style={{ padding: '11px 14px', color: '#94A3B8' }}>{p.status}</td>
                <td style={{ padding: '11px 14px', color: '#94A3B8', fontFamily: 'monospace', fontSize: 11 }}>{p.reference || '—'}</td>
              </tr>
            ))}
            {!(data?.recent_payments || []).length && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>
                No payments recorded yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
