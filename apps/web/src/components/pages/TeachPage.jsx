'use client';
import { forwardRef, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';
import { updateBusiness } from '../../lib/updateBusiness';

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
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();
  const [samples, setSamples] = useState(ctxBusiness?.sample_replies || []);
  const [newSample, setNewSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (ctxBusiness?.sample_replies) setSamples(ctxBusiness.sample_replies);
  }, [ctxBusiness?.id]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 1800); }

  async function addSample() {
    if (!newSample.trim() || !ctxBusiness?.id || busy) return;
    setBusy(true);
    const updated = [...samples, newSample.trim()];
    setSamples(updated); setNewSample('');
    try {
      await updateBusiness(initData, { sample_replies: updated });
      setBusiness(b => ({ ...b, sample_replies: updated }));
      flash('Sample added ✓');
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
  const knowledgeTextareaRef = useRef(null);
  // Saved sources — so the owner can SEE what they've already taught and not
  // re-add it (the #1 cause of duplicate facts/products in the catalog).
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
    setSources(prev => prev.filter(s => s.id !== id)); // optimistic
    try {
      await fetch(`/api/agent/knowledge?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'x-telegram-init-data': initData },
      });
    } catch { fetchSources(); } // re-sync on failure
  }

  // When a quick-fill template is applied, auto-focus and select the first [placeholder]
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
      const added = j?.result?.description?.products_added || 0;
      const updated = j?.result?.description?.products_updated || 0;
      setText('');
      if (added) flash(`Saved ✓ · ${added} product${added > 1 ? 's' : ''} added to your catalog`);
      else if (updated) flash(`Saved ✓ · ${updated} product${updated > 1 ? 's' : ''} updated`);
      else flash('Knowledge saved ✓');
      fetchSources();
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
      fetchSources();
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
      fetchSources();
      const pAdded = j.products_added || 0;
      setUploadMsg(
        pAdded
          ? `${pAdded} product${pAdded > 1 ? 's' : ''} added to your catalog ✓`
          : isImage(f)
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

      {/* Quick-fill prompts — most common first-time facts */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Quick add (tap to fill)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {[
            { label: '📍 Location',   template: 'We are located at [your address]. Nearest landmark: [landmark].' },
            { label: '⏰ Hours',      template: 'We are open Monday–Saturday from 8am to 6pm. Closed on Sundays and public holidays.' },
            { label: '💳 Payment',    template: 'We accept: Chapa, CBE Birr, Telebirr, and cash on delivery.' },
            { label: '🚚 Delivery',   template: 'We deliver within Addis Ababa for 50 ETB. Outside Addis: 100 ETB. Delivery takes 1–2 days.' },
            { label: '📱 Social',     template: 'Find us on Instagram: @[yourhandle]. Facebook: [facebook link]. TikTok: @[tiktokhandle].' },
            { label: '↩️ Returns',    template: 'We accept returns within 3 days if the item is unused and in original packaging. No returns on food items.' },
          ].map(({ label, template }) => (
            <button key={label} onClick={() => applyTemplate(template)}
              style={{
                fontSize: 12, padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${LINE}`, background: text === template ? INK : '#fff',
                cursor: 'pointer', fontFamily: BODY,
                color: text === template ? PAPER : INK, fontWeight: 500,
                transition: 'all .15s',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <SectionLabel>Tell MiniMe a fact</SectionLabel>
      <Composer ref={knowledgeTextareaRef} value={text} onChange={setText}
        placeholder="e.g. Our delivery fee is 50 ETB for Addis, 100 ETB outside."
        rows={3} onSubmit={addText} busy={busy} buttonLabel="Save" />
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

      {/* What MiniMe has learned — so the owner can SEE saved items and not
          re-add them (the main source of duplicate facts/products). */}
      <div style={{ height: 1, background: LINE2, margin: '20px 0' }} />
      <SectionLabel>{`What MiniMe has learned${sources.length ? ` (${sources.length})` : ''}`}</SectionLabel>
      {loadingSources ? (
        <div style={{ fontSize: 12.5, color: MUTED, padding: '6px 2px' }}>Loading…</div>
      ) : sources.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, padding: '6px 2px', lineHeight: 1.5 }}>
          Nothing saved yet. Facts, URLs and files you add above show up here — so you can check before adding the same thing twice.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sources.map(s => {
            const m = sourceMeta(s);
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', background: '#fff',
              }}>
                <span style={{ fontSize: 16, lineHeight: 1.3 }}>{m.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.title}
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {m.kind}
                    {s.status && s.status !== 'ready' ? ` · ${s.status}` : ''}
                    {typeof s.chunks === 'number' && s.chunks > 0 ? ` · ${s.chunks} chunk${s.chunks > 1 ? 's' : ''}` : ''}
                  </div>
                </div>
                <button onClick={() => removeSource(s.id)} aria-label="Remove"
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, fontSize: 18, padding: '0 2px', lineHeight: 1 }}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// Friendly icon + label + title for a saved knowledge source row.
function sourceMeta(s) {
  const tag = s.tag || '';
  if (s.kind === 'url' || tag === 'website') return { icon: '🔗', kind: 'URL', title: s.url || s.title || 'Link' };
  if (tag === 'business-brief')   return { icon: '📝', kind: 'Fact', title: s.title || 'Saved fact' };
  if (tag === 'forwarded-notes')  return { icon: '↪️', kind: 'Forwarded note', title: s.title || 'Forwarded note' };
  if (tag === 'image_upload')     return { icon: '📸', kind: 'Photo', title: s.title || s.filename || 'Photo' };
  if (tag === 'auto-learned')     return { icon: '✨', kind: 'Auto-learned', title: s.title || 'Auto-learned' };
  return { icon: '📄', kind: 'File', title: s.title || s.filename || 'File' };
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

const Composer = forwardRef(function Composer({ value, onChange, placeholder, rows, onSubmit, busy, buttonLabel }, ref) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder} rows={rows}
        style={{ flex: 1, resize: 'none', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', fontSize: 14, fontFamily: BODY, color: INK, background: '#fff', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' }}
      />
      <PrimaryBtn onClick={onSubmit} disabled={!value.trim() || busy} label={busy ? '…' : buttonLabel} />
    </div>
  );
});
