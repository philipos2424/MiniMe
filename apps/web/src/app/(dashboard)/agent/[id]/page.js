'use client';
/**
 * Agent job detail — redesigned with design tokens.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgConfirm } from '../../../../lib/utils';

const AGENT_COLOR = '#6366F1'; // indigo — auto/agent accent

const STATUS_LABEL = {
  draft: 'Draft', awaiting_approval: 'Awaiting', active: 'Active',
  blocked: 'Blocked', completed: 'Done', cancelled: 'Cancelled',
};
const STATUS_DOT_COLOR = {
  draft:              COLORS.textHint,
  awaiting_approval:  AGENT_COLOR,
  active:             COLORS.teal,
  blocked:            COLORS.red,
  completed:          COLORS.green,
  cancelled:          COLORS.textHint,
};
const STEP_STYLE = {
  done:    { dot: COLORS.green,    text: COLORS.green },
  active:  { dot: COLORS.teal,     text: COLORS.teal },
  waiting: { dot: AGENT_COLOR,     text: AGENT_COLOR },
  idle:    { dot: COLORS.textHint, text: COLORS.textHint },
  failed:  { dot: COLORS.red,      text: COLORS.red },
  skipped: { dot: COLORS.textHint, text: COLORS.textHint },
};
// Avatar role → background / text color pairs
const ROLE_COLORS = {
  client:   { bg: 'rgba(96,165,250,0.15)',  text: '#60A5FA' },
  designer: { bg: `${AGENT_COLOR}22`,       text: AGENT_COLOR },
  printer:  { bg: 'rgba(251,191,36,0.15)',  text: COLORS.amber },
  delivery: { bg: `${COLORS.green}22`,      text: COLORS.green },
};

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [job, setJob] = useState(null);
  const [preflight, setPreflight] = useState([]);
  const [tab, setTab] = useState('pipeline');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!initData || !id) return;
    const r = await fetch(`/api/agent/jobs/${id}`, {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setJob(j.job || null);
    setPreflight(j.preflight || []);
  }, [initData, id]);

  useEffect(() => { load(); }, [load]);

  // Light polling — pipeline + threads update as suppliers reply
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
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'failed');
      if (j.result?.reason && !j.result.advanced) {
        alert(`Briefing didn't advance: ${j.result.reason}. Check /agent/team.`);
      }
      await load();
    } catch (e) {
      alert(`Could not brief the team: ${e.message || 'unknown'}. Check your Team has a Telegram ID set.`);
    } finally { setStarting(false); }
  }

  async function deleteJob() {
    if (!initData || !id) return;
    if (!(await tgConfirm('Delete this job? This cannot be undone.'))) return;
    const r = await fetch(`/api/agent/jobs/${id}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    if (r.ok) router.push('/agent');
    else {
      const j = await r.json().catch(() => ({}));
      alert(`Could not delete: ${j.error || r.status}`);
    }
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
      <div style={{ maxWidth: 560, margin: '0 auto', fontFamily: FONT.body }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, padding: 24 }}>
          <div style={{ height: 16, width: '66%', background: COLORS.border, borderRadius: RADII.sm, marginBottom: 12 }} />
          <div style={{ height: 12, width: '33%', background: COLORS.border, borderRadius: RADII.sm }} />
        </div>
      </div>
    );
  }

  const client       = job.customers?.name || job.client_snapshot?.name || 'Client';
  const contact      = job.client_snapshot?.contact;
  const deadlineLabel = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';
  const budgetLabel = job.budget
    ? `${Number(job.budget).toLocaleString()} ${job.currency || 'ETB'}`
    : null;
  const dotColor    = STATUS_DOT_COLOR[job.status] || COLORS.textHint;
  const blockers    = preflight.filter(p => !p.ready);
  const allReady    = preflight.length > 0 && preflight.every(p => p.ready);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 32, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* ← back link (md+) */}
      <button
        onClick={() => router.push('/agent')}
        style={{ fontSize: 13, color: COLORS.textHint, background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, display: 'none' }}
      >
        ← All jobs
      </button>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textHint, fontWeight: 600 }}>
            {STATUS_LABEL[job.status] || job.status}
          </span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: COLORS.textPrimary, lineHeight: 1.3 }}>
          {job.title}
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
          {client}{contact ? ` · ${contact}` : ''}
        </p>
        {job.description && (
          <p style={{ fontSize: 14, color: COLORS.textPrimary, margin: '12px 0 0', lineHeight: 1.6 }}>
            {job.description}
          </p>
        )}

        {/* Blockers */}
        {blockers.length > 0 && (
          <div style={{ marginTop: 16, borderRadius: RADII.md, background: COLORS.amberLight, border: `1px solid ${COLORS.amber}40`, padding: '12px 14px' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: COLORS.amber, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
              Blockers
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {blockers.map((b, i) => (
                <li key={i} style={{ fontSize: 13, color: '#92400E' }}>• {b.reason}</li>
              ))}
            </ul>
            <button
              onClick={() => router.push('/agent/team')}
              style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: '#92400E', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
            >
              Fix in Team →
            </button>
          </div>
        )}

        {/* All ready */}
        {allReady && job.status !== 'active' && (
          <div style={{ marginTop: 16, borderRadius: RADII.md, background: COLORS.greenLight, border: `1px solid ${COLORS.green}40`, padding: '10px 14px' }}>
            <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>✓ Team is ready. Tap Start to brief them.</p>
          </div>
        )}

        {/* Start / re-brief button */}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <button
            onClick={startJob}
            disabled={starting}
            style={{
              marginTop: 16, width: '100%',
              fontSize: 14, fontWeight: 600,
              background: starting ? COLORS.textHint : COLORS.teal,
              color: '#FFFFFF',
              border: 'none', borderRadius: RADII.md,
              padding: '10px 16px', minHeight: 44,
              cursor: starting ? 'default' : 'pointer',
              fontFamily: FONT.body,
              transition: 'background 0.15s',
            }}
          >
            {starting
              ? 'Sending…'
              : job.status === 'draft' || job.status === 'awaiting_approval'
                ? '▶ Start — brief the team'
                : job.status === 'blocked'
                  ? '↻ Retry — re-brief the team'
                  : '↻ Re-brief the team'}
          </button>
        )}
      </div>

      {/* Meta row */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, marginBottom: 20, boxShadow: SHADOW.card, overflow: 'hidden' }}>
        {budgetLabel && <MetaLine label="Budget" value={budgetLabel} />}
        <MetaLine label="Deadline" value={deadlineLabel} />
        {job.actual_cost && (
          <MetaLine label="Actual cost" value={`${Number(job.actual_cost).toLocaleString()} ${job.currency || 'ETB'}`} />
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 16 }}>
        {[
          ['pipeline', 'Pipeline', job.steps?.length  || 0],
          ['threads',  'Threads',  job.threads?.length || 0],
          ['log',      'Log',      job.events?.length  || 0],
        ].map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            style={{
              paddingBottom: 10,
              fontSize: 14,
              fontWeight: tab === v ? 600 : 400,
              color: tab === v ? COLORS.textPrimary : COLORS.textHint,
              background: 'none', border: 'none',
              borderBottom: tab === v ? `2px solid ${COLORS.teal}` : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: FONT.body,
              transition: 'color 0.15s',
            }}
          >
            {label}
            {n > 0 && <span style={{ fontSize: 10, color: COLORS.textHint }}>{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && <Pipeline steps={job.steps || []} />}
      {tab === 'threads'  && <Threads  threads={job.threads || []} />}
      {tab === 'log'      && <Log      events={job.events || []} />}

      {/* Danger zone */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={deleteJob}
          style={{ fontSize: 12, color: COLORS.red, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body }}
        >
          Delete this job
        </button>
      </div>
    </div>
  );
}

/* ── MetaLine ── */
function MetaLine({ label, value, isLast }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
    }}>
      <span style={{ fontSize: 13, color: COLORS.textSecondary }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{value}</span>
    </div>
  );
}

