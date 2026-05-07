'use client';
/**
 * Agent console — redesigned with design tokens.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';

const AGENT_COLOR = '#6366F1';

const STATUS_LABEL = {
  draft: 'Draft', awaiting_approval: 'Awaiting', active: 'Active',
  blocked: 'Blocked', completed: 'Done', cancelled: 'Cancelled',
};
const STATUS_DOT_COLOR = {
  draft: COLORS.textHint, awaiting_approval: AGENT_COLOR, active: COLORS.teal,
  blocked: COLORS.red, completed: COLORS.green, cancelled: COLORS.textHint,
};

const INPUT_BASE = {
  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
  padding: '8px 12px', minHeight: 40, fontSize: 13, color: COLORS.textPrimary,
  fontFamily: FONT.body, outline: 'none', width: '100%', boxSizing: 'border-box',
};

export default function AgentPage() {
  const { initData } = useTelegram() || {};
  const [jobs, setJobs] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [teamCount, setTeamCount] = useState(null);

  const load = useCallback(async () => {
    if (!initData) return;
    const qs = filter === 'all' ? `?_=${Date.now()}` : `?status=${filter}&_=${Date.now()}`;
    const r = await fetch('/api/agent/jobs' + qs, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    const j = await r.json();
    setJobs(j.jobs || []);
  }, [initData, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/agent/team', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json()).then(j => setTeamCount((j.team || []).length)).catch(() => setTeamCount(0));
  }, [initData]);

  async function seedDemo() {
    setBusy(true);
    try { await fetch('/api/agent/jobs/seed', { method: 'POST', headers: { 'x-telegram-init-data': initData } }); await load(); }
    finally { setBusy(false); }
  }

  async function resetJobs() {
    if (!confirm('Reset ALL jobs, orders, and agent thoughts? Chat history with clients will be kept.')) return;
    setBusy(true);
    try {
      const r = await fetch('/api/agent/jobs/reset', { method: 'POST', headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      const lines = Object.entries(j.deleted || {}).map(([k, v]) => `${k}: deleted ${v}, remaining ${j.after?.[k] ?? '?'}`);
      const perBiz = (j.businesses || []).map(b =>
        `• ${b.name || b.business_id}: jobs ${b.before?.jobs || 0}→${b.after?.jobs || 0}, orders ${b.before?.orders || 0}→${b.after?.orders || 0}`
      ).join('\n');
      const header = `owner TG: ${j.owner_telegram_id}\nbusinesses scanned: ${j.businesses_scanned}\n${perBiz}`;
      if (!j.ok) alert(`⚠️ Reset incomplete:\n\n${header}\n\nTotals:\n${lines.join('\n')}\n\nErrors:\n${(j.errors || []).join('\n') || 'rows remain after delete — likely RLS blocked the delete'}`);
      else alert(`✓ Reset complete\n\n${header}\n\nTotals:\n${lines.join('\n')}\n\nConversations were kept.`);
      setJobs([]);
      await load();
    } catch (e) { alert(`Reset failed: ${e.message || 'unknown'}`); }
    finally { setBusy(false); }
  }

  const list = jobs || [];

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 24, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <header style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>MiniMe Agent</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>Jobs your AI is running</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setShowNew(true)} style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body }}>+ New</button>
          {list.length > 0 && (
            <button onClick={resetJobs} disabled={busy} style={{ fontSize: 12, color: COLORS.textHint, background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontFamily: FONT.body }}
              onMouseEnter={e => e.currentTarget.style.color = COLORS.red}
              onMouseLeave={e => e.currentTarget.style.color = COLORS.textHint}
            >Reset</button>
          )}
        </div>
      </header>

      {/* Quick access cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {[
          { href: '/agent/knowledge', icon: '📚', label: 'Teach' },
          { href: '/agent/brain',     icon: '🧠', label: 'Brain' },
          { href: '/agent/team',      icon: '👥', label: 'Team' },
        ].map(c => (
          <Link key={c.href} href={c.href} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
            padding: 12, textDecoration: 'none', boxShadow: SHADOW.card, transition: 'border-color 0.15s',
          }}>
            <span style={{ fontSize: 20 }}>{c.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>{c.label}</span>
          </Link>
        ))}
      </div>

      {/* No team warning */}
      {teamCount === 0 && (jobs?.length || 0) > 0 && (
        <div style={{ marginBottom: 16, border: `1px solid ${COLORS.amber}40`, background: COLORS.amberLight, borderRadius: RADII.lg, padding: 12, fontSize: 13, color: '#92400E' }}>
          ⚠️ No team set up yet — the Agent can't fan out to designers or printers until you add them.{' '}
          <Link href="/agent/team" style={{ color: '#92400E', fontWeight: 600, textDecoration: 'underline' }}>Set up Team →</Link>
        </div>
      )}

      {showNew && <NewJobModal initData={initData} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      {/* Filter pills */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 16,
        overflowX: 'auto', msOverflowStyle: 'none', scrollbarWidth: 'none',
      }}>
        {[['all', 'All'], ['active', 'Active'], ['awaiting_approval', 'Awaiting'], ['completed', 'Done']].map(([v, label]) => {
          const isActive = filter === v;
          const isUrgent = v === 'active' && !isActive && list.some(j => j.status === 'active');
          return (
            <button key={v} onClick={() => setFilter(v)} style={{
              flexShrink: 0, appearance: 'none',
              padding: '6px 14px', borderRadius: 999,
              background: isActive ? COLORS.textPrimary : 'transparent',
              border: `1px solid ${isActive ? COLORS.textPrimary : isUrgent ? COLORS.teal + '80' : COLORS.border}`,
              color: isActive ? '#FFFFFF' : isUrgent ? COLORS.teal : COLORS.textSecondary,
              fontSize: 12, fontWeight: 500, fontFamily: FONT.body,
              cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
            }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {jobs === null && <ListSkeleton />}
      {jobs !== null && jobs.length === 0 && <AgentEmpty onSeed={seedDemo} onNew={() => setShowNew(true)} busy={busy} />}
      {jobs !== null && jobs.length > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, overflow: 'hidden', boxShadow: SHADOW.card }}>
          {jobs.map((j, i) => <JobRow key={j.id} job={j} isLast={i === jobs.length - 1} />)}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, isLast }) {
  const client = job.customers?.name || job.client_snapshot?.name || 'Client';
  const deadlineLabel = job.deadline ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const value = job.budget ? `${Number(job.budget).toLocaleString()} ${job.currency || 'ETB'}` : null;
  const dotColor = STATUS_DOT_COLOR[job.status] || COLORS.textHint;

  return (
    <Link href={`/agent/${job.id}`} style={{ textDecoration: 'none', display: 'block', borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = COLORS.bg}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, marginTop: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{ fontWeight: 600, fontSize: 14, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</h3>
            {value && (
              <span style={{
                fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400,
                fontSize: 14, color: COLORS.teal, flexShrink: 0,
              }}>{value}</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {client}
            {deadlineLabel && <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>}
            {deadlineLabel}
            <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
            {STATUS_LABEL[job.status] || job.status}
          </p>
        </div>
      </div>
    </Link>
  );
}

function AgentEmpty({ onSeed, onNew, busy }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 16px' }}>
      <p style={{ fontSize: 14, color: COLORS.textHint, marginBottom: 16 }}>No jobs yet.</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <button onClick={onNew} disabled={busy} style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal, background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontFamily: FONT.body, opacity: busy ? 0.5 : 1 }}>+ Create a job</button>
        <span style={{ fontSize: 11, color: COLORS.textHint }}>·</span>
        <button onClick={onSeed} disabled={busy} style={{ fontSize: 13, color: COLORS.textHint, background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontFamily: FONT.body, opacity: busy ? 0.5 : 1 }}>{busy ? 'Loading…' : 'Load sample'}</button>
      </div>
    </div>
  );
}

function NewJobModal({ initData, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', clientName: '', clientContact: '', deadline: '', budget: '', currency: 'ETB' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e?.preventDefault?.();
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/agent/jobs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          title: form.title.trim(), description: form.description.trim() || null,
          clientName: form.clientName.trim() || null, clientContact: form.clientContact.trim() || null,
          deadline: form.deadline || null, budget: form.budget ? Number(form.budget) : null, currency: form.currency || 'ETB',
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Failed'); }
      onCreated();
    } catch (e) { setErr(e.message || 'Failed to create.'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: `${RADII.xl}px ${RADII.xl}px 0 0`, padding: 20, maxHeight: '92vh', overflowY: 'auto', fontFamily: FONT.body,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>New job</h2>
          <button type="button" onClick={onClose} style={{ fontSize: 13, color: COLORS.textHint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body }}>Close</button>
        </div>

        <ModalField label="Title *"><input value={form.title} onChange={e => update('title', e.target.value)} placeholder="Gala branded materials" style={INPUT_BASE} /></ModalField>
        <ModalField label="Description"><textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="200 programs, 50 table cards, 10 banners…" rows={3} style={{ ...INPUT_BASE, resize: 'none' }} /></ModalField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ModalField label="Client name"><input value={form.clientName} onChange={e => update('clientName', e.target.value)} placeholder="Romina PLC" style={INPUT_BASE} /></ModalField>
          <ModalField label="Contact"><input value={form.clientContact} onChange={e => update('clientContact', e.target.value)} placeholder="Dawit · 0911…" style={INPUT_BASE} /></ModalField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <ModalField label="Deadline"><input type="date" value={form.deadline} onChange={e => update('deadline', e.target.value)} style={INPUT_BASE} /></ModalField>
          <ModalField label="Budget"><input type="number" inputMode="numeric" value={form.budget} onChange={e => update('budget', e.target.value)} placeholder="45000" style={INPUT_BASE} /></ModalField>
          <ModalField label="Currency">
            <select value={form.currency} onChange={e => update('currency', e.target.value)} style={INPUT_BASE}>
              <option value="ETB">ETB</option><option value="USD">USD</option>
            </select>
          </ModalField>
        </div>

        {err && <p style={{ fontSize: 12, color: COLORS.red, marginTop: 8 }}>{err}</p>}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ fontSize: 13, color: COLORS.textHint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body }}>Cancel</button>
          <button type="submit" disabled={saving} style={{
            fontSize: 13, fontWeight: 600, background: `${COLORS.teal}22`, border: `1px solid ${COLORS.teal}40`,
            color: COLORS.textPrimary, borderRadius: RADII.md, padding: '8px 16px',
            cursor: saving ? 'default' : 'pointer', fontFamily: FONT.body, opacity: saving ? 0.5 : 1,
            transition: 'background 0.15s',
          }}>
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalField({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: COLORS.textHint, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function ListSkeleton() {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, overflow: 'hidden' }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="animate-pulse" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: i < 2 ? `1px solid ${COLORS.border}` : 'none' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.border, marginTop: 8 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 16, width: '60%', background: COLORS.border, borderRadius: RADII.sm, marginBottom: 8 }} />
            <div style={{ height: 12, width: '40%', background: COLORS.border, borderRadius: RADII.sm }} />
          </div>
        </div>
      ))}
    </div>
  );
}
