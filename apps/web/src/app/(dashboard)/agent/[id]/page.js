'use client';
/**
 * Agent job detail — classic, minimal 3-section layout.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';

const STATUS_LABEL = {
  draft: 'Draft', awaiting_approval: 'Awaiting', active: 'Active',
  blocked: 'Blocked', completed: 'Done', cancelled: 'Cancelled',
};
const STATUS_DOT = {
  draft: 'bg-muted', awaiting_approval: 'bg-agent', active: 'bg-gold',
  blocked: 'bg-red-500', completed: 'bg-emerald-500', cancelled: 'bg-muted',
};
const STEP_STYLE = {
  done:    { dot: 'bg-emerald-500', text: 'text-emerald-400' },
  active:  { dot: 'bg-gold animate-pulse', text: 'text-gold' },
  waiting: { dot: 'bg-agent', text: 'text-agent' },
  idle:    { dot: 'bg-muted',  text: 'text-muted' },
  failed:  { dot: 'bg-red-500', text: 'text-red-400' },
  skipped: { dot: 'bg-muted',  text: 'text-muted' },
};

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState('pipeline');

  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!initData || !id) return;
    const r = await fetch(`/api/agent/jobs/${id}`, {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setJob(j.job || null);
  }, [initData, id]);

  useEffect(() => { load(); }, [load]);

  // Light polling so the pipeline + threads update as suppliers reply.
  useEffect(() => {
    if (!initData || !id) return;
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [load, initData, id]);

  async function startJob() {
    if (!initData || !id) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/agent/jobs/${id}/start`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) throw new Error('failed');
      await load();
    } catch {
      alert('Could not start the job. Check your Team is set up.');
    } finally { setStarting(false); }
  }

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  if (!job) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-card border border-border rounded-2xl p-6 animate-pulse">
          <div className="h-4 w-2/3 bg-border rounded mb-3" />
          <div className="h-3 w-1/3 bg-border rounded" />
        </div>
      </div>
    );
  }

  const client = job.customers?.name || job.client_snapshot?.name || 'Client';
  const contact = job.client_snapshot?.contact;
  const deadlineLabel = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';
  const budgetLabel = job.budget ? `${Number(job.budget).toLocaleString()} ${job.currency || 'ETB'}` : null;

  return (
    <div className="max-w-xl mx-auto pb-8">
      <button onClick={() => router.push('/agent')} className="text-muted hover:text-gold-light text-sm transition mb-4 md:inline-flex hidden items-center gap-1.5">
        ← All jobs
      </button>

      {/* Minimal header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[job.status] || 'bg-muted'} ${job.status === 'active' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            {STATUS_LABEL[job.status] || job.status}
          </span>
        </div>
        <h1 className="font-display text-xl text-gold-light leading-tight">{job.title}</h1>
        <p className="text-muted text-sm mt-1">
          {client}{contact ? ` · ${contact}` : ''}
        </p>
        {job.description && (
          <p className="text-body text-sm mt-3 leading-relaxed">{job.description}</p>
        )}

        {(job.status === 'draft' || job.status === 'awaiting_approval') && (
          <button
            onClick={startJob}
            disabled={starting}
            className="mt-4 w-full text-sm font-medium bg-gold/15 border border-gold/30 text-gold-light hover:bg-gold/25 transition rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {starting ? 'Starting…' : '▶ Start — brief the team'}
          </button>
        )}
      </div>

      {/* Flat meta row */}
      <div className="bg-card border border-border rounded-2xl divide-y divide-border mb-5">
        {budgetLabel && <MetaLine label="Budget"   value={budgetLabel} />}
        <MetaLine label="Deadline" value={deadlineLabel} />
        {job.actual_cost && (
          <MetaLine label="Actual cost" value={`${Number(job.actual_cost).toLocaleString()} ${job.currency || 'ETB'}`} />
        )}
      </div>

      {/* Simple underlined tabs */}
      <div className="flex gap-5 border-b border-border mb-4">
        {[
          ['pipeline', 'Pipeline', job.steps?.length || 0],
          ['threads',  'Threads',  job.threads?.length || 0],
          ['log',      'Log',      job.events?.length || 0],
        ].map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`pb-2.5 text-sm transition relative flex items-center gap-1.5 ${
              tab === v ? 'text-gold-light font-medium' : 'text-muted'
            }`}
          >
            {label}
            {n > 0 && <span className="text-[10px] opacity-70 tabular-nums">{n}</span>}
            {tab === v && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-gold" />}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && <Pipeline steps={job.steps || []} />}
      {tab === 'threads'  && <Threads  threads={job.threads || []} />}
      {tab === 'log'      && <Log      events={job.events || []} />}
    </div>
  );
}

