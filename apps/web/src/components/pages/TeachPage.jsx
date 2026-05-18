'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const CREAM2= '#EDE6D6';
const GOLD  = '#B08A4A';
const LINE  = '#E4DED1';
const LINE2 = '#EEE9DE';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const MINT  = '#4FA38A';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const TABS = [
  { id: 'voice',     label: 'Voice',     icon: '🗣',  desc: "Paste a reply you'd send — MiniMe will sound like you." },
  { id: 'knowledge', label: 'Knowledge', icon: '📚',  desc: 'Tell MiniMe a fact, give it a URL to read, or upload a PDF.' },
  { id: 'rules',     label: 'Rules',     icon: '📋',  desc: "Set hard rules — always, never, how to greet." },
  { id: 'examples',  label: 'Examples',  icon: '💬',  desc: 'Paste a real customer exchange to teach from it.' },
];

function Toast({ msg }) {
  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
      background: INK, color: PAPER, padding: '10px 20px', borderRadius: 999,
      fontSize: 13, fontFamily: BODY, boxShadow: '0 8px 24px rgba(14,40,35,.25)',
      zIndex: 99, whiteSpace: 'nowrap', animation: 'fadeUp .2s ease',
    }}>{msg}</div>
  );
}

const VALID_TABS = TABS.map(t => t.id);

