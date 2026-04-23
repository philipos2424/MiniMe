'use client';
/**
 * Agent job detail — Telegram-native redesign.
 * 3-tab segmented control: Pipeline / Threads / Log.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';

const STATUS_META = {
  draft:              { label: 'Draft',     color: 'text-muted',       bg: 'bg-muted/15' },
  awaiting_approval:  { label: 'Awaiting',  color: 'text-agent',       bg: 'bg-agent/15' },
  active:             { label: 'Active',    color: 'text-gold',        bg: 'bg-gold/15' },
  blocked:            { label: 'Blocked',   color: 'text-red-400',     bg: 'bg-red-500/15' },
  completed:          { label: 'Complete',  color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  cancelled:          { label: 'Cancelled', color: 'text-muted',       bg: 'bg-muted/15' },
};

const STEP_COLOR = {
  done:    { ring: 'ring-emerald-500/50', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500',               text: 'text-emerald-400' },
  active:  { ring: 'ring-gold',           bg: 'bg-gold/15',        dot: 'bg-gold animate-pulse',        text: 'text-gold' },
  waiting: { ring: 'ring-agent/50',       bg: 'bg-agent/10',       dot: 'bg-agent',                     text: 'text-agent' },
  idle:    { ring: 'ring-border',         bg: 'bg-card',           dot: 'bg-muted',                     text: 'text-muted' },
  failed:  { ring: 'ring-red-500/50',     bg: 'bg-red-500/10',     dot: 'bg-red-500',                   text: 'text-red-400' },
  skipped: { ring: 'ring-border',         bg: 'bg-card',           dot: 'bg-muted',                     text: 'text-muted' },
};

const EVENT_COLOR = {
  green:  'bg-emerald-500/15 text-emerald-400',
  blue:   'bg-blue-500/15 text-blue-400',
  purple: 'bg-agent/15 text-agent',
  amber:  'bg-amber-500/15 text-amber-400',
  red:    'bg-red-500/15 text-red-400',
};

function haptic(kind = 'light') {
  try {
    const hf = window.Telegram?.WebApp?.HapticFeedback;
    if (kind === 'select') hf?.selectionChanged?.();
    else hf?.impactOccurred?.(kind);
  } catch {}
}

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState('pipeline');

  const load = useCallback(async () => {
    if (!initData || !id) return;
    const r = await fetch(`/api/agent/jobs/${id}`, {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setJob(j.job || null);
  }, [initData, id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => { haptic('light'); router.push('/agent'); };
    bb.show();
    bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  const switchTab = (v) => { haptic('select'); setTab(v); };

  if (!job) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-card border border-border rounded-3xl p-8 animate-pulse">
          <div className="h-3 w-20 bg-border rounded mb-4" />
          <div className="h-6 w-2/3 bg-border rounded mb-2" />
          <div className="h-3 w-1/3 bg-border rounded" />
        </div>
      </div>
    );
  }

  const meta = STATUS_META[job.status] || STATUS_META.draft;
  const client = job.customers?.name || job.client_snapshot?.name || 'Client';
  const contact = job.client_snapshot?.contact;
  const deadlineLabel = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';
  const budgetLabel = job.budget ? `${Number(job.budget).toLocaleString()}` : '—';
  const costLabel = job.actual_cost ? `${Number(job.actual_cost).toLocaleString()}` : '—';

  return (
    <div className="max-w-xl mx-auto pb-8">
      {/* Web-only back link (Telegram uses native BackButton) */}
      <button
        onClick={() => router.push('/agent')}
        className="text-muted hover:text-gold-light text-sm transition mb-3 md:inline-flex hidden items-center gap-1.5"
      >
        ← All jobs
      </button>

      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl p-5 mb-4 bg-gradient-to-br from-gold/15 via-agent/5 to-transparent border border-gold/20">
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-gold/10 rounded-full blur-3xl" />
        <div className="relative">
          <StatusChip meta={meta} />
          <h1 className="font-display text-xl text-gold-light leading-tight mt-2">{job.title}</h1>
          <p className="text-muted text-[13px] mt-1">
            {client}{contact ? ` · ${contact}` : ''}
          </p>
          {job.description && (
            <p className="text-body text-[13px] mt-3 leading-relaxed opacity-90">{job.description}</p>
          )}
        </div>
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <MetaTile icon="💰" label="Budget"   value={budgetLabel} sub={job.currency || 'ETB'} accent="text-gold" />
        <MetaTile icon="📊" label="Actual"   value={costLabel}   sub={job.currency || 'ETB'} accent="text-emerald-400" />
        <MetaTile icon="📅" label="Deadline" value={deadlineLabel} sub=""                   accent="text-agent" />
      </div>

      {/* Segmented control */}
      <div className="bg-card border border-border rounded-full p-1 flex mb-4">
        {[
          ['pipeline', 'Pipeline', job.steps?.length || 0],
          ['threads',  'Threads',  job.threads?.length || 0],
          ['log',      'Log',      job.events?.length || 0],
        ].map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => switchTab(v)}
            className={`flex-1 px-3 py-2 rounded-full text-[12px] font-semibold transition flex items-center justify-center gap-1.5 ${
              tab === v
                ? 'bg-gold text-bg shadow shadow-gold/20'
                : 'text-muted'
            }`}
          >
            {label}
            {n > 0 && (
              <span className={`text-[10px] px-1.5 rounded-full tabular-nums ${
                tab === v ? 'bg-bg/25 text-bg' : 'bg-border text-muted'
              }`}>{n}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && <Pipeline steps={job.steps || []} />}
      {tab === 'threads'  && <Threads  threads={job.threads || []} />}
      {tab === 'log'      && <Log      events={job.events || []} />}
    </div>
  );
}

