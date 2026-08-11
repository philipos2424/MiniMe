'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { ProGate, UpgradeSheet } from '../../../components/ui/UpgradeSheet';
import { isProBusiness } from '../../../lib/plan';
import { track } from '../../../lib/track';

// ─── Tokens (theme-aware CSS variables) ──────────────────────────────────────
const INK   = 'var(--ink)';
const PAPER = 'var(--paper)';
const CARD  = 'var(--card)';
const CREAM = 'var(--cream)';
const CREAM2= 'var(--cream-2)';
const GOLD  = 'var(--gold)';
const MINT  = 'var(--mint)';
const LINE  = 'var(--line)';
const LINE2 = 'var(--line-soft)';
const MUTED = 'var(--muted)';
const ERROR = 'var(--error)';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

// ─── The 4 primary insight cards (shown always) ───────────────────────────────
const PRIMARY_INSIGHTS = [
  {
    icon: '🎯',
    title: 'Focus Today',
    desc: 'What should I work on right now?',
    q: 'What should I focus on today?',
  },
  {
    icon: '📈',
    title: 'Revenue',
    desc: 'How are my sales trending?',
    q: "What's my revenue trend this week?",
  },
  {
    icon: '👥',
    title: 'Customers',
    desc: 'Who needs my attention?',
    q: 'Which customers need attention right now?',
  },
  {
    icon: '📦',
    title: 'Orders',
    desc: 'Any overdue or pending items?',
    q: 'Which orders are overdue for payment?',
  },
];

// ─── Extra chips (collapsed, shown via "View all insights →") ─────────────────
const EXTRA_CHIPS = [
  { icon: '🧠', q: "What have you learned from my conversations this week?" },
  { icon: '💰', q: "Which orders are overdue for payment?" },
  { icon: '⭐', q: "Who are my most loyal customers and what do they buy?" },
  { icon: '📦', q: "Which products should I restock urgently?" },
  { icon: '🔁', q: "Which customers haven't ordered in a while?" },
  { icon: '🚀', q: "Give me 3 quick wins I can do today to grow revenue" },
];

const RULE_SUGGESTIONS = [
  { icon: '😊', rule: 'Use emojis often' },
  { icon: '🇪🇹', rule: 'Always greet in Amharic first' },
  { icon: '📝', rule: 'Keep replies short and to the point' },
  { icon: '🎩', rule: 'Be more formal' },
  { icon: '🚫', rule: "Never discuss competitor prices" },
  { icon: '📞', rule: 'Always end with our phone number' },
];

// ─── Pipeline summary card (live order counts) ────────────────────────────────
const PIPELINE_STAGES = [
  { key: 'new',         label: 'New',          color: '#D9A441' },
  { key: 'in_progress', label: 'In Progress',  color: '#3F5D3F' },
  { key: 'awaiting',    label: 'Awaiting Pay', color: '#B08A4A' },
  { key: 'paid',        label: 'Paid',         color: '#4FA38A' },
];