/* ── Pipeline ── */
function Pipeline({ steps }) {
  if (!steps.length) return <Empty message="No steps yet." />;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, overflow: 'hidden', boxShadow: SHADOW.card }}>
      {steps.map((s, i) => <StepRow key={s.id || i} step={s} isLast={i === steps.length - 1} />)}
    </div>
  );
}

function StepRow({ step, isLast }) {
  const s = STEP_STYLE[step.status] || STEP_STYLE.idle;
  const labelColor = step.status === 'active' ? COLORS.teal : step.status === 'done' ? COLORS.textPrimary : COLORS.textHint;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
    }}>
      <div style={{ paddingTop: 3, flexShrink: 0 }}>
        <span style={{ display: 'block', width: 10, height: 10, borderRadius: '50%', background: s.dot }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 15 }}>{step.icon || '•'}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: labelColor }}>{step.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: s.text }}>{step.status}</span>
          {step.auto     && <span style={{ fontSize: 10, color: AGENT_COLOR }}>· auto</span>}
          {step.suppliers?.name && <span style={{ fontSize: 10, color: COLORS.textHint }}>· {step.suppliers.name}</span>}
        </div>
        {(step.outbound_summary || step.inbound_summary) && (
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '4px 0 0', lineHeight: 1.5 }}>
            {step.outbound_summary || step.inbound_summary}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Threads ── */