function StatusChip({ meta }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.15em] ${meta.bg} ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function MetaTile({ icon, label, value, sub, accent }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-3">
      <div className="text-[14px] leading-none">{icon}</div>
      <div className={`${accent} font-semibold tabular-nums mt-2 text-[15px] truncate leading-none`}>{value}</div>
      <div className="text-muted text-[10px] uppercase tracking-wider mt-1">
        {label}{sub ? ` · ${sub}` : ''}
      </div>
    </div>
  );
}

/* ───────── Pipeline ───────── */

function Pipeline({ steps }) {
  if (!steps.length) return <EmptyTab icon="🗺️" message="No pipeline steps yet." />;

  return (
    <ol className="relative bg-card border border-border rounded-3xl p-5">
      <div className="absolute left-[39px] top-8 bottom-8 w-px bg-gradient-to-b from-border via-border to-transparent" />
      <div className="space-y-4">
        {steps.map((s, i) => <StepRow key={s.id || i} step={s} />)}
      </div>
    </ol>
  );
}

function StepRow({ step }) {
  const c = STEP_COLOR[step.status] || STEP_COLOR.idle;
  const done = step.status === 'done';
  const active = step.status === 'active';

  return (
    <li className="relative flex items-start gap-3">
      <div className={`relative z-10 w-11 h-11 rounded-2xl flex items-center justify-center text-lg ring-2 flex-shrink-0 ${c.ring} ${c.bg}`}>
        {step.icon || '•'}
      </div>
      <div className="flex-1 min-w-0 pt-1.5">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
          <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${c.text}`}>
            {step.status}
          </span>
          {step.auto && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-agent/15 text-agent uppercase tracking-wider">
              auto
            </span>
          )}
        </div>
        <div className={`font-medium text-[14px] leading-snug ${done ? 'text-body' : active ? 'text-gold-light' : 'text-muted'}`}>
          {step.label}
        </div>
        {(step.outbound_summary || step.inbound_summary) && (
          <div className="text-muted text-[12px] mt-1 leading-relaxed">
            {step.outbound_summary || step.inbound_summary}
          </div>
        )}
        {step.suppliers?.name && (
          <div className="text-muted text-[11px] mt-1.5 inline-flex items-center gap-1">
            <span className="opacity-60">→</span> {step.suppliers.name}
          </div>
        )}
      </div>
    </li>
  );
}

/* ───────── Threads ───────── */

function Threads({ threads }) {
  const [open, setOpen] = useState(null);
  if (!threads.length) return <EmptyTab icon="💬" message="No conversations yet." />;

  return (
    <div className="space-y-2.5">
      {threads.map(t => (
        <ThreadCard
          key={t.id}
          thread={t}
          open={open === t.id}
          onToggle={() => { haptic('light'); setOpen(open === t.id ? null : t.id); }}
        />
      ))}
    </div>
  );
}

function ThreadCard({ thread, open, onToggle }) {
  const name = thread.title || thread.customers?.name || thread.suppliers?.name || 'Contact';
  const messages = thread.messages || [];
  const last = messages[messages.length - 1];
  const preview = last?.text || '';
  const time = thread.last_message_at
    ? new Date(thread.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden transition">
      <button
        onClick={onToggle}
        className="w-full p-3.5 flex items-start gap-3 text-left hover:bg-border/20 active:bg-border/30 transition"
      >
        <Avatar name={name} role={thread.role} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="font-medium text-gold-light text-[14px] truncate">{name}</span>
            <span className="text-muted text-[11px] flex-shrink-0">{time}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <RoleTag role={thread.role} />
            <span className="text-muted text-[12px] truncate">{preview}</span>
          </div>
        </div>
        <span className={`text-muted text-[10px] transition-transform flex-shrink-0 mt-2 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2 bg-bg/50">
          {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const mine = msg.from === 'me';
  const auto = msg.auto;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[13px] ${
        mine
          ? auto
            ? 'bg-emerald-500/12 border border-emerald-500/25 text-body rounded-br-md'
            : 'bg-gold/15 border border-gold/30 text-gold-light rounded-br-md'
          : 'bg-card border border-border text-body rounded-bl-md'
      }`}>
        {auto && (
          <div className="text-[9px] uppercase tracking-wider text-emerald-400 mb-1 font-semibold flex items-center gap-1">
            <span>⚡</span> Auto-sent
          </div>
        )}
        <div className="leading-relaxed whitespace-pre-wrap">{msg.text}</div>
        {msg.attach && (
          <div className="mt-1.5 text-[11px] text-muted flex items-center gap-1">
            📎 {msg.attach}
          </div>
        )}
        {msg.time && (
          <div className={`text-[10px] mt-1 ${mine ? 'text-gold-light/60' : 'text-muted'}`}>
            {msg.time}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, role }) {
  const letter = (name || '?').charAt(0).toUpperCase();
  const bg = {
    client:   'bg-blue-500/20 text-blue-400',
    designer: 'bg-agent/20 text-agent',
    printer:  'bg-amber-500/20 text-amber-400',
    delivery: 'bg-emerald-500/20 text-emerald-400',
  }[role] || 'bg-muted/20 text-muted';
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${bg}`}>
      {letter}
    </div>
  );
}