export default function TeachPage() {
  const searchParams = useSearchParams();
  const initialTab = VALID_TABS.includes(searchParams?.get('tab')) ? searchParams.get('tab') : 'voice';
  const [tab, setTab] = useState(initialTab);
  const active = TABS.find(t => t.id === tab);

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <div style={{ padding: '20px 22px 0', background: PAPER, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>Teach</div>
        <div style={{ fontFamily: SERIF, fontSize: 26, letterSpacing: '-0.015em', color: INK, marginBottom: 4 }}>
          <em>Sharpen</em> MiniMe.
        </div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.45 }}>{active?.desc}</div>

        {/* Tab pills */}
        <div style={{ display: 'flex', gap: 6, paddingBottom: 14, overflowX: 'auto' }}>
          {TABS.map(t => {
            const isActive = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '7px 14px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: BODY, fontSize: 13, fontWeight: 500,
                border: `1px solid ${isActive ? INK : LINE}`,
                background: isActive ? INK : '#fff',
                color: isActive ? PAPER : INK,
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s',
              }}>
                <span>{t.icon}</span> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '20px 22px' }}>
        <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, padding: '16px 14px' }}>
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
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const [samples, setSamples] = useState(ctxBusiness?.sample_replies || []);
  const [newSample, setNewSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const supabase = createClient();

  useEffect(() => {
    if (ctxBusiness?.sample_replies) setSamples(ctxBusiness.sample_replies);
  }, [ctxBusiness?.id]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 1800); }

  async function addSample() {
    if (!newSample.trim() || !ctxBusiness?.id || busy) return;
    setBusy(true);
    const updated = [...samples, newSample.trim()];
    setSamples(updated); setNewSample('');
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', ctxBusiness.id);
    setBusiness(b => ({ ...b, sample_replies: updated }));
    setBusy(false); flash('Sample added ✓');
  }
  async function removeSample(i) {
    if (!ctxBusiness?.id) return;
    const updated = samples.filter((_, idx) => idx !== i);
    setSamples(updated);
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', ctxBusiness.id);
    setBusiness(b => ({ ...b, sample_replies: updated }));
  }

  return (
    <>
      {toast && <Toast msg={toast} />}
      <SectionLabel>{`Your samples (${samples.length})`}</SectionLabel>
      <ItemList items={samples} empty="No samples yet — add your first reply." onRemove={removeSample} />
      <Composer value={newSample} onChange={setNewSample}
        placeholder='e.g. "ሰላም! እንኳን ደህና መጡ! How can I help you today? 😊"'
        rows={2} onSubmit={addSample} busy={busy} buttonLabel="Add" />
    </>
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
  const [uploadState, setUploadState] = useState('idle'); // 'idle' | 'uploading' | 'done' | 'error'
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef(null);

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
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function addUrl() {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/agent/knowledge/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ url: u }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setUrl(''); flash('URL ingested ✓');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const isImage = (f) => f?.type?.startsWith('image/');

  async function uploadFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { setErr('File too large (max 15 MB)'); return; }
    setUploadState('uploading'); setUploadMsg(''); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      fd.append('title', f.name);
      fd.append('tag', isImage(f) ? 'image_upload' : 'bot_upload');
      // Images go to the vision endpoint; PDFs/text go to documents
      const endpoint = isImage(f) ? '/api/teach/image' : '/api/documents/upload';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'upload failed');
      setUploadState('done');
      setUploadMsg(isImage(f)
        ? `Photo analysed — ${j.summary?.slice(0, 80) || 'knowledge saved'}…`
        : `${f.name} — ${j.chunks ?? '?'} chunks saved`);
      setTimeout(() => { setUploadState('idle'); setUploadMsg(''); }, 4000);
    } catch (e) {
      setUploadState('error'); setErr(e.message);
      setTimeout(() => setUploadState('idle'), 3000);
    }
  }

  return (
    <>
      {toast && <Toast msg={toast} />}
      {err && <div style={{ fontSize: 12, color: ERROR, marginBottom: 8 }}>{err}</div>}

      {/* Smart-caption tip */}
      <div style={{
        background: 'rgba(176,138,74,.08)',
        border: '1px solid rgba(176,138,74,.2)',
        borderRadius: 12, padding: '12px 14px', marginBottom: 18,
        fontSize: 13, color: INK, lineHeight: 1.55,
      }}>
        💡 <strong>Quicker option:</strong> forward a supplier price list or stock sheet to your bot with the caption{' '}
        <em style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, fontStyle: 'normal', fontWeight: 500 }}>update stock</em> or{' '}
        <em style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, fontStyle: 'normal', fontWeight: 500 }}>new prices</em>{' '}
        — MiniMe will read it and apply changes automatically. No upload needed.
      </div>

      <SectionLabel>Tell MiniMe a fact</SectionLabel>
      <Composer value={text} onChange={setText}
        placeholder="e.g. Our delivery fee is 50 ETB for Addis, 100 ETB outside."
        rows={2} onSubmit={addText} busy={busy} buttonLabel="Save" />
      <div style={{ height: 1, background: LINE2, margin: '20px 0' }} />
      <SectionLabel>Ingest a URL</SectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addUrl(); }}
          placeholder="https://yoursite.com/menu"
          style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 999, padding: '10px 16px', fontSize: 14, fontFamily: BODY, color: INK, background: '#fff', outline: 'none', boxSizing: 'border-box' }}
        />
        <PrimaryBtn onClick={addUrl} disabled={!url.trim() || busy} label={busy ? '…' : 'Read'} />
      </div>
      <div style={{ height: 1, background: LINE2, margin: '20px 0' }} />
      <SectionLabel>Upload a file or photo</SectionLabel>
      <input ref={fileRef} type="file"
        accept=".pdf,.txt,text/plain,application/pdf,image/jpeg,image/png,image/webp,image/heic"
        style={{ display: 'none' }} onChange={uploadFile} />
      {uploadState === 'idle' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
            {/* Photo upload */}
            <button onClick={() => { if (fileRef.current) { fileRef.current.accept = 'image/*'; fileRef.current.click(); } }} style={{
              padding: '16px 12px', border: `1.5px dashed ${LINE}`,
              borderRadius: 12, background: CREAM, cursor: 'pointer',
              fontSize: 13, color: MUTED, fontFamily: BODY,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 24 }}>📸</span>
              <div style={{ fontWeight: 600, color: INK, fontSize: 13 }}>Photo</div>
              <div style={{ fontSize: 11, lineHeight: 1.35, textAlign: 'center' }}>
                Menu, price list,<br />product photo
              </div>
            </button>
            {/* PDF/doc upload */}
            <button onClick={() => { if (fileRef.current) { fileRef.current.accept = '.pdf,.txt,text/plain,application/pdf'; fileRef.current.click(); } }} style={{
              padding: '16px 12px', border: `1.5px dashed ${LINE}`,
              borderRadius: 12, background: CREAM, cursor: 'pointer',
              fontSize: 13, color: MUTED, fontFamily: BODY,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 24 }}>📄</span>
              <div style={{ fontWeight: 600, color: INK, fontSize: 13 }}>PDF / Doc</div>
              <div style={{ fontSize: 11, lineHeight: 1.35, textAlign: 'center' }}>
                Catalogue, brochure,<br />terms & conditions
              </div>
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.45 }}>
            📸 <strong>Photos:</strong> MiniMe uses AI vision to read your photo and extract all prices, products, and info automatically.
          </div>
        </>
      )}
      {uploadState === 'uploading' && (
        <div style={{ textAlign: 'center', padding: '12px', fontSize: 13, color: MUTED, fontFamily: BODY }}>
          ⏳ Reading &amp; embedding…
        </div>
      )}
      {uploadState === 'done' && (
        <div style={{ textAlign: 'center', padding: '12px', fontSize: 13, color: MINT, fontFamily: BODY, fontWeight: 500 }}>
          ✅ {uploadMsg}
        </div>
      )}
      {uploadState === 'error' && (
        <button onClick={() => { setUploadState('idle'); setErr(''); }} style={{
          width: '100%', padding: '12px', border: `1.5px dashed ${ERROR}`,
          borderRadius: 12, background: '#FFF5F5', cursor: 'pointer',
          fontSize: 13, color: ERROR, fontFamily: BODY,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          ⚠️ Upload failed — tap to retry
        </button>
      )}
    </>
  );
}

