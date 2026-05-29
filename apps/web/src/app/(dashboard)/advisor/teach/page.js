'use client';
/**
 * Teach MiniMe — owner pours raw knowledge in. Three input modes:
 *   1. Describe — owner types a paragraph about their business
 *   2. Links    — owner pastes URLs
 *   3. Forward  — owner pastes example client messages they got
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const PROMPTS = [
  "I'm a graphic designer in Addis. I do logos, brochures, and social media posts. Typical price 3,000–15,000 ETB depending on scope. Most clients are small shops, NGOs, and startups. I deliver in 3–5 days, faster on rush.",
  "I run a wedding photography business. Full-day coverage 25,000–60,000 ETB. I work with assistants and edit in Lightroom. Turnaround 2 weeks. I post samples on Instagram every Friday.",
  "We're a print shop. Business cards 500–2,000 ETB per box, brochures 50 ETB each min 100. We print same-day if file is ready by noon.",
];

const INPUT_BASE = {
  width: '100%', background: COLORS.surface, border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.lg, padding: '10px 12px', fontSize: 14, color: COLORS.textPrimary,
  fontFamily: FONT.body, outline: 'none', resize: 'none', boxSizing: 'border-box',
};

export default function TeachPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [tab, setTab] = useState('describe');
  const [description, setDescription] = useState('');
  const [urls, setUrls] = useState('');
  const [snippets, setSnippets] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/advisor');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function submit() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const body = {};
      if (description.trim()) body.description = description.trim();
      if (urls.trim()) body.urls = urls.split(/\s+|\n+/).map(s => s.trim()).filter(Boolean);
      if (snippets.trim()) body.forwardedSnippets = snippets.split(/\n{2,}|---+/).map(s => s.trim()).filter(Boolean);
      if (!Object.keys(body).length) { setErr('Add a description, a URL, or a snippet first.'); setBusy(false); return; }

      const r = await fetch('/api/teach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setResult(j.result);
      setDescription(''); setUrls(''); setSnippets('');
    } catch (e) {
      setErr(e.message || 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 100, fontFamily: FONT.body }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>Teach MiniMe</h1>
        <p style={{ color: COLORS.textHint, fontSize: 13, marginTop: 4 }}>
          Pour in what you know. MiniMe extracts the facts and remembers them.
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 4 }}>
        {[
          ['describe', 'Describe'],
          ['links', 'Links'],
          ['forward', 'Forward'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1, fontSize: 13, fontWeight: 500, borderRadius: RADII.md,
              padding: '8px 12px', border: 'none', cursor: 'pointer', fontFamily: FONT.body,
              background: tab === k ? COLORS.teal : 'transparent',
              color: tab === k ? '#FFF' : COLORS.textHint,
              transition: 'background 0.15s, color 0.15s',
            }}
          >{label}</button>
        ))}
      </div>

      {tab === 'describe' && (
        <section>
          <p style={{ color: COLORS.textHint, fontSize: 13, marginBottom: 8, padding: '0 4px' }}>
            Tell MiniMe about your business in plain language. What you sell, your prices, who your clients are, your style.
          </p>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={PROMPTS[0]}
            rows={9}
            style={INPUT_BASE}
          />
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PROMPTS.map((p, i) => (
              <button key={i} onClick={() => setDescription(p)} style={{ fontSize: 12, color: COLORS.textHint, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body, textDecoration: 'underline', textUnderlineOffset: 2 }}>
                Example {i + 1}
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'links' && (
        <section>
          <p style={{ color: COLORS.textHint, fontSize: 13, marginBottom: 8, padding: '0 4px' }}>
            Paste any URLs MiniMe should learn from — one per line.
          </p>
          <textarea
            value={urls}
            onChange={e => setUrls(e.target.value)}
            placeholder={"https://yoursite.com\nhttps://yoursite.com/portfolio\nhttps://yoursite.com/about"}
            rows={6}
            style={{ ...INPUT_BASE, fontFamily: 'monospace' }}
          />
        </section>
      )}

      {tab === 'forward' && (
        <section>
          <p style={{ color: COLORS.textHint, fontSize: 13, marginBottom: 8, padding: '0 4px' }}>
            Paste real messages from your clients. MiniMe extracts names, preferences, mood — separate with a blank line or <code>---</code>.
          </p>
          <textarea
            value={snippets}
            onChange={e => setSnippets(e.target.value)}
            placeholder={`Sara: I love what you did for us! The cards came out perfect. Can we do banners next?\n\n---\n\nDavid: Hey, still waiting on that quote for our event. We need 200 invites by April 30th, budget around 8,000 ETB.`}
            rows={8}
            style={INPUT_BASE}
          />
          <p style={{ color: COLORS.textHint, fontSize: 11, marginTop: 8, padding: '0 4px' }}>
            Tip: in Telegram you can also forward client messages directly to your bot — MiniMe learns from them automatically.
          </p>
        </section>
      )}

      {err && (
        <div style={{ marginTop: 12, border: `1px solid ${COLORS.red}40`, background: COLORS.redLight, borderRadius: RADII.lg, padding: 12, fontSize: 13, color: COLORS.red }}>{err}</div>
      )}

      <button
        onClick={submit}
        disabled={busy}
        style={{
          marginTop: 16, width: '100%', fontSize: 14, fontWeight: 600,
          background: COLORS.teal, color: '#FFF', borderRadius: RADII.lg,
          padding: '12px 0', border: 'none', cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1, fontFamily: FONT.body,
        }}
      >
        {busy ? 'Teaching MiniMe…' : 'Teach MiniMe'}
      </button>

      {result && <ResultBlock result={result} />}
    </div>
  );
}

function ResultBlock({ result }) {
  return (
    <div style={{ marginTop: 20, border: `1px solid ${COLORS.green}40`, background: COLORS.greenLight, borderRadius: RADII.lg, padding: 16, fontFamily: FONT.body }}>
      <h2 style={{ color: COLORS.green, fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0 }}>✓ Learned</h2>

      {result.description?.ok && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.textHint, marginBottom: 4 }}>From your description</div>
          <ExtractedFacts e={result.description.extracted} />
          {result.description.applied && Object.keys(result.description.applied).length > 0 && (
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4 }}>
              Updated business profile: {Object.keys(result.description.applied).join(', ')}
            </div>
          )}
        </div>
      )}

      {result.urls?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.textHint, marginBottom: 4 }}>From URLs</div>
          <ul style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0, paddingLeft: 16 }}>
            {result.urls.map((u, i) => (
              <li key={i} style={{ color: u.ok ? COLORS.textPrimary : COLORS.red, marginBottom: 2 }}>
                {u.ok ? `✓ ${u.title || u.url} (${u.chunks} chunks)` : `✗ ${u.url} — ${u.error}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.snippets?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: COLORS.textHint, marginBottom: 4 }}>From client snippets</div>
          <ul style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0, paddingLeft: 16 }}>
            {result.snippets.map((s, i) => (
              <li key={i} style={{ color: s.ok ? COLORS.textPrimary : COLORS.red, marginBottom: 2 }}>
                {s.ok ? `✓ ${s.summary || 'saved'}` : `✗ ${s.error}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExtractedFacts({ e }) {
  if (!e?.extracted) return <p style={{ fontSize: 13, color: COLORS.textHint }}>(no structured facts)</p>;
  const ex = e.extracted;
  return (
    <ul style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0, paddingLeft: 16 }}>
      {ex.summary && <li>📝 {ex.summary}</li>}
      {ex.category && <li>🏷️ Category: {ex.category}</li>}
      {ex.services?.length > 0 && <li>🛠️ Services: {ex.services.join(', ')}</li>}
      {ex.specialties?.length > 0 && <li>⭐ Specialties: {ex.specialties.join(', ')}</li>}
      {ex.client_types?.length > 0 && <li>👥 Clients: {ex.client_types.join(', ')}</li>}
      {ex.price_range && (ex.price_range.min || ex.price_range.max) && (
        <li>💰 Pricing: {ex.price_range.min || '?'}–{ex.price_range.max || '?'} {ex.price_range.currency || 'ETB'}</li>
      )}
      {ex.turnaround && <li>⏱️ Turnaround: {ex.turnaround}</li>}
      {ex.tone && <li>🗣️ Tone: {ex.tone}</li>}
    </ul>
  );
}
