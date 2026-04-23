'use client';
/**
 * Agent console — job list (Telegram-native redesign).
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';

const STATUS_META = {
  draft:              { label: 'Draft',     accent: 'from-muted/30 to-muted/10',          dot: 'bg-muted' },
  awaiting_approval:  { label: 'Awaiting',  accent: 'from-agent/30 to-agent/5',           dot: 'bg-agent' },
  active:             { label: 'Active',    accent: 'from-gold/30 to-gold/5',             dot: 'bg-gold' },
  blocked:            { label: 'Blocked',   accent: 'from-red-500/30 to-red-500/5',       dot: 'bg-red-500' },
  completed:          { label: 'Done',      accent: 'from-emerald-500/30 to-emerald-500/5', dot: 'bg-emerald-500' },
  cancelled:          { label: 'Cancelled', accent: 'from-muted/20 to-muted/5',           dot: 'bg-muted' },
};

function haptic(kind = 'light') {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (kind === 'select') hf?.selectionChanged?.();
    else hf?.impactOccurred?.(kind);
  } catch {}
}

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
    setBusy(true); haptic('medium');
    try {
      await fetch('/api/agent/jobs/seed', {
        method: 'POST', headers: { 'x-telegram-init-data': initData },
      });
      await load();
    } finally { setBusy(false); }
  }

  async function resetJobs() {
    if (!confirm('Delete all jobs? This cannot be undone.')) return;
    setBusy(true); haptic('heavy');
    try {
      await fetch('/api/agent/jobs/reset', {
        method: 'POST', headers: { 'x-telegram-init-data': initData },
      });
      await load();
    } finally { setBusy(false); }
  }

  const list = jobs || [];
  const counts = {
    active:   list.filter(j => j.status === 'active').length,
    awaiting: list.filter(j => j.status === 'awaiting_approval').length,
    done:     list.filter(j => j.status === 'completed').length,
  };

  return (
    <div className="max-w-xl mx-auto pb-6">
      {/* Hero header with gradient */}
      <div className="relative rounded-3xl overflow-hidden mb-5 p-5 bg-gradient-to-br from-gold/15 via-agent/10 to-transparent border border-gold/20">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-gold/10 rounded-full blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">⚡</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-gold/80 font-semibold">Autonomous</span>
          </div>
          <h1 className="font-display text-2xl text-gold-light leading-tight">Agent</h1>
          <p className="text-muted text-[13px] mt-1 leading-relaxed">
            Your AI teammate running client jobs end-to-end.
          </p>

          {/* Inline metrics */}
          <div className="flex gap-4 mt-4">
            <Metric n={counts.active}   label="Active"   color="text-gold" />
            <Metric n={counts.awaiting} label="Awaiting" color="text-agent" />
            <Metric n={counts.done}     label="Done"     color="text-emerald-400" />
          </div>

          {/* Reset button (only if there are jobs) */}
          {list.length > 0 && (
            <button
              onClick={resetJobs}
              disabled={busy}
              className="absolute top-0 right-0 text-[10px] text-muted hover:text-red-400 transition flex items-center gap-1 disabled:opacity-40"
            >
              ↺ Reset
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto scrollbar-none -mx-1 px-1">
        {[
          ['all', 'All'],
          ['active', 'Active'],
          ['awaiting_approval', 'Awaiting'],
          ['completed', 'Done'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => { haptic('select'); setFilter(v); }}
            className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-[12px] font-medium transition flex-shrink-0 ${
              filter === v
                ? 'bg-gold text-bg shadow-lg shadow-gold/20'
                : 'bg-card border border-border text-muted hover:border-gold/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Job list */}
      {jobs === null && <ListSkeleton />}
      {jobs !== null && jobs.length === 0 && (
        <EmptyState onSeed={seedDemo} busy={busy} />
      )}
      {jobs !== null && jobs.length > 0 && (
        <ul className="space-y-2.5">
          {jobs.map(j => <JobCard key={j.id} job={j} />)}
        </ul>
      )}
    </div>
  );
}

function Metric({ n, label, color }) {
  return (
    <div>
      <div className={`text-2xl font-semibold ${color} tabular-nums leading-none`}>{n}</div>
      <div className="text-muted text-[10px] uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function JobCard({ job }) {
  const meta = STATUS_META[job.status] || STATUS_META.draft;
  const client = job.customers?.name || job.client_snapshot?.name || 'Client';
  const deadlineLabel = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  const value = job.budget ? `${Number(job.budget).toLocaleString()}` : null;
  const pct = job.current_step != null && job.steps_total
    ? Math.round((job.current_step / job.steps_total) * 100)
    : null;

  return (
    <li>
      <Link
        href={`/agent/${job.id}`}
        onClick={() => haptic('light')}
        className="block group relative overflow-hidden rounded-2xl bg-card border border-border p-4 transition active:scale-[0.98] hover:border-gold/30"
      >
        {/* Left color gutter */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${meta.accent}`} />

        <div className="flex items-start gap-3 pl-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${job.status === 'active' ? 'animate-pulse' : ''}`} />
              <span className="text-[9px] uppercase tracking-[0.15em] text-muted font-semibold">
                {meta.label}
              </span>
              {deadlineLabel && (
                <>
                  <span className="text-muted text-[9px]">·</span>
                  <span className="text-[10px] text-muted">{deadlineLabel}</span>
                </>
              )}
            </div>
            <h3 className="font-medium text-gold-light text-[15px] leading-snug line-clamp-2">
              {job.title}
            </h3>
            <p className="text-muted text-[12px] mt-1 truncate">
              {client}
            </p>
          </div>
          {value && (
            <div className="text-right flex-shrink-0">
              <div className="text-gold font-semibold tabular-nums text-sm">{value}</div>
              <div className="text-muted text-[9px] uppercase tracking-wider">{job.currency || 'ETB'}</div>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {pct != null && (
          <div className="mt-3 pl-2 flex items-center gap-2">
            <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold to-gold-light rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted tabular-nums">{pct}%</span>
          </div>
        )}
      </Link>
    </li>
  );
}

function EmptyState({ onSeed, busy }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-card via-card to-agent/5 border border-border p-8 text-center">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-gold/10 rounded-full blur-3xl" />
      <div className="relative">
        <div className="text-5xl mb-4">⚡</div>
        <h3 className="font-display text-xl text-gold-light">Ready when you are</h3>
        <p className="text-muted text-[13px] mt-2 max-w-xs mx-auto leading-relaxed">
          When a client requests a multi-step project, the agent orchestrates designers, printers,
          and delivery automatically. Each job lives here.
        </p>
        <button
          onClick={onSeed}
          disabled={busy}
          className="mt-6 px-5 py-2.5 rounded-full text-sm font-semibold bg-gold text-bg hover:opacity-90 transition disabled:opacity-50 shadow-lg shadow-gold/20"
        >
          {busy ? 'Loading…' : '✨  See a sample job'}
        </button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="bg-card border border-border rounded-2xl p-4 animate-pulse">
          <div className="h-2.5 w-16 bg-border rounded mb-3" />
          <div className="h-4 w-3/5 bg-border rounded mb-2" />
          <div className="h-2.5 w-2/5 bg-border rounded" />
        </div>
      ))}
    </div>
  );
}
