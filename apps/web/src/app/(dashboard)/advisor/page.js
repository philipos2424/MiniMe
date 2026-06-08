'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const CREAM2= '#EDE6D6';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const LINE2 = '#EEE9DE';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const CHIPS = [
  { icon: '🎯', q: 'What should I focus on today?' },
  { icon: '📈', q: 'What\'s my revenue trend this month?' },
  { icon: '👥', q: 'Which customers should I reach out to?' },
  { icon: '🧠', q: 'What have you learned from my conversations this week?' },
  { icon: '💰', q: 'Which orders are overdue for payment?' },
  { icon: '⭐', q: 'Who are my most loyal customers and what do they buy?' },
  { icon: '📦', q: 'Which products should I restock urgently?' },
  { icon: '🔁', q: 'Which customers haven\'t ordered in a while?' },
  { icon: '📊', q: 'How is MiniMe performing this week?' },
  { icon: '🚀', q: 'Give me 3 quick wins I can do today to grow revenue' },
];

const RULE_SUGGESTIONS = [
  { icon: '😊', rule: 'Use emojis often' },
  { icon: '🇪🇹', rule: 'Always greet in Amharic first' },
  { icon: '📝', rule: 'Keep replies short and to the point' },
  { icon: '🎩', rule: 'Be more formal' },
  { icon: '🚫', rule: "Never discuss competitor prices" },
  { icon: '📞', rule: 'Always end with our phone number' },
];

