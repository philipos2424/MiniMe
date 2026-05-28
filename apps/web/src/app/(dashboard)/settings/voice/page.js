'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '8px 12px',
  fontSize: 14,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const TONES = [
  { id: 'warm',                  label: 'Warm',         sub: 'Friendly, emoji-light, feels like a human', emoji: '🌿' },
  { id: 'professional_friendly', label: 'Professional', sub: 'Polished but approachable — the default',   emoji: '🤝' },
  { id: 'direct',                label: 'Direct',       sub: 'Short, factual, no fluff',                  emoji: '⚡' },
];

const LANGS = [
  { id: 'mixed',   langs: ['am', 'en'], label: 'Mixed',   sub: 'Amharic + English (recommended)', badge: 'አማ+EN' },
  { id: 'amharic', langs: ['am'],       label: 'Amharic', sub: 'Replies in Amharic only',          badge: 'አማርኛ' },
  { id: 'english', langs: ['en'],       label: 'English', sub: 'Replies in English only',          badge: 'EN' },
];

function langMode(languages) {
  if (!languages?.length) return 'mixed';
  const has_am = languages.includes('am');
  const has_en = languages.includes('en');
  if (has_am && has_en) return 'mixed';
  if (has_am) return 'amharic';
  return 'english';
}

export default function VoicePage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();

  const [samples, setSamples]     = useState(ctxBusiness?.sample_replies || []);
  const [newSample, setNewSample] = useState('');
  const [tone, setToneState]      = useState(ctxBusiness?.tone || 'professional_friendly');
  const [lang, setLangState]      = useState(langMode(ctxBusiness?.languages));
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  // Sync when context loads
  useEffect(() => {
    if (ctxBusiness?.sample_replies) setSamples(ctxBusiness.sample_replies);
    if (ctxBusiness?.tone)           setToneState(ctxBusiness.tone);
    if (ctxBusiness?.languages)      setLangState(langMode(ctxBusiness.languages));
  }, [ctxBusiness?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveToneLang(newTone, newLang) {
    if (!ctxBusiness?.id) return;
    const langEntry = LANGS.find(l => l.id === newLang);
    const updates = { tone: newTone, languages: langEntry?.langs || ['am', 'en'] };
    setSaving(true);
    await supabase.from('businesses').update(updates).eq('id', ctxBusiness.id);
    setBusiness(b => ({ ...b, ...updates }));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleTone(id) {
    setToneState(id);
    saveToneLang(id, lang);
  }

  function handleLang(id) {
    setLangState(id);
    saveToneLang(tone, id);
  }

  async function addSample() {
    if (!newSample.trim() || !ctxBusiness?.id) return;
    const updated = [...samples, newSample.trim()];
    setSamples(updated);
    setNewSample('');
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', ctxBusiness.id);
    setBusiness(b => ({ ...b, sample_replies: updated }));
  }

  async function removeSample(i) {
    if (!ctxBusiness?.id) return;
    const updated = samples.filter((_, idx) => idx !== i);
    setSamples(updated);
    await supabase.from('businesses').update({ sample_replies: updated }).eq('id', ctxBusiness.id);
    setBusiness(b => ({ ...b, sample_replies: updated }));
  }

  const profile = ctxBusiness?.voice_embedding || {};

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 40 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Voice & Style</h1>

      {/* ── Language ── */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Language
        </h2>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          Which language should MiniMe reply in?
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {LANGS.map(l => {
            const active = lang === l.id;
            return (
              <button key={l.id} onClick={() => handleLang(l.id)} style={{
                padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
                border: `1.5px solid ${active ? COLORS.ink : COLORS.border}`,
                background: active ? COLORS.ink : COLORS.bg,
                fontFamily: FONT.body, textAlign: 'center', transition: 'all .15s ease',
              }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: active ? '#fff' : COLORS.textPrimary, fontFamily: l.id === 'amharic' ? "'Noto Sans Ethiopic', sans-serif" : FONT.body }}>
                  {l.badge}
                </div>
                <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.65)' : COLORS.textHint, marginTop: 3 }}>
                  {l.label}
                </div>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: COLORS.textHint, margin: '8px 0 0', lineHeight: 1.45 }}>
          {LANGS.find(l => l.id === lang)?.sub}
        </p>
      </div>

      {/* ── Tone ── */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Tone
        </h2>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          How should MiniMe sound to your customers?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TONES.map(t => {
            const active = tone === t.id;
            return (
              <button key={t.id} onClick={() => handleTone(t.id)} style={{
                padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${active ? COLORS.ink : COLORS.border}`,
                background: active ? COLORS.ink : COLORS.bg,
                fontFamily: FONT.body, transition: 'all .15s ease',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{t.emoji}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: active ? '#fff' : COLORS.textPrimary }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.65)' : COLORS.textHint, marginTop: 2 }}>
                    {t.sub}
                  </div>
                </div>
                {active && (
                  <div style={{ marginLeft: 'auto', fontSize: 13, color: COLORS.teal, fontWeight: 600 }}>
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {(saving || saved) && (
          <p style={{ fontSize: 11, color: saved ? COLORS.teal : COLORS.textHint, margin: '10px 0 0', textAlign: 'right' }}>
            {saved ? '✓ Saved' : 'Saving…'}
          </p>
        )}
      </div>

      {/* ── AI Voice Profile (read-only) ── */}
      {Object.keys(profile).length > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            AI Voice Profile
          </h2>
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
            Detected from your sample replies — updates automatically as you add more.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div><span style={{ color: COLORS.textHint }}>Language: </span><span style={{ color: COLORS.textPrimary }}>{profile.language?.primary}</span></div>
            <div><span style={{ color: COLORS.textHint }}>Tone: </span><span style={{ color: COLORS.textPrimary }}>Formality {profile.tone?.formality}/5</span></div>
            <div><span style={{ color: COLORS.textHint }}>Greeting: </span><span style={{ color: COLORS.textPrimary }}>{profile.greeting?.opener}</span></div>
            <div><span style={{ color: COLORS.textHint }}>Emojis: </span><span style={{ color: COLORS.textPrimary }}>{profile.tone?.emojiUsage}</span></div>
          </div>
          {profile.uniquePhrases?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 12, color: COLORS.textHint }}>Signature phrases: </span>
              {profile.uniquePhrases.map(p => (
                <span key={p} style={{ fontSize: 11, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: '1px 6px', marginRight: 4 }}>
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Training samples ── */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Sample Replies ({samples.length})
        </h2>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          Add examples of how you reply to customers. The more you add, the better MiniMe sounds like you.
        </p>

        <div style={{ maxHeight: 256, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {samples.length === 0
            ? <p style={{ fontSize: 13, color: COLORS.textHint, textAlign: 'center', padding: '16px 0' }}>No samples yet</p>
            : samples.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: COLORS.bg, borderRadius: RADII.sm, padding: '8px 10px' }}>
                  <p style={{ flex: 1, fontSize: 13, color: COLORS.textPrimary, margin: 0 }}>{s}</p>
                  <button
                    onClick={() => removeSample(i)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textHint, fontSize: 12, flexShrink: 0, padding: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = COLORS.red}
                    onMouseLeave={e => e.currentTarget.style.color = COLORS.textHint}
                  >
                    ✕
                  </button>
                </div>
              ))
          }
        </div>

        {/* Quick-add templates */}
        {samples.length < 5 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Quick add (tap to fill)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                'Selam! Yes we have it in stock 🌿 Want me to hold one for you?',
                'Sure! Which size and color are you looking for?',
                'ሰላም! ምርቱ አለን። ለእርስዎ ማስቀመጥ እችላለሁ?',
                'Yes we deliver! What area are you in and when do you need it?',
                'Of course! Let me check availability and get back to you shortly 🙏',
                'Payment via Chapa or CBE — which works for you?',
              ].filter(t => !samples.includes(t)).slice(0, 4).map(t => (
                <button key={t} onClick={() => setNewSample(t)} style={{
                  fontSize: 11.5, padding: '5px 10px', borderRadius: 999,
                  border: `1px solid ${COLORS.border}`, background: COLORS.bg,
                  cursor: 'pointer', fontFamily: FONT.body, color: COLORS.textSecondary,
                  textAlign: 'left', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={newSample}
            onChange={e => setNewSample(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addSample(); } }}
            placeholder='e.g. "ሰላም! እንኳን ደህና መጡ! How can I help you today? 😊"'
            rows={2}
            style={{ ...INPUT_BASE, flex: 1, resize: 'none' }}
          />
          <button
            onClick={addSample}
            disabled={!newSample.trim()}
            style={{
              background: newSample.trim() ? COLORS.teal : COLORS.textHint,
              color: '#FFF', fontWeight: 600,
              padding: '8px 16px', borderRadius: RADII.md,
              border: 'none', cursor: newSample.trim() ? 'pointer' : 'default',
              alignSelf: 'flex-end', fontFamily: FONT.body, fontSize: 13,
              transition: 'background 0.15s',
            }}
          >
            Add
          </button>
        </div>

        <p style={{ fontSize: 11, color: COLORS.textHint, margin: '8px 0 0', lineHeight: 1.5 }}>
          Tip: Add 5+ samples for the best results. More variety = better voice matching.
          {samples.length < 5 && ` You have ${samples.length}/5 minimum samples.`}
        </p>
      </div>
    </div>
  );
}