function Threads({ threads }) {
  const [open, setOpen] = useState(null);
  if (!threads.length) return <Empty message="No conversations yet." />;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, overflow: 'hidden', boxShadow: SHADOW.card }}>
      {threads.map((t, i) => (
        <ThreadRow
          key={t.id}
          thread={t}
          open={open === t.id}
          onToggle={() => setOpen(open === t.id ? null : t.id)}
          isLast={i === threads.length - 1}
        />
      ))}
    </div>
  );
}

function ThreadRow({ thread, open, onToggle, isLast }) {
  const name     = thread.title || thread.customers?.name || thread.suppliers?.name || 'Contact';
  const messages = thread.messages || [];
  const last     = messages[messages.length - 1];
  const preview  = last?.text || '';
  const time     = thread.last_message_at
    ? new Date(thread.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div style={{ borderBottom: isLast && !open ? 'none' : `1px solid ${COLORS.border}` }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', padding: '14px 16px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: FONT.body,
        }}
      >
        <ThreadAvatar name={name} role={thread.role} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <span style={{ fontSize: 11, color: COLORS.textHint, flexShrink: 0 }}>{time}</span>
          </div>
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview}
          </p>
        </div>
      </button>
      {open && (
        <div style={{ padding: '12px 16px', background: COLORS.bg, borderTop: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
        </div>
      )}
    </div>
  );
}

function Bubble({ msg }) {
  const mine = msg.from === 'me';
  const auto = msg.auto;

  let bg, border, textColor;
  if (mine) {
    if (auto) {
      bg = 'rgba(16,185,129,0.08)'; border = '1px solid rgba(16,185,129,0.2)'; textColor = COLORS.textPrimary;
    } else {
      bg = `${COLORS.teal}22`; border = `1px solid ${COLORS.teal}40`; textColor = COLORS.textPrimary;
    }
  } else {
    bg = COLORS.surface; border = `1px solid ${COLORS.border}`; textColor = COLORS.textPrimary;
  }

  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%',
        borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: '8px 12px',
        fontSize: 14,
        background: bg, border, color: textColor,
      }}>
        {auto && (
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: COLORS.green, marginBottom: 4 }}>
            Auto-sent
          </div>
        )}
        <div style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
        {msg.attach && (
          <div style={{ marginTop: 4, fontSize: 11, color: COLORS.textHint }}>📎 {msg.attach}</div>
        )}
        {msg.time && (
          <div style={{ fontSize: 10, marginTop: 4, color: mine ? `${COLORS.teal}99` : COLORS.textHint }}>
            {msg.time}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadAvatar({ name, role }) {
  const letter = (name || '?').charAt(0).toUpperCase();
  const colors = ROLE_COLORS[role] || { bg: `${COLORS.textHint}22`, text: COLORS.textHint };
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%',
      background: colors.bg, color: colors.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, fontWeight: 600, flexShrink: 0,
    }}>
      {letter}
    </div>
  );
}

/* ── Log ── */
function Log({ events }) {
  if (!events.length) return <Empty message="No events yet." />;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, overflow: 'hidden', boxShadow: SHADOW.card }}>
      {events.map((e, i) => <LogRow key={e.id} event={e} isLast={i === events.length - 1} />)}
    </div>
  );
}

function LogRow({ event, isLast }) {
  const time = event.created_at
    ? new Date(event.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <div style={{
      padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{event.icon || '•'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{event.title}</span>
          {event.auto && <span style={{ fontSize: 10, color: AGENT_COLOR }}>· auto</span>}
        </div>
        {event.body && (
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', lineHeight: 1.5 }}>{event.body}</p>
        )}
        <span style={{ fontSize: 10, color: COLORS.textHint, marginTop: 4, display: 'block', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </span>
      </div>
    </div>
  );
}

/* ── Empty ── */
function Empty({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 16px', fontSize: 14, color: COLORS.textHint, fontFamily: FONT.body }}>
      {message}
    </div>
  );
}