function MetaLine({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-muted text-sm">{label}</span>
      <span className="text-gold-light text-sm tabular-nums">{value}</span>
    </div>
  );
}

/* ───────── Pipeline ───────── */

function Pipeline({ steps }) {
  if (!steps.length) return <Empty message="No steps yet." />;
  return (
    <ol className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
      {steps.map((s, i) => <StepRow key={s.id || i} step={s} />)}
    </ol>
  );
}

function StepRow({ step }) {
  const s = STEP_STYLE[step.status] || STEP_STYLE.idle;
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex flex-col items-center pt-0.5">
        <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[15px]">{step.icon || '•'}</span>
          <span className={`font-medium text-sm ${step.status === 'done' ? 'text-body' : step.status === 'active' ? 'text-gold-light' : 'text-muted'}`}>
            {step.label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wider ${s.text}`}>{step.status}</span>
          {step.auto && <span className="text-[10px] text-agent">· auto</span>}
          {step.suppliers?.name && <span className="text-[10px] text-muted">· {step.suppliers.name}</span>}
        </div>
        {(step.outbound_summary || step.inbound_summary) && (
          <p className="text-muted text-xs mt-1 leading-relaxed">
            {step.outbound_summary || step.inbound_summary}
          </p>
        )}
      </div>
    </li>
  );
}

/* ───────── Threads ───────── */

function Threads({ threads }) {
  const [open, setOpen] = useState(null);
  if (!threads.length) return <Empty message="No conversations yet." />;
  return (
    <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
      {threads.map(t => (
        <ThreadRow
          key={t.id} thread={t} open={open === t.id}
          onToggle={() => setOpen(open === t.id ? null : t.id)}
        />
      ))}
    </div>
  );
}

function ThreadRow({ thread, open, onToggle }) {
  const name = thread.title || thread.customers?.name || thread.suppliers?.name || 'Contact';
  const messages = thread.messages || [];
  const last = messages[messages.length - 1];
  const preview = last?.text || '';
  const time = thread.last_message_at
    ? new Date(thread.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div>
      <button onClick={onToggle} className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-border/20 transition">
        <Avatar name={name} role={thread.role} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-gold-light text-sm truncate">{name}</span>
            <span className="text-muted text-[11px] flex-shrink-0">{time}</span>
          </div>
          <p className="text-muted text-xs mt-0.5 truncate">{preview}</p>
        </div>
      </button>
      {open && (
        <div className="px-4 py-3 bg-bg/40 space-y-2 border-t border-border">
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
        </div>
      )}
    </div>
  );
}

function Bubble({ msg }) {
  const mine = msg.from === 'me';
  const auto = msg.auto;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${
        mine
          ? auto
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-body'
            : 'bg-gold/15 border border-gold/25 text-gold-light'
          : 'bg-card border border-border text-body'
      }`}>
        {auto && (
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1">
            Auto-sent
          </div>
        )}
        <div className="leading-relaxed whitespace-pre-wrap">{msg.text}</div>
        {msg.attach && (
          <div className="mt-1 text-[11px] text-muted">📎 {msg.attach}</div>
        )}
        {msg.time && (
          <div className={`text-[10px] mt-1 ${mine ? 'text-gold-light/60' : 'text-muted'}`}>{msg.time}</div>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, role }) {
  const letter = (name || '?').charAt(0).toUpperCase();
  const bg = {
    client:   'bg-blue-500/15 text-blue-400',
    designer: 'bg-agent/15 text-agent',
    printer:  'bg-amber-500/15 text-amber-400',
    delivery: 'bg-emerald-500/15 text-emerald-400',
  }[role] || 'bg-muted/15 text-muted';
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${bg}`}>
      {letter}
    </div>
  );
}

/* ───────── Log ───────── */

function Log({ events }) {
  if (!events.length) return <Empty message="No events yet." />;
  return (
    <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
      {events.map(e => <LogRow key={e.id} event={e} />)}
    </div>
  );
}

function LogRow({ event }) {
  const time = event.created_at
    ? new Date(event.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-base flex-shrink-0 mt-0.5">{event.icon || '•'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-gold-light text-sm font-medium">{event.title}</span>
          {event.auto && <span className="text-[10px] text-agent">· auto</span>}
        </div>
        {event.body && <p className="text-muted text-xs mt-0.5 leading-relaxed">{event.body}</p>}
        <span className="text-muted text-[10px] mt-1 block tabular-nums">{time}</span>
      </div>
    </div>
  );
}

function Empty({ message }) {
  return <div className="text-center py-10 text-muted text-sm">{message}</div>;
}
