'use client';
/**
 * Agent console — classic, minimal job list.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';

const STATUS_LABEL = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting',
  active: 'Active',
  blocked: 'Blocked',
  completed: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_DOT = {
  draft: 'bg-muted',
  awaiting_approval: 'bg-agent',
  active: 'bg-gold',
  blocked: 'bg-red-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-muted',
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
    const r = await fetch('/api/agent/jobs' + (filter === 'all' ? '' : `?status=${filter}`), {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setJobs(j.jobs || []);
  }, [initData, filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/agent/team', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json())
      .then(j => setTeamCount((j.team || []).length))
      .catch(() => setTeamCount(0));
  }, [initData]);

  async function seedDemo() {
    setBusy(true);
    try {
      await fetch('/api/agent/jobs/seed', { method: 'POST', headers: { 'x-telegram-init-data': initData } });
      await load();
    } finally { setBusy(false); }
  }

  async function resetJobs() {
    if (!confirm('Delete all jobs?')) return;
    setBusy(true);
    try {
      await fetch('/api/agent/jobs/reset', { method: 'POST', headers: { 'x-telegram-init-data': initData } });
      await load();
    } finally { setBusy(false); }
  }

  const list = jobs || [];

  return (
    <div className="max-w-xl mx-auto pb-6">
      {/* Simple header */}
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl text-gold-light">Agent</h1>
          <p className="text-muted text-sm mt-0.5">Jobs your agent is running</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/agent/team" className="text-sm text-muted hover:text-gold-light transition">Team</Link>
          <button
            onClick={() => setShowNew(true)}
            className="text-sm font-medium text-gold hover:text-gold-light transition"
          >
            + New
          </button>
          {list.length > 0 && (
            <button onClick={resetJobs} disabled={busy} className="text-xs text-muted hover:text-red-400 transition">
              Reset
            </button>
          )}
        </div>
      </header>

      {teamCount === 0 && (jobs?.length || 0) > 0 && (
        <div className="mb-4 border border-amber-500/30 bg-amber-500/10 rounded-xl p-3 text-sm text-amber-200">
          ⚠️ No team set up yet — the Agent can't fan out to designers or printers until you add them.{' '}
          <Link href="/agent/team" className="underline text-amber-100 hover:text-white">Set up Team →</Link>
        </div>
      )}

      {showNew && (
        <NewJobModal
          initData={initData}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {/* Filter tabs (inline, underlined) */}
      <div className="flex gap-5 border-b border-border mb-4">
        {[
          ['all', 'All'],
          ['active', 'Active'],
          ['awaiting_approval', 'Awaiting'],
          ['completed', 'Done'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`pb-2.5 text-sm transition relative ${
              filter === v ? 'text-gold-light font-medium' : 'text-muted'
            }`}
          >
            {label}
            {filter === v && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-gold" />
            )}
          </button>
        ))}
      </div>

      {jobs === null && <ListSkeleton />}
      {jobs !== null && jobs.length === 0 && (
        <EmptyState onSeed={seedDemo} onNew={() => setShowNew(true)} busy={busy} />
      )}
      {jobs !== null && jobs.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-2xl overflow-hidden bg-card">
          {jobs.map(j => <JobRow key={j.id} job={j} />)}
        </ul>
      )}
    </div>
  );
}

function JobRow({ job }) {
  const client = job.customers?.name || job.client_snapshot?.name || 'Client';
  const deadlineLabel = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  const value = job.budget ? `${Number(job.budget).toLocaleString()} ${job.currency || 'ETB'}` : null;

  return (
    <li>
      <Link href={`/agent/${job.id}`} className="flex items-start gap-3 p-4 hover:bg-border/20 transition active:bg-border/30">
        <span className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${STATUS_DOT[job.status] || 'bg-muted'} ${job.status === 'active' ? 'animate-pulse' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-medium text-gold-light truncate">{job.title}</h3>
            {value && <span className="text-gold text-sm tabular-nums flex-shrink-0">{value}</span>}
          </div>
          <p className="text-muted text-xs mt-0.5 truncate">
            {client}
            {deadlineLabel && <span className="mx-1.5 opacity-60">·</span>}
            {deadlineLabel}
            <span className="mx-1.5 opacity-60">·</span>
            {STATUS_LABEL[job.status] || job.status}
          </p>
        </div>
      </Link>
    </li>
  );
}

function EmptyState({ onSeed, onNew, busy }) {
  return (
    <div className="text-center py-10">
      <p className="text-muted text-sm mb-4">No jobs yet.</p>
      <div className="flex items-center justify-center gap-5">
        <button
          onClick={onNew}
          disabled={busy}
          className="text-sm font-medium text-gold hover:text-gold-light transition disabled:opacity-50"
        >
          + Create a job
        </button>
        <span className="text-muted/50 text-xs">·</span>
        <button
          onClick={onSeed}
          disabled={busy}
          className="text-sm text-muted hover:text-gold-light transition disabled:opacity-50"
        >
          {busy ? 'Loading…' : 'Load sample'}
        </button>
      </div>
    </div>
  );
}

function NewJobModal({ initData, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '',
    clientName: '', clientContact: '',
    deadline: '', budget: '', currency: 'ETB',
  });
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
          title: form.title.trim(),
          description: form.description.trim() || null,
          clientName: form.clientName.trim() || null,
          clientContact: form.clientContact.trim() || null,
          deadline: form.deadline || null,
          budget: form.budget ? Number(form.budget) : null,
          currency: form.currency || 'ETB',
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Failed');
      }
      onCreated();
    } catch (e) {
      setErr(e.message || 'Failed to create.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-gold-light">New job</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-gold-light text-sm">Close</button>
        </div>

        <Field label="Title *">
          <input
            value={form.title} onChange={e => update('title', e.target.value)}
            placeholder="Gala branded materials"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description} onChange={e => update('description', e.target.value)}
            placeholder="200 programs, 50 table cards, 10 banners…"
            rows={3}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50 resize-none"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Client name">
            <input
              value={form.clientName} onChange={e => update('clientName', e.target.value)}
              placeholder="Romina PLC"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
          <Field label="Contact">
            <input
              value={form.clientContact} onChange={e => update('clientContact', e.target.value)}
              placeholder="Dawit · 0911…"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Deadline">
            <input
              type="date"
              value={form.deadline} onChange={e => update('deadline', e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
          <Field label="Budget">
            <input
              type="number" inputMode="numeric"
              value={form.budget} onChange={e => update('budget', e.target.value)}
              placeholder="45000"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
          <Field label="Currency">
            <select
              value={form.currency} onChange={e => update('currency', e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            >
              <option value="ETB">ETB</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>

        {err && <p className="text-red-400 text-xs mt-2">{err}</p>}

        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-gold-light transition">
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="text-sm font-medium bg-gold/15 border border-gold/30 text-gold-light hover:bg-gold/25 transition rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create job'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="text-muted text-xs block mb-1">{label}</span>
      {children}
    </label>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-border rounded-2xl divide-y divide-border bg-card">
      {[0, 1, 2].map(i => (
        <div key={i} className="p-4 animate-pulse flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-border mt-2" />
          <div className="flex-1">
            <div className="h-4 w-3/5 bg-border rounded mb-2" />
            <div className="h-3 w-2/5 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