export default function AdvisorPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [rulesBusy, setRulesBusy] = useState(false);
  const endRef = useRef(null);

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
    try {
      const r = await fetch('/api/advisor/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setMessages(m => [...m, { role: 'advisor', text: j.response || '(no reply)', actions: j.suggestedActions || [], isInstruction: j.instructionSaved }]);
      // If a rule was saved, refresh the rules panel
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

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 120, fontFamily: BODY, color: INK, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ padding: '20px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>Advisor</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, letterSpacing: '-0.015em', color: INK }}>Your business,<br /><em>in plain language.</em></div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <button onClick={() => setShowRules(v => !v)} style={{
              fontSize: 12, fontWeight: 500, color: showRules ? INK : MUTED,
              background: showRules ? CREAM2 : 'transparent', border: `1px solid ${showRules ? LINE : LINE2}`,
              borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: BODY, transition: 'all .15s',
            }}>
              📋 Rules{rules.length > 0 ? ` (${rules.length})` : ''}
            </button>
            <button onClick={() => router.push('/teach')} style={{
              fontSize: 12, fontWeight: 500, color: INK, background: CREAM, border: `1px solid ${LINE}`,
              borderRadius: 999, padding: '6px 12px', cursor: 'pointer', fontFamily: BODY,
            }}>Teach →</button>
          </div>
        </div>
      </header>

      {/* Instructions Panel */}
      {showRules && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, margin: '14px 22px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Rules for MiniMe</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {RULE_SUGGESTIONS.filter(s => !rules.some(r => r.rule?.toLowerCase() === s.rule.toLowerCase())).map(s => (
              <button key={s.rule} onClick={() => addRule(s.rule)} disabled={rulesBusy}
                style={{ fontSize: 11, fontWeight: 500, background: '#fff', border: `1px solid ${LINE}`, color: INK, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: BODY }}>
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
              style={{ flex: 1, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 14px', fontSize: 13, color: INK, fontFamily: BODY, outline: 'none' }}
            />
            <button type="submit" disabled={!newRule.trim() || rulesBusy}
              style={{ fontSize: 13, fontWeight: 500, background: (!newRule.trim() || rulesBusy) ? LINE2 : INK, color: (!newRule.trim() || rulesBusy) ? MUTED : PAPER, borderRadius: 999, padding: '8px 16px', border: 'none', cursor: 'pointer', fontFamily: BODY }}>
              Add
            </button>
          </form>
        </div>
      )}

      {/* Chips */}
      {showChips && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '16px 22px 0' }}>
          {CHIPS.map(c => (
            <button key={c.q} onClick={() => ask(c.q)} style={{
              textAlign: 'left', background: '#fff', border: `1px solid ${LINE2}`,
              borderRadius: 12, padding: '10px 12px', fontSize: 13, color: INK,
              cursor: 'pointer', fontFamily: BODY, transition: 'border-color .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = LINE}
              onMouseLeave={e => e.currentTarget.style.borderColor = LINE2}
            >
              <span style={{ marginRight: 6 }}>{c.icon}</span>{c.q}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 22px', paddingBottom: 100 }}>
        {messages.map((m, i) => <MessageBubble key={i} m={m} onAction={runAction} initData={initData} />)}
        {busy && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); ask(); }} style={{
        display: 'flex', gap: 8, alignItems: 'center',
        position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom))', left: 0, right: 0, zIndex: 20,
        background: PAPER, borderTop: `1px solid ${LINE}`, padding: '10px 16px',
      }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          placeholder="Ask anything about your business…"
          disabled={busy}
          style={{
            flex: 1, background: '#fff', border: `1px solid ${LINE}`,
            borderRadius: 999, padding: '10px 16px', fontSize: 14, color: INK,
            fontFamily: BODY, outline: 'none', opacity: busy ? 0.6 : 1,
          }}
        />
        <button type="submit" disabled={!input.trim() || busy} style={{
          fontSize: 14, fontWeight: 500,
          background: (!input.trim() || busy) ? LINE2 : INK,
          color: (!input.trim() || busy) ? MUTED : PAPER,
          borderRadius: 999, padding: '10px 20px', border: 'none',
          cursor: (!input.trim() || busy) ? 'default' : 'pointer', fontFamily: BODY, transition: 'all .15s', whiteSpace: 'nowrap',
        }}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ m, onAction, initData }) {
  const [fb, setFb] = useState(null);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  if (m.role === 'owner') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '85%', background: INK, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '8px 14px', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
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
        maxWidth: '90%', background: '#fff', border: `1px solid ${LINE2}`,
        borderRadius: '16px 16px 16px 4px', padding: '10px 14px', fontSize: 14,
        color: INK, whiteSpace: 'pre-wrap', lineHeight: 1.55,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🧠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{m.text}</div>
            {m.actions?.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {m.actions.map((a, i) => (
                  <button key={i} onClick={() => onAction(a)} style={{
                    fontSize: 12, fontWeight: 500, background: CREAM, border: `1px solid ${LINE}`,
                    color: INK, borderRadius: 999, padding: '5px 12px',
                    cursor: 'pointer', fontFamily: BODY, transition: 'background .12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = CREAM2}
                    onMouseLeave={e => e.currentTarget.style.background = CREAM}
                  >{a.label} →</button>
                ))}
              </div>
            )}

            {!isError && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, opacity: fb ? 1 : 0.45 }}>
                <button onClick={() => !fb && sendFeedback(true)} disabled={!!fb || !initData} title="Helpful" style={{
                  background: fb === 'yes' ? 'rgba(79,163,138,.15)' : 'transparent',
                  border: `1px solid ${fb === 'yes' ? MINT : LINE2}`,
                  color: fb === 'yes' ? MINT : MUTED,
                  borderRadius: 999, padding: '2px 9px', fontSize: 12,
                  cursor: fb || !initData ? 'default' : 'pointer', fontFamily: BODY,
                }}>👍</button>
                <button onClick={() => !fb && sendFeedback(false)} disabled={!!fb || !initData} title="Not quite" style={{
                  background: fb === 'no' ? 'rgba(176,138,74,.12)' : 'transparent',
                  border: `1px solid ${fb === 'no' ? GOLD : LINE2}`,
                  color: fb === 'no' ? GOLD : MUTED,
                  borderRadius: 999, padding: '2px 9px', fontSize: 12,
                  cursor: fb || !initData ? 'default' : 'pointer', fontFamily: BODY,
                }}>👎</button>
                {fb === 'yes' && <span style={{ fontSize: 11, color: MINT }}>Thanks!</span>}
                {fb === 'no' && !noteSaved && !showNote && <span style={{ fontSize: 11, color: GOLD }}>Logged</span>}
                {noteSaved && <span style={{ fontSize: 11, color: MINT }}>Got it — noted</span>}
              </div>
            )}

            {showNote && fb === 'no' && !noteSaved && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What was wrong? (optional)"
                  style={{ flex: 1, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px', fontSize: 12, color: INK, fontFamily: BODY, outline: 'none' }}
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
                  style={{ background: INK, color: PAPER, border: 'none', borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: BODY }}
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
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: '16px 16px 16px 4px', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {[0, 150, 300].map(d => (
            <span key={d} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: MUTED, animation: `mmBounce 1s ${d}ms infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
