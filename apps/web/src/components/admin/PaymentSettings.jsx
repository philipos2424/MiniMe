'use client';

import { useEffect, useState } from 'react';

const CARD = {
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '16px',
  padding: '20px',
};

const INPUT = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10,
  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)',
  color: '#F8FAFC', fontSize: 13, outline: 'none',
};

/**
 * Edit where MiniMe's money goes, and what the receipt says.
 *
 * These used to be Vercel env vars, which meant the person who owns the bank
 * account couldn't change them and they sat unset — so owners were shown a
 * placeholder account and told to pay it.
 *
 * Secret values (gateway API keys) are write-only here: the server returns
 * whether each is set, never the value. An admin screen is still somewhere a
 * screenshot or a shoulder can leak a live key.
 */
export default function PaymentSettings() {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/admin/settings', { cache: 'no-store' });
      if (r.status === 403) { setError('Not signed in as an admin.'); return; }
      const d = await r.json();
      if (d.ok) { setSettings(d.settings); setDraft({}); }
      else setError(d.error || 'Failed to load settings');
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!Object.keys(draft).length) return;
    setSaving(true); setStatus(''); setError('');
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: draft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setSettings(d.settings);
      setDraft({});
      setStatus(`Saved. ${d.saved} updated${d.cleared ? `, ${d.cleared} cleared` : ''}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <div style={{ ...CARD, color: '#F87171' }}>{error}</div>;
  if (!settings) return <div style={{ ...CARD, color: '#94A3B8' }}>Loading settings…</div>;

  const groups = settings.reduce((acc, s) => {
    (acc[s.group] = acc[s.group] || []).push(s);
    return acc;
  }, {});

  const dirty = Object.keys(draft).length;

  return (
    <div style={{ ...CARD, marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>⚙️ Payment settings</h2>
        <button onClick={save} disabled={!dirty || saving} style={{
          padding: '9px 18px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 700,
          cursor: dirty && !saving ? 'pointer' : 'default',
          background: dirty ? 'linear-gradient(135deg,#6366F1,#4F46E5)' : 'rgba(255,255,255,.06)',
          color: dirty ? '#fff' : '#64748B',
        }}>
          {saving ? 'Saving…' : dirty ? `Save ${dirty} change${dirty > 1 ? 's' : ''}` : 'No changes'}
        </button>
      </div>
      <p style={{ color: '#94A3B8', fontSize: 12.5, margin: '0 0 18px', lineHeight: 1.5 }}>
        Where your money goes and what the receipt says. A field left empty turns that
        payment method <strong>off</strong> for customers — better than showing an account
        that isn&apos;t yours.
      </p>

      {status && <div style={{ color: '#10B981', fontSize: 12.5, marginBottom: 12 }}>{status}</div>}
      {error && <div style={{ color: '#F87171', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      {Object.entries(groups).map(([group, items]) => (
        <div key={group} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase',
            letterSpacing: '.06em', marginBottom: 10,
          }}>
            {group}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {items.map(s => {
              const val = draft[s.key] !== undefined ? draft[s.key] : (s.secret ? '' : s.value);
              return (
                <label key={s.key} style={{ display: 'block' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: '#CBD5E1' }}>{s.label}</span>
                    {s.isSet
                      ? <span style={{ fontSize: 9.5, fontWeight: 700, color: '#10B981', background: 'rgba(16,185,129,.14)', padding: '1px 6px', borderRadius: 999 }}>SET</span>
                      : <span style={{ fontSize: 9.5, fontWeight: 700, color: '#F87171', background: 'rgba(239,68,68,.14)', padding: '1px 6px', borderRadius: 999 }}>EMPTY</span>}
                    {s.source === 'env' && (
                      <span title="Currently coming from an environment variable. Saving here overrides it."
                            style={{ fontSize: 9.5, color: '#94A3B8' }}>env</span>
                    )}
                  </div>
                  <input
                    type={s.secret ? 'password' : 'text'}
                    value={val}
                    autoComplete="off"
                    placeholder={s.secret ? (s.isSet ? '•••••• (leave blank to keep)' : 'Not set') : ''}
                    onChange={e => setDraft(d => ({ ...d, [s.key]: e.target.value }))}
                    style={INPUT}
                  />
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.5, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
        Secret keys are encrypted before storage and never sent back to this screen — leave a
        secret blank to keep the current one, or type a new value to replace it.
      </div>
    </div>
  );
}
