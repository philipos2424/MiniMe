'use client';
import { forwardRef, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Sparkles, Plus, Trash2, CheckCircle2, MessageSquare,
  BookOpen, Compass, Lightbulb, Check, ChevronRight, X
} from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { updateBusiness } from '../../lib/updateBusiness';

// ─── Theme Tokens (Fully dark-mode & light-mode aware) ──────────────────────
const INK   = 'var(--ink)';
const PAPER = 'var(--paper)';
const CARD  = 'var(--card)';
const CREAM2= 'var(--cream-2)';
const LINE  = 'var(--line)';
const LINESF= 'var(--line-soft)';
const MUTED = 'var(--muted)';
const ERROR = 'var(--error)';
const MINT  = 'var(--mint)';
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const TABS = [
  { id: 'voice',     label: 'Voice',     icon: Sparkles, desc: 'Help MiniMe learn how you naturally reply.' },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen, desc: 'Tell MiniMe facts, URLs, or upload catalog files.' },
  { id: 'rules',     label: 'Rules',     icon: Compass,  desc: "Set hard rules for greetings, pricing & brand guidelines." },
  { id: 'examples',  label: 'Examples',  icon: MessageSquare, desc: 'Paste real customer exchanges to train tone.' },
];

const VALID_TABS = TABS.map(t => t.id);

const STARTER_CHIPS = [
  { label: '👋 Greeting', text: 'Selam! Thank you for reaching out to us today. How can we help you?' },
  { label: '📞 Support', text: 'Our team is here to help! You can call us anytime at +251 91 123 4567.' },
  { label: '💰 Pricing', text: 'Prices start from 150 ETB. We offer special discounts on bulk orders!' },
  { label: '📦 Delivery', text: 'We deliver all across Addis Ababa within 24 hours for a flat fee of 50 ETB.' },
  { label: '🙏 Thank You', text: 'Thank you for choosing us! Have a wonderful rest of your day 😊' },
];

function Toast({ msg, sub }) {
  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--mint)', color: '#FFFFFF', padding: '12px 20px', borderRadius: 16,
      fontSize: 13.5, fontFamily: BODY, boxShadow: '0 10px 30px rgba(16, 185, 129, 0.3)',
      zIndex: 99, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      animation: 'fadeUp .2s ease', textAlign: 'center', minWidth: 260
    }}>
      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <CheckCircle2 size={16} /> {msg}
      </div>
      {sub && <div style={{ fontSize: 11.5, opacity: 0.9 }}>{sub}</div>}
    </div>
  );
}

