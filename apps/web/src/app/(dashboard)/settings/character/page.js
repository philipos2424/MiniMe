'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

const TRAITS = [
  { id: 'funny',      emoji: '😄', label: 'Funny' },
  { id: 'warm',       emoji: '🤗', label: 'Warm' },
  { id: 'direct',     emoji: '⚡', label: 'Direct' },
  { id: 'patient',    emoji: '🧘', label: 'Patient' },
  { id: 'playful',    emoji: '😎', label: 'Playful' },
  { id: 'focused',    emoji: '🎯', label: 'Focused' },
  { id: 'humble',     emoji: '🙏', label: 'Humble' },
  { id: 'confident',  emoji: '💪', label: 'Confident' },
  { id: 'storyteller',emoji: '📖', label: 'Storyteller' },
  { id: 'caring',     emoji: '❤️', label: 'Caring' },
];

const ENERGIES = [
  { id: 'chill',      emoji: '🌊', label: 'Chill' },
  { id: 'energetic',  emoji: '⚡', label: 'Energetic' },
  { id: 'balanced',   emoji: '⚖️', label: 'Balanced' },
];

const VALUES = [
  { id: 'quality',       emoji: '🏆', label: 'Quality' },
  { id: 'relationships', emoji: '🤝', label: 'Relationships' },
  { id: 'speed',         emoji: '⏰', label: 'Speed' },
  { id: 'honesty',       emoji: '💯', label: 'Honesty' },
  { id: 'creativity',    emoji: '🎨', label: 'Creativity' },
  { id: 'value',         emoji: '💰', label: 'Value' },
];

function Chip({ item, active, disabled, onTap }) {
  return (
    <button
      onClick={() => !disabled && onTap(item.id)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '7px 12px', borderRadius: 999,
        border: `1.5px solid ${active ? COLORS.teal : COLORS.border}`,
        background: active ? 'rgba(79,163,138,0.1)' : COLORS.surface,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontFamily: FONT.body, fontSize: 13,
        color: active ? COLORS.teal : COLORS.textPrimary,
        fontWeight: active ? 600 : 400,
        transition: 'all .15s ease',
      }}
    >
      <span style={{ fontSize: 15 }}>{item.emoji}</span>
      {item.label}
    </button>
  );
}

