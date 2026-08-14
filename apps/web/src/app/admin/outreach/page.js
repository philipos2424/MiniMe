'use client';
/**
 * /admin/outreach — marketing/sales outreach + feedback-prompt console.
 *
 * Standalone route (not a tab in the ~4,500-line admin/page.js), following
 * the same precedent as /admin/ux and /admin/search-analytics. Self-contained
 * dual-auth block matches those pages' convention rather than sharing a hook.
 *
 * Four sub-tabs:
 *  - Rules: outreach_rules CRUD — the admin-editable auto-trigger config the
 *    cron/outreach-rules engine reads.
 *  - Campaigns: compose/send/schedule one-off broadcasts to a segment.
 *  - Send History: outreach_sends ledger (both rule fires and campaigns).
 *  - Feedback Prompts: sent-vs-responded stats for proactive feedback asks.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';

const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";
const C = {
  bg: '#FBF6EC', card: '#FFFFFF', border: '#E8DFD0', muted: '#8A7560',
  ink: '#1A0F08', accent: '#8B2E1F', teal: '#4FA38A',
};

const SEGMENTS = [
  ['all', 'All onboarded owners'],
  ['shared', 'Shared bot (no linked bot)'],
  ['linked', 'Linked their own bot'],
  ['inactive_7d', 'Inactive 7+ days'],
  ['no_products', 'No products yet'],
  ['never_taught', 'Never taught (no docs/products)'],
  ['incomplete_onboarding', 'Incomplete onboarding'],
];
const TRIGGER_TYPES = ['days_since_signup', 'days_since_active', 'trial_stage', 'usage_milestone', 'plan_tier', 'inactivity'];
const KINDS = ['nudge', 'feedback_prompt'];
const SEND_STATUSES = ['sent', 'failed', 'skipped_optout', 'skipped_cooldown', 'blocked'];

function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} disabled={disabled} style={{
      appearance: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
      width: 36, height: 20, borderRadius: 999, position: 'relative',
      background: on ? '#5A7A3F' : C.border,
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.15s' }} />
    </button>
  );
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, ...style }}>{children}</div>;
}

const inputStyle = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', color: C.ink, background: '#FFFDF9', boxSizing: 'border-box' };
const btnStyle = { appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, borderRadius: 6, padding: '7px 12px' };

export default function OutreachAdminPage() {
  const { initData: telegramInitData, loading: telegramLoading } = useTelegram() || {};
  const [cookieAdmin, setCookieAdmin] = useState(undefined);
  useEffect(() => {
    if (telegramLoading || telegramInitData) return;
    fetch('/api/admin/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setCookieAdmin(j?.admin || null))
      .catch(() => setCookieAdmin(null));
  }, [telegramLoading, telegramInitData]);
  const initData = telegramInitData || (cookieAdmin ? 'session' : null);
  const cookieProbeInFlight = !telegramLoading && !telegramInitData && cookieAdmin === undefined;

  const [tab, setTab] = useState('rules');

  if (telegramLoading || cookieProbeInFlight) {
    return <div style={{ padding: 40, fontFamily: SERIF, color: C.muted }}>Checking your session…</div>;
  }
  if (!initData) {
    if (typeof window !== 'undefined') window.location.href = '/admin/login';
    return <div style={{ padding: 40, fontFamily: SERIF, color: C.muted }}>Taking you to sign in…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'system-ui, sans-serif', paddingBottom: 60 }}>
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '20px 24px', background: C.card }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <a href="/admin" style={{ fontSize: 12, color: C.muted, textDecoration: 'none', fontWeight: 600 }}>← Master admin</a>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.muted, marginTop: 10 }}>MiniMe · Platform admin</div>
          <h1 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, letterSpacing: '-0.03em', margin: 0, marginTop: 2 }}>📣 Outreach &amp; Feedback</h1>
        </div>
        <nav style={{ display: 'flex', gap: 4, marginTop: 16, maxWidth: 1100, margin: '16px auto 0' }}>
          {[['rules', 'Rules'], ['campaigns', 'Campaigns'], ['sends', 'Send History'], ['feedback', 'Feedback Prompts']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
              padding: '8px 14px', fontSize: 13, fontWeight: 500,
              color: tab === k ? C.accent : C.muted,
              borderBottom: tab === k ? `2px solid ${C.accent}` : '2px solid transparent',
              marginBottom: -1,
            }}>{l}</button>
          ))}
        </nav>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        {tab === 'rules' && <RulesTab initData={initData} />}
        {tab === 'campaigns' && <CampaignsTab initData={initData} />}
        {tab === 'sends' && <SendsTab initData={initData} />}
        {tab === 'feedback' && <FeedbackPromptsTab initData={initData} />}
      </div>
    </div>
  );
}

// ── Rules tab ────────────────────────────────────────────────────────────
const EMPTY_RULE = { key: '', name: '', description: '', kind: 'nudge', trigger_type: 'days_since_signup', trigger_config: '{}', message_template: '', feedback_prompt_kind: '', cooldown_days: 21, max_sends: 2, priority: 100 };

function RulesTab({ initData }) {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...rule} = edit
  const [form, setForm] = useState(EMPTY_RULE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/outreach/rules', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load rules');
      setRules(j.rules || []);
    } catch (e) { setError(e.message); }
  }, [initData]);
  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(EMPTY_RULE); setEditing({}); }
  function openEdit(rule) {
    setForm({ ...rule, trigger_config: JSON.stringify(rule.trigger_config || {}, null, 2), feedback_prompt_kind: rule.feedback_prompt_kind || '' });
    setEditing(rule);
  }

  async function toggleEnabled(rule, on) {
    setRules(rs => rs.map(r => r.id === rule.id ? { ...r, enabled: on } : r));
    await fetch(`/api/admin/outreach/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ enabled: on }),
    }).catch(() => load());
  }

  async function remove(rule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/outreach/rules/${rule.id}`, { method: 'DELETE', headers: { 'x-telegram-init-data': initData } });
    load();
  }

  async function save() {
    let triggerConfig;
    try { triggerConfig = JSON.parse(form.trigger_config || '{}'); }
    catch { setError('trigger_config must be valid JSON'); return; }

    setSaving(true);
    setError(null);
    const isNew = !editing?.id;
    const payload = {
      name: form.name, description: form.description, trigger_config: triggerConfig,
      message_template: form.message_template, feedback_prompt_kind: form.feedback_prompt_kind || null,
      cooldown_days: Number(form.cooldown_days), max_sends: Number(form.max_sends), priority: Number(form.priority),
    };
    if (isNew) { payload.key = form.key; payload.kind = form.kind; payload.trigger_type = form.trigger_type; }

    try {
      const r = await fetch(isNew ? '/api/admin/outreach/rules' : `/api/admin/outreach/rules/${editing.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || j.message || 'Save failed');
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{rules?.length ?? '…'} rule(s)</div>
        <button onClick={openNew} style={{ ...btnStyle, background: C.accent, color: '#fff' }}>+ New rule</button>
      </div>
      {error && <div style={{ marginBottom: 12, color: '#9A3412', fontSize: 13 }}>{error}</div>}

      {editing !== null && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, marginBottom: 12 }}>{editing?.id ? `Edit "${editing.name}"` : 'New rule'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {!editing?.id && (
              <>
                <label style={{ fontSize: 11, color: C.muted }}>Key (stable slug)
                  <input style={inputStyle} value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. inactive_30d" />
                </label>
                <label style={{ fontSize: 11, color: C.muted }}>Kind
                  <select style={inputStyle} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                    {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 11, color: C.muted }}>Trigger type
                  <select style={inputStyle} value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
                    {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </>
            )}
            <label style={{ fontSize: 11, color: C.muted }}>Name
              <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label style={{ fontSize: 11, color: C.muted, gridColumn: '1 / -1' }}>Description
              <input style={inputStyle} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            <label style={{ fontSize: 11, color: C.muted, gridColumn: '1 / -1' }}>
              Trigger config (JSON — e.g. {'{"days":14}'} or {'{"phase":"warn","at_or_below_days":7,"stage_value":7}'})
              <textarea style={{ ...inputStyle, fontFamily: MONO, minHeight: 60 }} value={form.trigger_config} onChange={e => setForm(f => ({ ...f, trigger_config: e.target.value }))} />
            </label>
            <label style={{ fontSize: 11, color: C.muted, gridColumn: '1 / -1' }}>
              Message template (supports {'{{owner_name}}'}, {'{{business_name}}'})
              <textarea style={{ ...inputStyle, minHeight: 90 }} value={form.message_template} onChange={e => setForm(f => ({ ...f, message_template: e.target.value }))} />
            </label>
            {form.kind === 'feedback_prompt' && (
              <label style={{ fontSize: 11, color: C.muted }}>Feedback prompt kind
                <select style={inputStyle} value={form.feedback_prompt_kind} onChange={e => setForm(f => ({ ...f, feedback_prompt_kind: e.target.value }))}>
                  <option value="">—</option>
                  <option value="nps">nps</option>
                  <option value="category">category</option>
                  <option value="free_text">free_text</option>
                </select>
              </label>
            )}
            <label style={{ fontSize: 11, color: C.muted }}>Cooldown (days)
              <input type="number" style={inputStyle} value={form.cooldown_days} onChange={e => setForm(f => ({ ...f, cooldown_days: e.target.value }))} />
            </label>
            <label style={{ fontSize: 11, color: C.muted }}>Max sends (lifetime)
              <input type="number" style={inputStyle} value={form.max_sends} onChange={e => setForm(f => ({ ...f, max_sends: e.target.value }))} />
            </label>
            <label style={{ fontSize: 11, color: C.muted }}>Priority (lower fires first)
              <input type="number" style={inputStyle} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={save} disabled={saving} style={{ ...btnStyle, background: C.teal, color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(null)} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>Cancel</button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${C.border}`, color: C.muted, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 12px' }}>Key</th><th>Kind</th><th>Trigger</th><th>Cooldown</th><th>Max</th><th>Priority</th><th>On</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(rules || []).map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px', fontFamily: MONO }}>{r.key}<div style={{ color: C.muted, fontFamily: 'inherit' }}>{r.name}</div></td>
                <td>{r.kind}</td>
                <td>{r.trigger_type}</td>
                <td>{r.cooldown_days}d</td>
                <td>{r.max_sends}</td>
                <td>{r.priority}</td>
                <td><Toggle on={r.enabled} onChange={on => toggleEnabled(r, on)} /></td>
                <td>
                  <button onClick={() => openEdit(r)} style={{ ...btnStyle, background: 'transparent', color: C.teal, padding: '4px 8px' }}>Edit</button>
                  <button onClick={() => remove(r)} style={{ ...btnStyle, background: 'transparent', color: C.accent, padding: '4px 8px' }}>Delete</button>
                </td>
              </tr>
            ))}
            {rules && !rules.length && <tr><td colSpan={8} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No rules yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Campaigns tab ────────────────────────────────────────────────────────
function CampaignsTab({ initData }) {
  const [campaigns, setCampaigns] = useState(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState('all');
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/outreach/campaigns', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setCampaigns(j.campaigns || []);
  }, [initData]);
  useEffect(() => { load(); }, [load]);

  async function submit(asDraft) {
    if (!message.trim()) { setError('Message is required'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch('/api/admin/outreach/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ name: name || `Campaign ${new Date().toLocaleDateString()}`, message, segment, scheduled_for: scheduledFor || null, as_draft: asDraft }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Send failed');
      setResult(j);
      setMessage(''); setName(''); setScheduledFor('');
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function cancel(c) {
    await fetch(`/api/admin/outreach/campaigns/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'cancel' }),
    });
    load();
  }

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: SERIF, fontSize: 17, marginBottom: 12 }}>Compose campaign</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ fontSize: 11, color: C.muted }}>Name (internal)
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. September feature announcement" />
          </label>
          <label style={{ fontSize: 11, color: C.muted }}>Segment
            <select style={inputStyle} value={segment} onChange={e => setSegment(e.target.value)}>
              {SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: C.muted, gridColumn: '1 / -1' }}>Message
            <textarea style={{ ...inputStyle, minHeight: 100 }} value={message} onChange={e => setMessage(e.target.value)} placeholder="Markdown supported. A STOP/privacy footer and the Open MiniMe button are added automatically." />
          </label>
          <label style={{ fontSize: 11, color: C.muted }}>Schedule for (optional, leave blank to send now)
            <input type="datetime-local" style={inputStyle} value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
          </label>
        </div>
        {error && <div style={{ marginTop: 10, color: '#9A3412', fontSize: 13 }}>{error}</div>}
        {result && <div style={{ marginTop: 10, color: C.teal, fontSize: 13 }}>
          {result.campaign?.status === 'scheduled' ? 'Scheduled.' : result.campaign?.status === 'draft' ? 'Saved as draft.' : `Sent: ${result.sent} · Failed: ${result.failed} · Blocked: ${result.blocked || 0}`}
        </div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => submit(false)} disabled={busy} style={{ ...btnStyle, background: C.accent, color: '#fff' }}>
            {busy ? 'Working…' : scheduledFor ? 'Schedule' : 'Send now'}
          </button>
          <button onClick={() => submit(true)} disabled={busy} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>Save as draft</button>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${C.border}`, color: C.muted, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 12px' }}>Name</th><th>Status</th><th>Recipients</th><th>Sent</th><th>Failed</th><th>When</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(campaigns || []).map(c => (
              <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px' }}>{c.name}</td>
                <td>{c.status}</td>
                <td>{c.recipient_count ?? '—'}</td>
                <td>{c.sent_count}</td>
                <td>{c.failed_count}</td>
                <td style={{ fontFamily: MONO, fontSize: 11 }}>{c.sent_at ? new Date(c.sent_at).toLocaleString() : c.scheduled_for ? new Date(c.scheduled_for).toLocaleString() : new Date(c.created_at).toLocaleString()}</td>
                <td>{c.status === 'scheduled' && <button onClick={() => cancel(c)} style={{ ...btnStyle, background: 'transparent', color: C.accent, padding: '4px 8px' }}>Cancel</button>}</td>
              </tr>
            ))}
            {campaigns && !campaigns.length && <tr><td colSpan={7} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Send History tab ─────────────────────────────────────────────────────
function SendsTab({ initData }) {
  const [sends, setSends] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (status) params.set('status', status);
    const r = await fetch(`/api/admin/outreach/sends?${params}`, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setSends(j.sends || []); setTotal(j.total || 0); }
  }, [initData, status, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select style={{ ...inputStyle, width: 'auto' }} value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}>
            <option value="">All statuses</option>
            {SEND_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{total} total</span>
        </div>
        <button onClick={() => downloadCsv('outreach_sends.csv', sends || [])} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>Export CSV</button>
      </div>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${C.border}`, color: C.muted, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 12px' }}>Business</th><th>Source</th><th>Status</th><th>Error</th><th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {(sends || []).map(s => (
              <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px' }}>{s.business_name}</td>
                <td>{s.source_type === 'rule' ? `rule: ${s.rule_key || s.rule_id}` : 'campaign'}</td>
                <td style={{ color: s.status === 'sent' ? C.teal : s.status === 'failed' || s.status === 'blocked' ? C.accent : C.muted }}>{s.status}</td>
                <td style={{ color: C.muted, fontSize: 11 }}>{s.telegram_error || '—'}</td>
                <td style={{ fontFamily: MONO, fontSize: 11 }}>{new Date(s.sent_at).toLocaleString()}</td>
              </tr>
            ))}
            {sends && !sends.length && <tr><td colSpan={5} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No sends yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>← Prev</button>
        <span style={{ fontSize: 12, color: C.muted }}>Page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}</span>
        <button onClick={() => setPage(p => (p + 1) * pageSize < total ? p + 1 : p)} disabled={(page + 1) * pageSize >= total} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted }}>Next →</button>
      </div>
    </div>
  );
}

// ── Feedback Prompts tab ─────────────────────────────────────────────────
function FeedbackPromptsTab({ initData }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/api/admin/outreach/feedback-prompts', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(r => r.json()).then(setStats).catch(() => {});
  }, [initData]);

  if (!stats) return <div style={{ color: C.muted }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <Card><div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Prompts sent</div><div style={{ fontFamily: SERIF, fontSize: 26 }}>{stats.total_sent}</div></Card>
        <Card><div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Responded</div><div style={{ fontFamily: SERIF, fontSize: 26 }}>{stats.total_responded}</div></Card>
        <Card><div style={{ fontFamily: MONO, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Response rate</div><div style={{ fontFamily: SERIF, fontSize: 26, color: C.teal }}>{stats.overall_response_rate}%</div></Card>
      </div>
      <Card style={{ padding: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `1px solid ${C.border}`, color: C.muted, fontFamily: MONO, fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '8px 12px' }}>Rule</th><th>Sent</th><th>Responded</th><th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {(stats.by_rule || []).map(r => (
              <tr key={r.rule_id || 'unknown'} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 12px' }}>{r.rule_name}{r.rule_key && <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11 }}> ({r.rule_key})</span>}</td>
                <td>{r.sent}</td>
                <td>{r.responded}</td>
                <td>{r.response_rate}%</td>
              </tr>
            ))}
            {!stats.by_rule?.length && <tr><td colSpan={4} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No feedback prompts sent yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
