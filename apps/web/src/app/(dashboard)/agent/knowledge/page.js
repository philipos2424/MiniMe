'use client';
/**
 * Teach MiniMe — redesigned for shop owners.
 * Three tabs:
 *   Quick Add  — Q&A cards (products, prices, FAQs) — MOST COMMON for shops
 *   Links      — Paste a URL to learn from
 *   Documents  — Upload files
 *
 * Knowledge base list at the bottom with delete.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const QUICK_TEMPLATES = {
  electronics:  [
    { q: 'iPhone 15 price',         a: 'iPhone 15 128GB — 135,000 ብር. 256GB — 155,000 ብር. ቀለም: Black, White, Blue.' },
    { q: 'Do you have warranty?',   a: 'Yes — 1 year warranty on all phones. We replace or repair free.' },
    { q: 'Delivery?',               a: 'Addis Ababa delivery 50 ብር — same day if ordered before 2pm.' },
  ],
  clothing:     [
    { q: 'Size guide',              a: 'S=36-38, M=38-40, L=40-42, XL=42-44. We exchange sizes free within 3 days.' },
    { q: 'Do you deliver?',         a: 'Yes — Addis Ababa 60 ብር, same day.' },
    { q: 'Payment methods',         a: 'Telebirr, CBE Birr, bank transfer, or cash on delivery.' },
  ],
  food:         [
    { q: "Today's special",         a: 'Today: Tibs 200 ብር, Doro Wot 250 ብር. Free delivery above 500 ብር.' },
    { q: 'Delivery hours',          a: 'Delivery: 11am – 9pm daily. Order via Telegram or call.' },
    { q: 'Minimum order',           a: 'Minimum 150 ብር for delivery. Free delivery above 500 ብር.' },
  ],
  beauty:       [
    { q: 'Hair services price list', a: 'Cut 150ብ, Wash&Set 200ብ, Braids from 300ብ, Relaxer 250ብ. Book 24h ahead.' },
    { q: 'Booking',                 a: 'Book via Telegram or call. Appointments only — no walk-ins.' },
    { q: 'Location',                a: 'Bole, near Edna Mall. Landmark: blue building next to the pharmacy.' },
  ],
  onlineshop:   [
    { q: 'How do I order?',         a: 'Send item name + quantity here. We confirm price + shipping, you pay, we ship.' },
    { q: 'Shipping time',           a: 'Addis: 1-2 days. Other cities: 3-5 days via courier.' },
    { q: 'Return policy',           a: '3-day return on unopened items. Send photo of damage for free replacement.' },
  ],
  services:     [
    { q: 'What services do you offer?', a: 'Logo design 2,500ብ, Full brand identity 8,000ብ, Social media 3,000ብ/month.' },
    { q: 'Turnaround time',         a: 'Logo: 3-5 days. Website: 2-3 weeks. Rush available +30%.' },
    { q: 'How to start?',           a: 'Send your brief or project idea here. We quote within 2 hours.' },
  ],
  homegifts:    [
    { q: 'Custom gifts available?', a: 'Yes — personalized photo gifts, engraving, custom packaging from 150ብ.' },
    { q: 'Delivery',                a: 'Addis 1-2 days. Gift wrapping free. Other cities 3-5 days.' },
    { q: 'Bulk orders',             a: 'Corporate & bulk orders welcome — 15% discount for 10+ pieces.' },
  ],
  other:        [
    { q: 'What do you offer?',      a: 'Write your main services or products here…' },
    { q: 'Pricing',                 a: 'Describe your pricing structure…' },
    { q: 'How to contact?',         a: 'Telegram preferred. Response within 30 minutes during business hours.' },
  ],
};

export default function TeachPage() {
  const router = useRouter();
  const { initData, business } = useTelegram() || {};
  const [tab, setTab] = useState('quick'); // 'quick' | 'links' | 'docs'
  const [data, setData] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [qaItems, setQaItems] = useState([{ q: '', a: '', id: Date.now() }]);
  const [savedCount, setSavedCount] = useState(0);

  const category = business?.category || 'other';
  const templates = QUICK_TEMPLATES[category] || QUICK_TEMPLATES.other;

  const load = useCallback(async () => {
    if (!initData) return;
    const r = await fetch('/api/agent/knowledge', {
      headers: { 'x-telegram-init-data': initData },
      cache: 'no-store',
    });
    const j = await r.json();
    setData(j);
  }, [initData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  // Load template
  function loadTemplate() {
    setQaItems(templates.map(t => ({ q: t.q, a: t.a, id: Math.random() })));
  }

  // Save one Q&A item
  async function saveQa(item) {
    if (!item.q.trim() || !item.a.trim()) return;
    setBusy(`qa-${item.id}`); setErr('');
    try {
      const r = await fetch('/api/agent/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ title: item.q.trim(), body: item.a.trim(), source: 'manual' }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'failed');
      setSavedCount(n => n + 1);
      setQaItems(prev => prev.filter(i => i.id !== item.id));
      if (qaItems.length <= 1) setQaItems([{ q: '', a: '', id: Date.now() }]);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  // Save all Q&A items at once
  async function saveAll() {
    const valid = qaItems.filter(i => i.q.trim() && i.a.trim());
    if (!valid.length) return;
    setBusy('all'); setErr('');
    try {
      await Promise.all(valid.map(item =>
        fetch('/api/agent/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ title: item.q.trim(), body: item.a.trim(), source: 'manual' }),
        })
      ));
      setSavedCount(n => n + valid.length);
      setQaItems([{ q: '', a: '', id: Date.now() }]);
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  async function learnUrl(u, tag = 'url') {
    if (!u) return;
    setBusy(u); setErr('');
    try {
      const r = await fetch('/api/agent/knowledge/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ url: u, tag }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'failed');
      setUrl('');
      await load();
    } catch (e) { setErr(e.message || 'failed'); } finally { setBusy(''); }
  }

  async function uploadFile(file) {
    if (!file) return;
    setBusy('upload'); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('tag', 'doc');
      const r = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'upload failed'); }
      await load();
    } catch (e) { setErr(e.message || 'failed'); } finally { setBusy(''); }
  }

  async function removeSource(id) {
    if (!confirm('Remove this from the knowledge base?')) return;
    await fetch(`/api/agent/knowledge?id=${id}`, {
      method: 'DELETE', headers: { 'x-telegram-init-data': initData },
    });
    await load();
  }

  const { sources = [], socials = {} } = data || {};
  const socialEntries = Object.entries(socials).filter(([, v]) => v);
  const ingestedUrls = new Set(sources.filter(s => s.url).map(s => s.url));
  const validCount = qaItems.filter(i => i.q.trim() && i.a.trim()).length;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: COLORS.textPrimary, letterSpacing: '-0.01em' }}>
          Teach MiniMe
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 4 }}>
          Add your products, prices & FAQs — MiniMe will know exactly what to say
        </p>
        {sources.length > 0 && (
          <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.green, background: COLORS.greenLight, padding: '4px 10px', borderRadius: 999 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.green }} />
            {sources.length} item{sources.length !== 1 ? 's' : ''} in knowledge base
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        {[
          ['quick', '⚡ Quick Add'],
          ['links', '🔗 Links'],
          ['docs',  '📄 Documents'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, appearance: 'none', border: 'none', background: 'transparent',
            padding: '12px 8px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            color: tab === k ? COLORS.teal : COLORS.textSecondary,
            borderBottom: tab === k ? `2px solid ${COLORS.teal}` : '2px solid transparent',
            fontFamily: FONT.body,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* ── Quick Add Tab ── */}
        {tab === 'quick' && (
          <>
            {/* Template loader */}
            {qaItems[0]?.q === '' && (
              <button onClick={loadTemplate} style={{
                width: '100%', appearance: 'none', border: `1px dashed ${COLORS.teal}`,
                background: COLORS.tealLight, borderRadius: RADII.lg, padding: '12px 16px',
                fontSize: 14, color: COLORS.teal, cursor: 'pointer', fontFamily: FONT.body,
                fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                ✨ Load {category} templates →
              </button>
            )}

            <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 12, lineHeight: 1.5 }}>
              Add one Q&A per card. MiniMe will use these to answer clients instantly.
            </div>

            {/* Q&A cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {qaItems.map((item, idx) => (
                <div key={item.id} style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em' }}>
                      QUESTION {idx + 1}
                    </span>
                    {qaItems.length > 1 && (
                      <button onClick={() => setQaItems(prev => prev.filter(i => i.id !== item.id))} style={{
                        appearance: 'none', border: 'none', background: 'transparent',
                        fontSize: 18, color: COLORS.textHint, cursor: 'pointer', lineHeight: 1,
                      }}>×</button>
                    )}
                  </div>
                  <input
                    value={item.q}
                    onChange={e => setQaItems(prev => prev.map(i => i.id === item.id ? { ...i, q: e.target.value } : i))}
                    placeholder='e.g. "What is the price of iPhone 15?"'
                    style={{
                      width: '100%', border: `1px solid ${COLORS.border}`, background: COLORS.bg,
                      borderRadius: RADII.sm, padding: '10px 12px', fontSize: 14, fontFamily: FONT.body,
                      color: COLORS.textPrimary, outline: 'none', boxSizing: 'border-box',
                      marginBottom: 8,
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                    onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
                  />
                  <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', marginBottom: 6 }}>
                    MINIME'S ANSWER
                  </div>
                  <textarea
                    value={item.a}
                    onChange={e => setQaItems(prev => prev.map(i => i.id === item.id ? { ...i, a: e.target.value } : i))}
                    placeholder='e.g. "iPhone 15 128GB — 135,000 ብር. Available in Black, Blue, White."'
                    rows={3}
                    style={{
                      width: '100%', border: `1px solid ${COLORS.border}`, background: COLORS.bg,
                      borderRadius: RADII.sm, padding: '10px 12px', fontSize: 14, fontFamily: FONT.body,
                      color: COLORS.textPrimary, outline: 'none', resize: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                    onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
                  />
                  {/* Individual save */}
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => saveQa(item)}
                      disabled={!item.q.trim() || !item.a.trim() || busy === `qa-${item.id}`}
                      style={{
                        appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body,
                        background: item.q.trim() && item.a.trim() ? COLORS.teal : COLORS.border,
                        color: item.q.trim() && item.a.trim() ? '#FFFFFF' : COLORS.textHint,
                        padding: '8px 16px', borderRadius: RADII.sm, fontSize: 13, fontWeight: 600,
                        transition: 'all 150ms',
                      }}
                    >
                      {busy === `qa-${item.id}` ? 'Saving…' : '✓ Save this'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add another + Save all */}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={() => setQaItems(prev => [...prev, { q: '', a: '', id: Date.now() }])} style={{
                flex: 1, appearance: 'none', border: `1px dashed ${COLORS.border}`,
                background: 'transparent', borderRadius: RADII.lg, padding: '12px',
                fontSize: 14, color: COLORS.teal, cursor: 'pointer', fontFamily: FONT.body, fontWeight: 500,
              }}>+ Add another</button>
              {validCount > 1 && (
                <button onClick={saveAll} disabled={busy === 'all'} style={{
                  flex: 1, appearance: 'none', border: 'none',
                  background: COLORS.teal, color: '#FFFFFF', borderRadius: RADII.lg,
                  padding: '12px', fontSize: 14, cursor: 'pointer', fontFamily: FONT.body, fontWeight: 600,
                }}>
                  {busy === 'all' ? 'Saving…' : `Save all ${validCount}`}
                </button>
              )}
            </div>

            {savedCount > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: COLORS.greenLight, borderRadius: RADII.md, fontSize: 14, color: COLORS.green, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                ✅ {savedCount} item{savedCount > 1 ? 's' : ''} saved — MiniMe is learning!
              </div>
            )}
          </>
        )}

        {/* ── Links Tab ── */}
        {tab === 'links' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>Paste a URL</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 10, lineHeight: 1.5 }}>
                MiniMe will read the page and learn from it — your website, price list, catalogue, Instagram bio, etc.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://yoursite.com/products"
                  style={{
                    flex: 1, border: `1px solid ${COLORS.border}`, background: COLORS.surface,
                    borderRadius: RADII.md, padding: '12px 14px', fontSize: 14, fontFamily: FONT.body,
                    color: COLORS.textPrimary, outline: 'none',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = COLORS.teal}
                  onBlur={e => e.currentTarget.style.borderColor = COLORS.border}
                />
                <button onClick={() => learnUrl(url)} disabled={!url || !!busy} style={{
                  appearance: 'none', border: 'none', background: COLORS.teal, color: '#FFFFFF',
                  borderRadius: RADII.md, padding: '12px 18px', fontSize: 14, fontWeight: 600,
                  cursor: url && !busy ? 'pointer' : 'default', fontFamily: FONT.body,
                  opacity: !url || busy ? 0.6 : 1,
                }}>
                  {busy === url ? 'Reading…' : 'Learn'}
                </button>
              </div>
            </div>

            {/* Social pages */}
            {socialEntries.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>YOUR PAGES</div>
                <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card }}>
                  {socialEntries.map(([k, v], i) => {
                    const ICON = { website: '🌐', portfolio: '🎨', instagram: '📸', facebook: '📘', tiktok: '🎵', telegram_channel: '📣' };
                    const LABEL = { website: 'Website', portfolio: 'Portfolio', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', telegram_channel: 'Telegram channel' };
                    const u = v?.startsWith('http') ? v : `https://${v}`;
                    const ingested = ingestedUrls.has(u);
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
                        <span style={{ fontSize: 20 }}>{ICON[k]}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{LABEL[k]}</div>
                          <div style={{ fontSize: 11, color: COLORS.textHint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
                        </div>
                        <button onClick={() => learnUrl(u, k)} disabled={!!busy} style={{
                          appearance: 'none', border: `1px solid ${ingested ? COLORS.border : COLORS.teal}`,
                          background: ingested ? 'transparent' : COLORS.tealLight,
                          color: ingested ? COLORS.textHint : COLORS.teal,
                          borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 600,
                          cursor: busy ? 'default' : 'pointer', fontFamily: FONT.body,
                          flexShrink: 0,
                        }}>
                          {busy === u ? '…' : ingested ? 'Re-read' : 'Learn'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Documents Tab ── */}
        {tab === 'docs' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>Upload a document</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
                Price lists, catalogues, menus, brochures — MiniMe reads and remembers everything.
              </div>
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                border: `2px dashed ${COLORS.border}`, borderRadius: RADII.lg, padding: '28px 20px',
                cursor: 'pointer', background: COLORS.surface, textAlign: 'center',
                transition: 'border-color 150ms',
              }}
              onMouseOver={e => e.currentTarget.style.borderColor = COLORS.teal}
              onMouseOut={e => e.currentTarget.style.borderColor = COLORS.border}>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.xlsx,.csv"
                  onChange={e => uploadFile(e.target.files?.[0])}
                  disabled={busy === 'upload'}
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: 36, marginBottom: 10 }}>
                  {busy === 'upload' ? '⏳' : '📁'}
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: busy === 'upload' ? COLORS.textHint : COLORS.teal }}>
                  {busy === 'upload' ? 'Uploading…' : 'Tap to upload'}
                </span>
                <span style={{ fontSize: 12, color: COLORS.textHint, marginTop: 6 }}>
                  PDF, Word, Excel, text, images — up to 10 MB
                </span>
              </label>
            </div>
          </>
        )}

        {/* Error */}
        {err && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: RADII.md, fontSize: 13, color: COLORS.red }}>
            {err}
          </div>
        )}

        {/* Knowledge base list */}
        {sources.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>
              KNOWLEDGE BASE ({sources.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sources.map(s => (
                <div key={s.id} style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.lg, padding: '12px 14px', boxShadow: SHADOW.card,
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                }}>
                  <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>
                    {s.tag === 'auto-learned' ? '🧠' : s.tag === 'onboarding' || s.tag === 'faq' ? '💡' : s.kind === 'url' ? '🔗' : '📄'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                      {s.url || s.filename || (s.tag === 'auto-learned' ? 'Auto-learned from conversations' : 'Q&A')}
                      {s.chunks > 0 && ` · ${s.chunks} chunk${s.chunks > 1 ? 's' : ''}`}
                      {s.status !== 'ready' && ` · ${s.status}…`}
                    </div>
                  </div>
                  {s.tag === 'auto-learned' ? (
                    <span style={{ fontSize: 11, padding: '3px 8px', background: '#F3F0FF', color: '#7C3AED', borderRadius: 999, fontWeight: 500, flexShrink: 0 }}>auto</span>
                  ) : (
                    <button onClick={() => removeSource(s.id)} style={{
                      appearance: 'none', border: 'none', background: 'transparent',
                      fontSize: 12, color: COLORS.textHint, cursor: 'pointer', flexShrink: 0,
                      fontFamily: FONT.body, padding: '2px 4px',
                    }}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!data && <TeachSkeleton />}
      </div>
    </div>
  );
}

function TeachSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'pulse 1.5s infinite' }}>
      {[180, 180, 140].map((h, i) => (
        <div key={i} style={{ height: h, background: COLORS.border, borderRadius: RADII.lg, opacity: 1 - i * 0.15 }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}