export default function CharacterPage() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();
  const supabase = createClient();

  const existing = ctxBusiness?.voice_embedding?.character || {};
  const hasCharacter = !!(existing.traits?.length || existing.description);

  const [traits, setTraits] = useState(existing.traits || []);
  const [energy, setEnergy] = useState(existing.energy || 'balanced');
  const [values, setValues] = useState(existing.values || []);
  const [description, setDescription] = useState(existing.description || '');
  const [backstory, setBackstory] = useState(existing.backstory || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showManual, setShowManual] = useState(hasCharacter);

  useEffect(() => {
    const c = ctxBusiness?.voice_embedding?.character || {};
    if (c.traits?.length) { setTraits(c.traits); setShowManual(true); }
    if (c.energy) setEnergy(c.energy);
    if (c.values?.length) setValues(c.values);
    if (c.description) setDescription(c.description);
    if (c.backstory) setBackstory(c.backstory);
  }, [ctxBusiness?.id]); // eslint-disable-line

  function toggle(list, setList, id, max) {
    setList(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length < max ? [...prev, id] : prev);
  }

  async function autoDetect() {
    setDetecting(true);
    try {
      const res = await fetch('/api/settings/character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
      });
      const data = await res.json();
      if (!res.ok) {
        tgAlert(data.message || 'Could not auto-detect. Try chatting with a few more customers first.');
        setDetecting(false);
        return;
      }
      const c = data.character;
      setTraits(c.traits || []);
      setEnergy(c.energy || 'balanced');
      setValues(c.values || []);
      setDescription(c.description || '');
      // Update context so it persists
      setBusiness(b => ({
        ...b,
        voice_embedding: { ...(b.voice_embedding || {}), character: c },
      }));
      setShowManual(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      tgAlert('Network error — try again.');
    }
    setDetecting(false);
  }

  async function save() {
    if (!ctxBusiness?.id) return;
    setSaving(true);
    const character = { traits, energy, values, description: description.trim(), backstory: backstory.trim() };
    const voiceEmbed = { ...(ctxBusiness.voice_embedding || {}), character };
    const { error } = await supabase.from('businesses').update({ voice_embedding: voiceEmbed }).eq('id', ctxBusiness.id);
    if (error) { setSaving(false); tgAlert('Could not save — check your connection.'); return; }
    setBusiness(b => ({ ...b, voice_embedding: voiceEmbed }));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const ownerName = ctxBusiness?.owner_name?.split(' ')[0] || 'You';
  const hasChanges = JSON.stringify({ traits, energy, values, description: description.trim(), backstory: backstory.trim() })
    !== JSON.stringify({
      traits: existing.traits || [], energy: existing.energy || 'balanced',
      values: existing.values || [], description: existing.description || '',
      backstory: existing.backstory || '',
    });

  const INP = {
    padding: '10px 12px', borderRadius: RADII.md,
    border: `1px solid ${COLORS.border}`, background: COLORS.surface,
    fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
    outline: 'none', width: '100%', boxSizing: 'border-box',
    resize: 'none', lineHeight: 1.5,
  };

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 120 }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Identity</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          MiniMe's Soul
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          {hasCharacter
            ? `Your MiniMe knows who it is. Tweak anything below.`
            : `One tap and your MiniMe learns your personality from your real conversations.`}
        </p>
      </div>

      {/* Auto-detect — hero action */}
      <button
        onClick={autoDetect}
        disabled={detecting}
        style={{
          width: '100%', padding: '18px 16px',
          background: detecting ? COLORS.border : '#0E2823',
          color: '#fff', border: 'none', borderRadius: RADII.lg,
          fontSize: 16, fontWeight: 600, cursor: detecting ? 'default' : 'pointer',
          fontFamily: FONT.body, marginBottom: 8,
          boxShadow: '0 2px 8px rgba(14,40,35,0.2)',
          transition: 'all .15s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        {detecting ? (
          <>
            <span style={{ fontSize: 18, animation: 'spin 1s linear infinite' }}>🔍</span>
            Reading your conversations...
          </>
        ) : hasCharacter ? (
          <>
            <span style={{ fontSize: 18 }}>🔄</span>
            Re-detect from my conversations
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>✨</span>
            Detect my personality
          </>
        )}
      </button>
      <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', margin: '0 0 20px' }}>
        Analyzes your real messages to find your style
      </p>

      {saved && !showManual && (
        <div style={{ textAlign: 'center', padding: 16, color: COLORS.teal, fontSize: 15, fontWeight: 600 }}>
          ✓ Character detected and saved!
        </div>
      )}

      {/* Character preview (dark card) */}
      {traits.length > 0 && (
        <div style={{ background: '#0E2823', borderRadius: RADII.lg, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(79,163,138,0.7)', marginBottom: 10 }}>
            {ownerName}'s MiniMe
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: description ? 10 : 0 }}>
            {traits.map(id => {
              const t = TRAITS.find(x => x.id === id);
              return t ? (
                <span key={id} style={{
                  padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(79,163,138,0.15)', color: '#4FA38A',
                  fontSize: 12, fontWeight: 500,
                }}>
                  {t.emoji} {t.label}
                </span>
              ) : null;
            })}
            {energy !== 'balanced' && (
              <span style={{
                padding: '4px 10px', borderRadius: 999,
                background: 'rgba(176,138,74,0.15)', color: '#B08A4A',
                fontSize: 12, fontWeight: 500,
              }}>
                {ENERGIES.find(e => e.id === energy)?.emoji} {ENERGIES.find(e => e.id === energy)?.label}
              </span>
            )}
            {values.map(id => {
              const v = VALUES.find(x => x.id === id);
              return v ? (
                <span key={id} style={{
                  padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.08)', color: '#E4DED1',
                  fontSize: 12, fontWeight: 500,
                }}>
                  {v.emoji} {v.label}
                </span>
              ) : null;
            })}
          </div>
          {description && (
            <p style={{ fontSize: 13, color: '#E4DED1', margin: 0, fontStyle: 'italic', fontFamily: SERIF, lineHeight: 1.5 }}>
              "{description}"
            </p>
          )}
        </div>
      )}

      {/* Manual edit toggle */}
      {traits.length > 0 && !showManual && (
        <button
          onClick={() => setShowManual(true)}
          style={{
            width: '100%', padding: 12, background: 'none',
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
            fontSize: 13, color: COLORS.textSecondary, cursor: 'pointer',
            fontFamily: FONT.body, marginBottom: 16,
          }}
        >
          ✏️ Edit manually
        </button>
      )}

      {/* Manual sections */}
      {showManual && (
        <>
          {/* Traits */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Personality (up to 4)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TRAITS.map(t => (
                <Chip key={t.id} item={t} active={traits.includes(t.id)}
                  disabled={!traits.includes(t.id) && traits.length >= 4}
                  onTap={id => toggle(traits, setTraits, id, 4)} />
              ))}
            </div>
          </div>

          {/* Energy */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Energy
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {ENERGIES.map(e => (
                <Chip key={e.id} item={e} active={energy === e.id} disabled={false}
                  onTap={id => setEnergy(id)} />
              ))}
            </div>
          </div>

          {/* Values */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Values (up to 3)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {VALUES.map(v => (
                <Chip key={v.id} item={v} active={values.includes(v.id)}
                  disabled={!values.includes(v.id) && values.length >= 3}
                  onTap={id => toggle(values, setValues, id, 3)} />
              ))}
            </div>
          </div>

          {/* Description */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              In your words
            </div>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder={`e.g. "I'm pretty chill, I call everyone 'dear'. Never pushy."`}
              rows={2} maxLength={500} style={INP}
            />
          </div>

          {/* Backstory */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Your story (optional)
            </div>
            <textarea
              value={backstory} onChange={e => setBackstory(e.target.value)}
              placeholder={`e.g. "Started selling bags 3 years ago because I couldn't find good ones in Addis."`}
              rows={2} maxLength={400} style={INP}
            />
          </div>

          {/* Save */}
          {hasChanges && (
            <button
              onClick={save} disabled={saving}
              style={{
                width: '100%', padding: 14,
                background: COLORS.textPrimary, color: '#fff',
                border: 'none', borderRadius: RADII.lg,
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
                fontFamily: FONT.body,
              }}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save changes'}
            </button>
          )}
        </>
      )}

      {!hasCharacter && !traits.length && (
        <div style={{ textAlign: 'center', padding: '30px 20px', color: COLORS.textHint }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🪞</div>
          <div style={{ fontSize: 14, color: COLORS.textSecondary, marginBottom: 6 }}>No personality set yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            Tap "Detect my personality" above — it reads your real messages and figures out your style automatically.
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