function RoleTag({ role }) {
  if (!role) return null;
  return (
    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-border text-muted flex-shrink-0">
      {role}
    </span>
  );
}

/* ───────── Log ───────── */

function Log({ events }) {
  if (!events.length) return <EmptyTab icon="📜" message="No events logged yet." />;
  return (
    <div className="bg-card border border-border rounded-3xl divide-y divide-border overflow-hidden">
      {events.map(e => <LogRow key={e.id} event={e} />)}
    </div>
  );
}

function LogRow({ event }) {
  const color = EVENT_COLOR[event.color] || EVENT_COLOR.green;
  const time = event.created_at
    ? new Date(event.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div className="p-3.5 flex gap-3">
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg flex-shrink-0 ${color}`}>
        {event.icon || '•'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-gold-light text-[13px]">{event.title}</span>
          {event.auto && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-agent/15 text-agent">
              Autonomous
            </span>
          )}
        </div>
        {event.body && (
          <div className="text-muted text-[12px] mt-1 leading-relaxed">{event.body}</div>
        )}
        <div className="text-muted text-[10px] mt-1.5 tabular-nums opacity-70">{time}</div>
      </div>
    </div>
  );
}

function EmptyTab({ icon, message }) {
  return (
    <div className="bg-card border border-border rounded-3xl p-10 text-center">
      <div className="text-4xl mb-3 opacity-80">{icon}</div>
      <p className="text-muted text-[13px]">{message}</p>
    </div>
  );
}