function PipelineSummary({ initData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/pipeline', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false); })
      .catch(() => setLoading(false));
  }, [initData]);

  const hasAny = !loading && data && PIPELINE_STAGES.some(s => (data[s.key]?.length || 0) > 0);
  if (loading || !hasAny) return null;

  const total = PIPELINE_STAGES.reduce((acc, s) => acc + (data[s.key]?.length || 0), 0);

  return (
    <a href="/progress" style={{ textDecoration: 'none', display: 'block', margin: '0 22px 0' }}>
      <div style={{
        background: CARD, border: `1px solid ${LINE2}`,
        borderRadius: 16, padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD }}>
            Sales Pipeline
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>
            {total} active ›
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PIPELINE_STAGES.map(s => {
            const count = data[s.key]?.length || 0;
            return (
              <div key={s.key} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: `${s.color}14`, border: `1px solid ${s.color}30`,
                borderRadius: 999, padding: '5px 12px',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{count}</span>
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </a>
  );
}

// ─── Insight card (primary 4) ─────────────────────────────────────────────────
function InsightCard({ icon, title, desc, onAsk }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onAsk}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? CREAM2 : CARD,
        border: `1px solid ${hover ? LINE : LINE2}`,
        borderRadius: 16, padding: '16px 14px',
        textAlign: 'left', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 6,
        transition: 'background 0.15s, border-color 0.15s',
        fontFamily: BODY,
      }}
    >
      <span style={{ fontSize: 24, lineHeight: 1 }}>{icon}</span>
      <div style={{ fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.4 }}>{desc}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: MINT, marginTop: 2 }}>→ Ask MiniMe</div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdvisorPage() {
  const router = useRouter();
  const { initData, business } = useTelegram() || {};
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [rulesBusy, setRulesBusy] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const endRef = useRef(null);

  const ownerName = business?.owner_name || business?.name?.split(' ')[0] || '';

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const fetchRules = useCallback(async () => {
    if (!initData) return;
    try {
      const r = await fetch('/api/settings/instructions', { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      if (j.instructions) setRules(j.instructions);
    } catch {}
  }, [initData]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function addRule(rule) {
    const r = rule.trim();
    if (!r || rulesBusy) return;
    setRulesBusy(true);
    setNewRule('');
    try {
      const res = await fetch('/api/settings/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'add', rule: r }),
      });
      const j = await res.json();
      if (j.instructions) setRules(j.instructions);
    } catch {}
    setRulesBusy(false);
  }

  async function removeRule(index) {
    setRulesBusy(true);
    try {
      const res = await fetch('/api/settings/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'remove', index }),
      });
      const j = await res.json();
      if (j.instructions) setRules(j.instructions);
    } catch {}
    setRulesBusy(false);
  }

  async function ask(q) {
    const question = (q || input).trim();
    if (!question || busy) return;
    setInput('');
    setMessages(m => [...m, { role: 'owner', text: question }]);
    setBusy(true);
    // The question text itself is NEVER sent — owners ask about named customers
    // and real order amounts. Only the fact of asking, and whether it came from a
    // suggestion chip or free typing (which tells us if the chips are working).
    track('submit', { intent: 'agent.ask.send', meta: { source: q ? 'chip' : 'typed' } });
    try {
      const r = await fetch('/api/advisor/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      if (r.status === 403 && j.error === 'pro_required') { setUpgradeOpen(true); return; }
      if (!r.ok) throw new Error(j.error || 'failed');
      setMessages(m => [...m, { role: 'advisor', text: j.response || '(no reply)', actions: j.suggestedActions || [], isInstruction: j.instructionSaved }]);
      if (j.instructionSaved || j.knowledgeSaved) fetchRules();
    } catch (e) {
      setMessages(m => [...m, { role: 'advisor', text: `⚠️ ${e.message || 'failed'}`, actions: [] }]);
    } finally { setBusy(false); }
  }

  async function runAction(a) {
    if (a.kind === 'open_client' || a.kind === 'draft_reply') {
      try {
        const r = await fetch(`/api/advisor/resolve-client?q=${encodeURIComponent(a.client || '')}`, { headers: { 'x-telegram-init-data': initData } });
        const j = await r.json();
        if (j.conversation_id) { router.push(`/conversations/${j.conversation_id}`); return; }
      } catch {}
      router.push(`/conversations?q=${encodeURIComponent(a.client || '')}`); return;
    }
    if (a.kind === 'open_job')         { router.push(`/agent/${a.job_id}`); return; }
    if (a.kind === 'open_teach')       { router.push('/agent/knowledge'); return; }
    if (a.kind === 'toggle_dnd')       { router.push('/settings'); return; }
    if (a.kind === 'upgrade_trust')    { router.push('/settings/trust'); return; }
    if (a.kind === 'send_review_request') { ask(`Draft a review request message for ${a.client || 'my happiest client'}`); return; }
  }

  const showChips = messages.length === 0;

  if (!isProBusiness(business)) {
    return <ProGate business={business} feature="advisor" />;
  }

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 120, fontFamily: BODY, color: INK, display: 'flex', flexDirection: 'column' }}>
      <UpgradeSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature="advisor" />

      {/* ── Header ── */}
      <header style={{ padding: '24px 22px 0', position: 'relative' }}>
        {/* Small rules chip — top-right */}
        <div style={{ position: 'absolute', top: 20, right: 22 }}>
          <button onClick={() => setShowRules(v => !v)} style={{
            fontSize: 11.5, fontWeight: 600,
            color: showRules ? INK : MUTED,
            background: showRules ? CREAM2 : 'transparent',
            border: `1px solid ${showRules ? LINE : LINE2}`,
            borderRadius: 999, padding: '5px 12px',
            cursor: 'pointer', fontFamily: BODY, transition: 'all .15s',
          }}>
            📋 Rules{rules.length > 0 ? ` (${rules.length})` : ''}
          </button>
        </div>

        {/* Greeting */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>
          MiniMe Advisor
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 26, color: INK, lineHeight: 1.2, letterSpacing: '-0.015em', marginBottom: 6 }}>
          {ownerName ? `Hey, ${ownerName} 👋` : 'Good day 👋'}
        </div>
        <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5, marginBottom: 20, maxWidth: 280 }}>
          Here's what's happening in your business today.
        </div>
      </header>

      {/* ── Rules panel ── */}
      {showRules && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, margin: '0 22px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Rules for MiniMe</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {RULE_SUGGESTIONS.filter(s => !rules.some(r => r.rule?.toLowerCase() === s.rule.toLowerCase())).map(s => (
              <button key={s.rule} onClick={() => addRule(s.rule)} disabled={rulesBusy}
                style={{ fontSize: 11, fontWeight: 500, background: CARD, border: `1px solid ${LINE}`, color: INK, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: BODY }}>
                {s.icon} {s.rule}
              </button>
            ))}
          </div>
          {rules.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {rules.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(176,138,74,.08)', border: `1px solid rgba(176,138,74,.2)`, borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ fontSize: 13, color: INK }}>✓ {r.rule}</span>
                  <button onClick={() => removeRule(i)} disabled={rulesBusy}
                    style={{ fontSize: 11, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: BODY, flexShrink: 0, marginLeft: 8 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); addRule(newRule); }} style={{ display: 'flex', gap: 6 }}>
            <input value={newRule} onChange={e => setNewRule(e.target.value)}
              placeholder="Add a rule…" disabled={rulesBusy}
              style={{ flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 14px', fontSize: 13, color: INK, fontFamily: BODY, outline: 'none' }}
            />
            <button type="submit" disabled={!newRule.trim() || rulesBusy}
              style={{ fontSize: 13, fontWeight: 500, background: (!newRule.trim() || rulesBusy) ? LINE2 : INK, color: (!newRule.trim() || rulesBusy) ? MUTED : PAPER, borderRadius: 999, padding: '8px 16px', border: 'none', cursor: 'pointer', fontFamily: BODY }}>
              Add
            </button>
          </form>
        </div>
      )}

      {/* ── Pipeline summary ── */}
      <PipelineSummary initData={initData} />

      {/* ── 4 primary insight cards ── */}
      {showChips && (
        <div style={{ padding: '16px 22px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {PRIMARY_INSIGHTS.map(c => (
              <InsightCard
                key={c.q}
                icon={c.icon}
                title={c.title}
                desc={c.desc}
                onAsk={() => ask(c.q)}
              />
            ))}
          </div>

          {/* View all insights toggle */}
          <button
            onClick={() => setShowAllInsights(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, color: MUTED, fontFamily: BODY,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 0', marginBottom: showAllInsights ? 10 : 0,
            }}
          >
            {showAllInsights ? '▾ Fewer insights' : 'View all insights →'}
          </button>

          {showAllInsights && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
              {EXTRA_CHIPS.map(c => (
                <button
                  key={c.q}
                  onClick={() => ask(c.q)}
                  style={{
                    textAlign: 'left', background: CARD, border: `1px solid ${LINE2}`,
                    borderRadius: 12, padding: '10px 14px',
                    fontSize: 13, color: INK, cursor: 'pointer', fontFamily: BODY,
                    display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'border-color 0.15s',
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{c.icon}</span>
                  <span>{c.q}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Messages ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 22px', paddingBottom: 100 }}>
        {messages.map((m, i) => <MessageBubble key={i} m={m} onAction={runAction} initData={initData} />)}
        {busy && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      {/* ── Input bar ── */}
      <div style={{
        position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom))', left: 0, right: 0, zIndex: 20,
        background: PAPER, borderTop: `1px solid ${LINE}`, padding: '10px 16px 8px',
      }}>
        <form onSubmit={e => { e.preventDefault(); ask(); }} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: messages.length === 0 ? 8 : 0 }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            placeholder="Ask anything about your business…"
            disabled={busy}
            style={{
              flex: 1, background: CARD, border: `1px solid ${LINE}`,
              borderRadius: 999, padding: '10px 16px', fontSize: 14, color: INK,
              fontFamily: BODY, outline: 'none', opacity: busy ? 0.6 : 1,
            }}
          />
          <button type="submit" disabled={!input.trim() || busy} style={{
            fontSize: 14, fontWeight: 500,
            background: (!input.trim() || busy) ? LINE2 : INK,
            color: (!input.trim() || busy) ? MUTED : PAPER,
            borderRadius: 999, padding: '10px 20px', border: 'none',
            cursor: (!input.trim() || busy) ? 'default' : 'pointer',
            fontFamily: BODY, transition: 'all .15s', whiteSpace: 'nowrap',
          }}>
            {busy ? '…' : 'Ask'}
          </button>
        </form>

        {/* 3 quick chips — only when no messages yet */}
        {messages.length === 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
            {[
              { icon: '✨', q: 'What should I do today?' },
              { icon: '📈', q: 'How are my sales?' },
              { icon: '👥', q: 'Which customers need attention?' },
            ].map(c => (
              <button key={c.q} onClick={() => ask(c.q)} style={{
                flexShrink: 0,
                fontSize: 12, fontWeight: 500,
                background: CREAM, border: `1px solid ${LINE}`,
                color: INK, borderRadius: 999, padding: '6px 12px',
                cursor: 'pointer', fontFamily: BODY, whiteSpace: 'nowrap',
              }}>
                {c.icon} {c.q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ m, onAction, initData }) {
  const [fb, setFb] = useState(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  const INK_   = 'var(--ink)';
  const PAPER_ = 'var(--paper)';
  const CARD_  = 'var(--card)';
  const CREAM_ = 'var(--cream)';
  const CREAM2_= 'var(--cream-2)';
  const MINT_  = 'var(--mint)';
  const GOLD_  = 'var(--gold)';
  const MUTED_ = 'var(--muted)';
  const LINE_  = 'var(--line)';
  const LINE2_ = 'var(--line-soft)';

  if (m.role === 'owner') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '85%', background: INK_, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '8px 14px', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {m.text}
        </div>
      </div>
    );
  }

  async function sendFeedback(helpful, noteText) {
    setFb(helpful ? 'yes' : 'no');
    if (!helpful) setShowNote(true);
    try {
      await fetch('/api/advisor/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ helpful, note: noteText || undefined }),
      });
    } catch {}
  }

  const isError = m.text?.startsWith('⚠️');

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{
        maxWidth: '90%', background: CARD_, border: `1px solid ${LINE2_}`,
        borderRadius: '16px 16px 16px 4px', padding: '10px 14px', fontSize: 14,
        color: INK_, whiteSpace: 'pre-wrap', lineHeight: 1.55,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🧠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{m.text}</div>
            {m.actions?.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {m.actions.map((a, i) => (
                  <button key={i} onClick={() => onAction(a)} style={{
                    fontSize: 12, fontWeight: 500, background: CREAM_, border: `1px solid ${LINE_}`,
                    color: INK_, borderRadius: 999, padding: '5px 12px',
                    cursor: 'pointer', fontFamily: "'Geist', 'Inter', system-ui, sans-serif", transition: 'background .12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = CREAM2_}
                    onMouseLeave={e => e.currentTarget.style.background = CREAM_}
                  >{a.label} →</button>
                ))}
              </div>
            )}
            {!isError && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, opacity: fb ? 1 : 0.45 }}>
                <button data-intent="agent.reply.accept" onClick={() => !fb && sendFeedback(true)} disabled={!!fb || !initData} title="Helpful" style={{
                  background: fb === 'yes' ? 'rgba(79,163,138,.15)' : 'transparent',
                  border: `1px solid ${fb === 'yes' ? MINT_ : LINE2_}`,
                  color: fb === 'yes' ? MINT_ : MUTED_,
                  borderRadius: 999, padding: '2px 9px', fontSize: 12,
                  cursor: fb || !initData ? 'default' : 'pointer', fontFamily: "'Geist', system-ui, sans-serif",
                }}>👍</button>
                <button data-intent="agent.reply.reject" onClick={() => !fb && sendFeedback(false)} disabled={!!fb || !initData} title="Not quite" style={{
                  background: fb === 'no' ? 'rgba(176,138,74,.12)' : 'transparent',
                  border: `1px solid ${fb === 'no' ? GOLD_ : LINE2_}`,
                  color: fb === 'no' ? GOLD_ : MUTED_,
                  borderRadius: 999, padding: '2px 9px', fontSize: 12,
                  cursor: fb || !initData ? 'default' : 'pointer', fontFamily: "'Geist', system-ui, sans-serif",
                }}>👎</button>
                {fb === 'yes' && <span style={{ fontSize: 11, color: MINT_ }}>Thanks!</span>}
                {fb === 'no' && !noteSaved && !showNote && <span style={{ fontSize: 11, color: GOLD_ }}>Logged</span>}
                {noteSaved && <span style={{ fontSize: 11, color: MINT_ }}>Got it — noted</span>}
              </div>
            )}
            {showNote && fb === 'no' && !noteSaved && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What was wrong? (optional)"
                  style={{ flex: 1, background: PAPER_, border: `1px solid ${LINE_}`, borderRadius: 999, padding: '5px 12px', fontSize: 12, color: INK_, fontFamily: "'Geist', system-ui, sans-serif", outline: 'none' }}
                />
                <button onClick={async () => {
                  if (!note.trim()) { setShowNote(false); return; }
                  await fetch('/api/advisor/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
                    body: JSON.stringify({ helpful: false, note: note.trim() }),
                  });
                  setNoteSaved(true); setShowNote(false);
                }}
                  style={{ background: INK_, color: PAPER_, border: 'none', borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'Geist', system-ui, sans-serif" }}
                >Save</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  const LINE2_ = 'var(--line-soft)';
  const MUTED_ = 'var(--muted)';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINE2_}`, borderRadius: '16px 16px 16px 4px', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[0, 150, 300].map(d => (
            <span key={d} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: MUTED_, animation: `mmBounce 1s ${d}ms infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