export default function TeachPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = VALID_TABS.includes(searchParams?.get('tab')) ? searchParams.get('tab') : 'voice';
  const [tab, setTab] = useState(initialTab);
  const active = TABS.find(t => t.id === tab);
  const { business } = useTelegram() || {};

  // Sample count for progress
  const sampleCount = (business?.sample_replies || []).length;
  const targetCount = 20;
  const pct = Math.min(100, Math.round((sampleCount / targetCount) * 100));

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 110, fontFamily: BODY, color: INK, maxWidth: 640, margin: '0 auto' }}>

      {/* Header Navigation */}
      <div style={{ padding: '20px 20px 16px', background: CARD, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13.5, fontWeight: 600, color: MINT, padding: 0,
            }}
          >
            <ArrowLeft size={18} /> Teach MiniMe
          </button>
          <div style={{
            background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 999,
            padding: '3px 10px', fontSize: 11.5, fontWeight: 700, color: MINT,
            display: 'flex', alignItems: 'center', gap: 5
          }}>
            <Sparkles size={13} /> {sampleCount} / {targetCount} examples
          </div>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: INK, margin: '0 0 6px' }}>
          Teach MiniMe
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px', lineHeight: 1.5 }}>
          Help MiniMe learn how you naturally reply. The more examples you add, the more it sounds like you.
        </p>

        {/* Progress Bar */}
        <div style={{ height: 6, background: CREAM2, borderRadius: 999, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, #10B981, #059669)',
            transition: 'width 0.4s ease'
          }} />
        </div>

        {/* Segmented Control Tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: 4, background: CREAM2,
          borderRadius: 14, border: `1px solid ${LINE}`, overflowX: 'auto'
        }}>
          {TABS.map(t => {
            const isActive = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: 1, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: BODY, fontSize: 13, fontWeight: isActive ? 700 : 500,
                border: 'none',
                background: isActive ? MINT : 'transparent',
                color: isActive ? '#FFFFFF' : MUTED,
                boxShadow: isActive ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .15s',
              }}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 20px' }}>
        <div style={{
          background: CARD, border: `1px solid ${LINE}`,
          borderRadius: 20, padding: '24px 20px', boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
        }}>
          {tab === 'voice'     && <VoiceTab />}
          {tab === 'knowledge' && <KnowledgeTab />}
          {tab === 'rules'     && <RulesTab />}
          {tab === 'examples'  && <ExamplesTab />}
        </div>
      </div>

      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
    </div>
  );
}

/* ─────────────────── Voice tab ─────────────────── */
function VoiceTab() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();
  const [samples, setSamples] = useState(ctxBusiness?.sample_replies || []);
  const [newSample, setNewSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [learnedTags, setLearnedTags] = useState([]);

  useEffect(() => {
    if (ctxBusiness?.sample_replies) setSamples(ctxBusiness.sample_replies);
  }, [ctxBusiness?.id]);

  function flash(msg, sub) {
    setToast({ msg, sub });
    setTimeout(() => setToast(null), 3000);
  }

  async function addSample(customText) {
    const textToAdd = (customText || newSample).trim();
    if (!textToAdd || !ctxBusiness?.id || busy) return;
    setBusy(true);
    const updated = [...samples, textToAdd];
    setSamples(updated); setNewSample('');
    try {
      await updateBusiness(initData, { sample_replies: updated });
      setBusiness(b => ({ ...b, sample_replies: updated }));
      setLearnedTags(['Friendly tone', 'Uses emojis', 'Natural greeting']);
      flash('MiniMe learned a new response!', 'Updated voice model with your tone');
    } catch (e) {
      flash('Could not save — try again');
    }
    setBusy(false);
  }

  async function removeSample(i) {
    if (!ctxBusiness?.id) return;
    const updated = samples.filter((_, idx) => idx !== i);
    setSamples(updated);
    try {
      await updateBusiness(initData, { sample_replies: updated });
      setBusiness(b => ({ ...b, sample_replies: updated }));
    } catch (e) {
      flash('Could not save — try again');
    }
  }

  return (
    <div>
      {toast && <Toast msg={toast.msg} sub={toast.sub} />}

      {/* Section 1: Voice Examples List */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>
            Voice Examples
          </h2>
          <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
            {samples.length} saved
          </span>
        </div>

        {samples.length === 0 ? (
          /* Friendly Coaching Empty State */
          <div style={{
            background: CREAM2, border: `1px border-dashed ${LINE}`, borderRadius: 16,
            padding: '24px 18px', textAlign: 'center', marginBottom: 20
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: INK, marginBottom: 4 }}>
              Teach MiniMe your communication style
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14, lineHeight: 1.45 }}>
              Start with 5 natural replies you frequently send to customers:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', fontSize: 12, color: MUTED, maxWidth: 300, margin: '0 auto 16px' }}>
              <div>• Welcome & greet new customers</div>
              <div>• Explain product prices & delivery</div>
              <div>• Thank customers after purchases</div>
            </div>
          </div>
        ) : (
          /* Clean List Items */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {samples.map((text, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                background: CREAM2, border: `1px solid ${LINE}`,
                borderRadius: 14, padding: '12px 14px',
                transition: 'all 0.15s ease',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>💬</span>
                <span style={{ flex: 1, fontSize: 13.5, color: INK, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                  {text}
                </span>
                <button
                  onClick={() => removeSample(i)}
                  title="Remove sample"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: MUTED, padding: 4, display: 'grid', placeItems: 'center',
                    transition: 'color 0.15s'
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Quick Suggestions Chips */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>
          Suggestions (tap to fill)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STARTER_CHIPS.map(c => (
            <button
              key={c.label}
              onClick={() => setNewSample(c.text)}
              style={{
                background: CREAM2, border: `1px solid ${LINE}`, borderRadius: 999,
                padding: '6px 12px', fontSize: 12.5, fontWeight: 500, color: INK,
                cursor: 'pointer', transition: 'all 0.15s ease', fontFamily: BODY,
                display: 'inline-flex', alignItems: 'center', gap: 4
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section 3: Input Area (Tall Text Composer) */}
      <div style={{ marginBottom: 28 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>
          Teach MiniMe how you would respond:
        </label>
        <textarea
          value={newSample}
          onChange={e => setNewSample(e.target.value)}
          rows={4}
          placeholder='Example: "Selam! Thank you for contacting us. We are open from 8 AM to 6 PM. How can we help you today? 😊"'
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            border: `1.5px solid ${newSample.trim() ? MINT : LINE}`,
            borderRadius: 14, padding: '14px', fontSize: 14, fontFamily: BODY,
            color: INK, background: PAPER, outline: 'none', lineHeight: 1.5,
            transition: 'border-color 0.15s ease', marginBottom: 10
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => addSample()}
            disabled={!newSample.trim() || busy}
            style={{
              appearance: 'none', border: 'none',
              background: newSample.trim() ? MINT : CREAM2,
              color: newSample.trim() ? '#FFFFFF' : MUTED,
              borderRadius: 999, padding: '10px 22px',
              fontSize: 13.5, fontWeight: 700, cursor: newSample.trim() ? 'pointer' : 'default',
              boxShadow: newSample.trim() ? '0 4px 12px rgba(16, 185, 129, 0.25)' : 'none',
              transition: 'all 0.15s ease', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <Plus size={16} /> {busy ? 'Saving...' : 'Add Sample'}
          </button>
        </div>
      </div>

      {/* Section 4: AI Feedback Confirmation (If recently added) */}
      {learnedTags.length > 0 && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 16,
          padding: '14px 16px', marginBottom: 24, display: 'flex', alignItems: 'flex-start', gap: 12
        }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: MINT, marginBottom: 4 }}>
              MiniMe learned something new about your tone!
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {learnedTags.map(tag => (
                <span key={tag} style={{
                  background: CARD, border: '1px solid rgba(16, 185, 129, 0.4)', color: MINT,
                  borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600
                }}>
                  ✓ {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section 5: Live MiniMe Preview Card */}
      <div style={{
        background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
        borderRadius: 20, padding: '20px', color: '#FFFFFF',
        boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.3)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="#34D399" />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase', color: '#94A3B8' }}>
              MiniMe Live Preview
            </span>
          </div>
          <span style={{ fontSize: 11.5, background: 'rgba(52, 211, 153, 0.2)', color: '#34D399', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>
            ★ ★ ★ ★ ★ Sounds like you
          </span>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14, padding: '14px', fontSize: 14, lineHeight: 1.5, color: '#F8FAFC',
          fontStyle: 'italic', marginBottom: 10
        }}>
          "{samples.length > 0
            ? samples[samples.length - 1]
            : 'Selam 😊 Thank you for reaching out! How can I help you today?'}"
        </div>
        <div style={{ fontSize: 11.5, color: '#94A3B8', textAlign: 'right' }}>
          Updated based on your {samples.length} voice sample{samples.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Knowledge tab ─────────────────── */
function KnowledgeTab() {
  const { initData } = useTelegram() || {};
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');
  const [uploadState, setUploadState] = useState('idle');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef(null);
  const knowledgeTextareaRef = useRef(null);
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(true);

  const fetchSources = useCallback(async () => {
    if (!initData) return;
    try {
      const r = await fetch('/api/agent/knowledge', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      setSources(Array.isArray(j.sources) ? j.sources : []);
    } catch {} finally { setLoadingSources(false); }
  }, [initData]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  async function removeSource(id) {
    if (!initData) return;
    setSources(prev => prev.filter(s => s.id !== id));
    try {
      await fetch(`/api/agent/knowledge?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'x-telegram-init-data': initData },
      });
    } catch { fetchSources(); }
  }

  function applyTemplate(template) {
    setText(template);
    setTimeout(() => {
      const ta = knowledgeTextareaRef.current;
      if (!ta) return;
      ta.focus();
      const start = template.indexOf('[');
      const end   = template.indexOf(']');
      if (start !== -1 && end !== -1) ta.setSelectionRange(start, end + 1);
    }, 50);
  }

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 2200); }

  async function addText() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ description: t }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setText(''); flash('Knowledge saved ✓');
      fetchSources();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      {toast && <Toast msg={toast} />}
      {err && <div style={{ fontSize: 12.5, color: ERROR, marginBottom: 12 }}>{err}</div>}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 10px' }}>
          Quick Knowledge Templates
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { label: '📍 Location',   template: 'We are located at [your address]. Nearest landmark: [landmark].' },
            { label: '⏰ Hours',      template: 'We are open Monday–Saturday from 8am to 6pm.' },
            { label: '💳 Payment',    template: 'We accept: Chapa, CBE Birr, Telebirr, and cash on delivery.' },
            { label: '🚚 Delivery',   template: 'We deliver within Addis Ababa for 50 ETB. Outside Addis: 100 ETB.' },
          ].map(({ label, template }) => (
            <button key={label} onClick={() => applyTemplate(template)}
              style={{
                fontSize: 12.5, padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${LINE}`, background: CREAM2,
                cursor: 'pointer', fontFamily: BODY, color: INK, fontWeight: 500,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>
          Tell MiniMe a Fact
        </label>
        <textarea ref={knowledgeTextareaRef} value={text} onChange={e => setText(e.target.value)}
          placeholder="e.g. Our delivery fee is 50 ETB for Addis Ababa."
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none', border: `1.5px solid ${LINE}`,
            borderRadius: 14, padding: '12px', fontSize: 14, fontFamily: BODY, color: INK, background: PAPER, outline: 'none', marginBottom: 10
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={addText} disabled={!text.trim() || busy}
            style={{
              background: text.trim() ? MINT : CREAM2, color: text.trim() ? '#FFFFFF' : MUTED,
              border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: text.trim() ? 'pointer' : 'default'
            }}>
            Save Fact
          </button>
        </div>
      </div>

      <div style={{ height: 1, background: LINE, margin: '20px 0' }} />

      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 12px' }}>
          What MiniMe Has Learned ({sources.length})
        </h2>
        {loadingSources ? (
          <div style={{ fontSize: 12.5, color: MUTED }}>Loading sources...</div>
        ) : sources.length === 0 ? (
          <div style={{ fontSize: 12.5, color: MUTED }}>No knowledge sources saved yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: CREAM2, border: `1px solid ${LINE}`, borderRadius: 12
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{s.title || s.url || 'Fact'}</span>
                <button onClick={() => removeSource(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Rules tab ─────────────────── */
function RulesTab() {
  const { initData } = useTelegram() || {};
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 1800); }

  const fetchRules = useCallback(async () => {
    if (!initData) return;
    const r = await fetch('/api/settings/instructions', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    const j = await r.json();
    if (j?.instructions) setRules(j.instructions);
  }, [initData]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  async function add(rule) {
    const text = (rule || newRule).trim();
    if (!text || !initData || busy) return;
    setBusy(true);
    const r = await fetch('/api/settings/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'add', rule: text }),
    });
    const j = await r.json();
    if (j?.instructions) setRules(j.instructions);
    if (!rule) setNewRule('');
    setBusy(false); flash('Rule added ✓');
  }

  async function remove(index) {
    if (!initData) return;
    const r = await fetch('/api/settings/instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'remove', index }),
    });
    const j = await r.json();
    if (j?.instructions) setRules(j.instructions);
  }

  return (
    <div>
      {toast && <Toast msg={toast} />}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 12px' }}>
        Brand Rules
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {rules.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', background: CREAM2, border: `1px solid ${LINE}`, borderRadius: 12
          }}>
            <span style={{ fontSize: 13, color: INK }}>{typeof r === 'string' ? r : r.rule}</span>
            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={newRule} onChange={e => setNewRule(e.target.value)}
          placeholder="e.g. Always greet in Amharic first"
          style={{ flex: 1, padding: '10px 14px', borderRadius: 12, border: `1px solid ${LINE}`, outline: 'none', fontSize: 13.5, background: PAPER, color: INK }}
        />
        <button onClick={() => add()} disabled={!newRule.trim() || busy}
          style={{ background: MINT, color: '#FFFFFF', border: 'none', borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 700 }}>
          Add Rule
        </button>
      </div>
    </div>
  );
}

/* ─────────────────── Examples tab ─────────────────── */
function ExamplesTab() {
  const { initData } = useTelegram() || {};
  const [snippet, setSnippet] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 2000); }

  async function submit() {
    const s = snippet.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ forwardedSnippets: [s] }),
      });
      if (r.ok) { setSnippet(''); flash('Example exchange learned ✓'); }
    } catch {} finally { setBusy(false); }
  }

  return (
    <div>
      {toast && <Toast msg={toast} />}
      <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 8px' }}>
        Paste Conversation Exchange
      </h2>
      <p style={{ fontSize: 13, color: MUTED, marginBottom: 14 }}>
        Paste a real exchange: customer question followed by your ideal response.
      </p>
      <textarea
        value={snippet} onChange={e => setSnippet(e.target.value)} rows={5}
        placeholder={'Customer: How much for 2 items?\nMe: Each item is 150 ETB, so 2 = 300 ETB. Would you like me to place the order? 😊'}
        style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '14px', fontSize: 13.5, outline: 'none', marginBottom: 12, background: PAPER, color: INK }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={submit} disabled={!snippet.trim() || busy}
          style={{ background: MINT, color: '#FFFFFF', border: 'none', borderRadius: 999, padding: '10px 20px', fontSize: 13.5, fontWeight: 700 }}>
          Teach Exchange
        </button>
      </div>
    </div>
  );
}
