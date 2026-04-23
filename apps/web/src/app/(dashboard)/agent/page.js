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

  const load = useCallback(async () => {
    if (!initData) return;
    const r = await fetch('/api/agent/jobs' + (filter === 'all' ? '' : `?status=${filter}`), {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setJobs(j.jobs || []);
  }, [initData, filter]);

  useEffect(() => { load(); }, [load]);

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
        {list.length > 0 && (
          <button onClick={resetJobs} disabled={busy} className="text-xs text-muted hover:text-red-400 transition">
            Reset
          </button>
        )}
      </header>

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
      {jobs !== null && jobs.length === 0 && <EmptyState onSeed={seedDemo} busy={busy} />}
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

function EmptyState({ onSeed, busy }) {
  return (
    <div className="text-center py-10">
      <p className="text-muted text-sm mb-4">No jobs yet.</p>
      <button
        onClick={onSeed}
        disabled={busy}
        className="text-sm font-medium text-gold hover:text-gold-light transition disabled:opacity-50"
      >
        {busy ? 'Loading…' : 'Load a sample job'}
      </button>
    </div>
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