/* ─────────────────── Rules tab ─────────────────── */
const RULE_SUGGESTIONS = [
  { icon: '😊', rule: 'Use emojis often' },
  { icon: '🇪🇹', rule: 'Always greet in Amharic first' },
  { icon: '📝', rule: 'Keep replies short and direct' },
  { icon: '🎩', rule: 'Be more formal' },
  { icon: '🚫', rule: "Never discuss competitor prices" },
  { icon: '📞', rule: 'End with the phone number' },
];

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

  const activeRuleTexts = new Set(rules.map(r => (typeof r === 'string' ? r : r.rule)?.toLowerCase()));

  return (
    <>
      {toast && <Toast msg={toast} />}
      {/* Suggestion chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {RULE_SUGGESTIONS.filter(s => !activeRuleTexts.has(s.rule.toLowerCase())).map(s => (
          <button key={s.rule} onClick={() => add(s.rule)} disabled={busy} style={{
            fontSize: 12, fontWeight: 500, fontFamily: BODY, cursor: busy ? 'default' : 'pointer',
            background: CREAM, border: `1px solid ${LINE}`, color: INK,
            borderRadius: 999, padding: '6px 12px', transition: 'background .12s',
          }}
            onMouseEnter={e => !busy && (e.currentTarget.style.background = CREAM2)}
            onMouseLeave={e => (e.currentTarget.style.background = CREAM)}
          >{s.icon} {s.rule}</button>
        ))}
      </div>

      <ItemList
        items={rules.map(r => typeof r === 'string' ? r : r.rule)}
        empty="No rules yet — tap a suggestion or type your own."
        onRemove={remove}
        goldBg
      />
      <Composer value={newRule} onChange={setNewRule}
        placeholder='e.g. "Never quote prices without checking the catalog first"'
        rows={1} onSubmit={() => add()} busy={busy} buttonLabel="Add" />
    </>
  );
}

/* ─────────────────── Examples tab ─────────────────── */
function ExamplesTab() {
  const { initData } = useTelegram() || {};
  const [snippet, setSnippet] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 2000); }

  async function submit() {
    const s = snippet.trim();
    if (!s || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ forwardedSnippets: [s] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setSnippet(''); flash('Example learned ✓');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {toast && <Toast msg={toast} />}
      <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, marginBottom: 16 }}>
        Paste a real conversation exchange — customer question then your ideal reply.
      </div>
      {err && <div style={{ fontSize: 12, color: ERROR, marginBottom: 8 }}>{err}</div>}
      <textarea value={snippet} onChange={e => setSnippet(e.target.value)} rows={5}
        placeholder={'Customer: How much for 2 injera?\nMe: Each one is 15 ETB, so 2 = 30 ETB. Want me to place the order? 😊'}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'none', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, fontFamily: BODY, color: INK, background: '#fff', outline: 'none', lineHeight: 1.5, marginBottom: 12 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <PrimaryBtn onClick={submit} disabled={!snippet.trim() || busy} label={busy ? 'Learning…' : 'Teach MiniMe'} />
      </div>
    </>
  );
}

/* ─────────────────── shared atoms ─────────────────── */
function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>{children}</div>;
}

function PrimaryBtn({ onClick, disabled, label }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? LINE2 : INK, color: disabled ? MUTED : PAPER,
      border: 'none', borderRadius: 999, padding: '10px 20px',
      fontSize: 13, fontWeight: 500, fontFamily: BODY,
      cursor: disabled ? 'default' : 'pointer', flexShrink: 0, transition: 'all .15s', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
}

function ItemList({ items, empty, onRemove, goldBg }) {
  if (!items?.length) {
    return <div style={{ textAlign: 'center', padding: '16px 0', color: MUTED, fontSize: 13, fontFamily: SERIF, fontStyle: 'italic', marginBottom: 12 }}>{empty}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 280, overflowY: 'auto' }}>
      {items.map((text, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: goldBg ? 'rgba(176,138,74,.07)' : CREAM,
          border: `1px solid ${goldBg ? 'rgba(176,138,74,.2)' : LINE}`,
          borderRadius: 10, padding: '8px 10px',
        }}>
          <span style={{ flex: 1, fontSize: 13, color: INK, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{goldBg ? `✓ ${text}` : text}</span>
          <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 0, fontSize: 13, lineHeight: 1 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

function Composer({ value, onChange, placeholder, rows, onSubmit, busy, buttonLabel }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <textarea value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder} rows={rows}
        style={{ flex: 1, resize: 'none', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, fontFamily: BODY, color: INK, background: '#fff', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' }}
      />
      <PrimaryBtn onClick={onSubmit} disabled={!value.trim() || busy} label={busy ? '…' : buttonLabel} />
    </div>
  );
}
