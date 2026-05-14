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

export default function VoicePage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();
  const [samples, setSamples] = useState(ctxBusiness?.sample_replies || []);
  const [newSample, setNewSample] = useState('');

  // Sync when context loads
  useEffect(() => {
    if (ctxBusiness?.sample_replies) setSamples(ctxBusiness.sample_replies);
  }, [ctxBusiness?.id]);

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
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Voice & Style</h1>

      {/* Voice profile */}
      {Object.keys(profile).length > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Your Voice Profile
          </h2>
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

      {/* Training samples */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Training Samples ({samples.length})
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
      </div>
    </div>
  );
}
