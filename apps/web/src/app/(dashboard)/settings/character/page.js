'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

const TRAITS = [
  { id: 'funny',      emoji: '😄', label: 'Funny',      desc: 'Cracks jokes, keeps it light' },
  { id: 'warm',       emoji: '🤗', label: 'Warm',       desc: 'Makes everyone feel welcome' },
  { id: 'direct',     emoji: '⚡', label: 'Direct',     desc: 'Gets to the point, no fluff' },
  { id: 'patient',    emoji: '🧘', label: 'Patient',    desc: 'Never rushes, always calm' },
  { id: 'playful',    emoji: '😎', label: 'Playful',    desc: 'Teases, uses slang, keeps it fun' },
  { id: 'focused',    emoji: '🎯', label: 'Focused',    desc: 'Business first, minimal small talk' },
  { id: 'humble',     emoji: '🙏', label: 'Humble',     desc: 'Deflects praise, stays grounded' },
  { id: 'confident',  emoji: '💪', label: 'Confident',  desc: 'Knows their stuff and shows it' },
  { id: 'storyteller',emoji: '📖', label: 'Storyteller', desc: 'Explains with stories and examples' },
  { id: 'caring',     emoji: '❤️', label: 'Caring',     desc: 'Checks in, remembers details' },
];

const ENERGIES = [
  { id: 'chill',      emoji: '🌊', label: 'Chill',      desc: 'Relaxed, no rush, easy-going' },
  { id: 'energetic',  emoji: '⚡', label: 'Energetic',  desc: 'Excited, enthusiastic, fast' },
  { id: 'balanced',   emoji: '⚖️', label: 'Balanced',   desc: 'Adapts to the moment' },
];

const VALUES = [
  { id: 'quality',       emoji: '🏆', label: 'Quality',       desc: 'Never compromise' },
  { id: 'relationships', emoji: '🤝', label: 'Relationships', desc: 'Customers are family' },
  { id: 'speed',         emoji: '⏰', label: 'Speed',         desc: 'Reply fast, deliver fast' },
  { id: 'honesty',       emoji: '💯', label: 'Honesty',       desc: "Rather lose a sale than lie" },
  { id: 'creativity',    emoji: '🎨', label: 'Creativity',    desc: 'Love trying new things' },
  { id: 'value',         emoji: '💰', label: 'Value',         desc: 'Best quality, best price' },
];

function ChipGroup({ items, selected, onToggle, max }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(item => {
        const active = selected.includes(item.id);
        const disabled = !active && selected.length >= max;
        return (
          <button
            key={item.id}
            onClick={() => !disabled && onToggle(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 999,
              border: `1.5px solid ${active ? COLORS.teal : COLORS.border}`,
              background: active ? 'rgba(79,163,138,0.1)' : COLORS.surface,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              fontFamily: FONT.body, fontSize: 13,
              color: active ? COLORS.teal : COLORS.textPrimary,
              fontWeight: active ? 600 : 400,
              transition: 'all .15s ease',
            }}
          >
            <span style={{ fontSize: 16 }}>{item.emoji}</span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function buildPreview(character, ownerName) {
  const traits = (character.traits || []).map(id => TRAITS.find(t => t.id === id)?.label).filter(Boolean);
  const energy = ENERGIES.find(e => e.id === character.energy)?.label || 'Balanced';
  const values = (character.values || []).map(id => VALUES.find(v => v.id === id)?.label).filter(Boolean);

  if (!traits.length && !character.description && !character.backstory) {
    return null;
  }

  const parts = [];
  if (traits.length) parts.push(`${ownerName || 'This owner'} is ${traits.join(', ').toLowerCase()}.`);
  if (energy !== 'Balanced') parts.push(`${energy} energy.`);
  if (values.length) parts.push(`Values: ${values.join(' & ').toLowerCase()}.`);
  if (character.description) parts.push(character.description);

  return parts.join(' ');
}

export default function CharacterPage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();

  const existing = ctxBusiness?.voice_embedding?.character || {};
  const [traits, setTraits] = useState(existing.traits || []);
  const [energy, setEnergy] = useState(existing.energy || 'balanced');
  const [values, setValues] = useState(existing.values || []);
  const [description, setDescription] = useState(existing.description || '');
  const [backstory, setBackstory] = useState(existing.backstory || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const c = ctxBusiness?.voice_embedding?.character || {};
    if (c.traits) setTraits(c.traits);
    if (c.energy) setEnergy(c.energy);
    if (c.values) setValues(c.values);
    if (c.description) setDescription(c.description);
    if (c.backstory) setBackstory(c.backstory);
  }, [ctxBusiness?.id]); // eslint-disable-line

  function toggleTrait(id) {
    setTraits(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }
  function toggleValue(id) {
    setValues(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  }

  async function save() {
    if (!ctxBusiness?.id) return;
    setSaving(true);

    const character = {
      traits,
      energy,
      values,
      description: description.trim(),
      backstory: backstory.trim(),
    };

    const voiceEmbed = { ...(ctxBusiness.voice_embedding || {}), character };
    const { error } = await supabase
      .from('businesses')
      .update({ voice_embedding: voiceEmbed })
      .eq('id', ctxBusiness.id);

    if (error) {
      setSaving(false);
      tgAlert('Could not save — check your connection and try again.');
      return;
    }

    setBusiness(b => ({ ...b, voice_embedding: voiceEmbed }));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const ownerName = ctxBusiness?.owner_name?.split(' ')[0] || '';
  const preview = buildPreview({ traits, energy, values, description, backstory }, ownerName);
  const hasChanges = JSON.stringify({ traits, energy, values, description: description.trim(), backstory: backstory.trim() })
    !== JSON.stringify(existing.traits ? existing : { traits: [], energy: 'balanced', values: [], description: '', backstory: '' });

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
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Identity</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          MiniMe's Soul
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          Give your MiniMe a personality. These traits shape how it talks, reacts, and connects with people — making it uniquely yours.
        </p>
      </div>

      {/* Personality Traits */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Personality
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          Pick up to 4 traits that describe you. Your MiniMe will mirror these.
        </p>
        <ChipGroup items={TRAITS} selected={traits} onToggle={toggleTrait} max={4} />
      </div>

      {/* Energy */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Energy
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          What's your vibe when texting?
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {ENERGIES.map(e => {
            const active = energy === e.id;
            return (
              <button
                key={e.id}
                onClick={() => setEnergy(e.id)}
                style={{
                  flex: 1, padding: '12px 8px', borderRadius: RADII.md,
                  border: `1.5px solid ${active ? COLORS.teal : COLORS.border}`,
                  background: active ? 'rgba(79,163,138,0.1)' : COLORS.bg,
                  cursor: 'pointer', fontFamily: FONT.body, textAlign: 'center',
                  transition: 'all .15s ease',
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 4 }}>{e.emoji}</div>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? COLORS.teal : COLORS.textPrimary }}>{e.label}</div>
                <div style={{ fontSize: 10, color: COLORS.textHint, marginTop: 2 }}>{e.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Values */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          What You Stand For
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 12px' }}>
          Pick up to 3. These values come through in how your MiniMe talks.
        </p>
        <ChipGroup items={VALUES} selected={values} onToggle={toggleValue} max={3} />
      </div>

      {/* Description */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          In Your Own Words
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 10px' }}>
          Describe how your MiniMe should feel. Anything goes — the more specific, the more real it sounds.
        </p>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={`e.g. "I'm pretty chill, I call everyone 'dear'. I love when customers come back and I always remember their names. I throw in a joke when things get tense. Never pushy — if they're not sure, I say take your time."`}
          rows={4}
          maxLength={500}
          style={INP}
        />
        <div style={{ fontSize: 10, color: COLORS.textHint, textAlign: 'right', marginTop: 4 }}>
          {description.length}/500
        </div>
      </div>

      {/* Backstory */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
          Your Story
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: '0 0 10px' }}>
          Why did you start this business? What drives you? This gives your MiniMe depth — it might share a bit of your story when it feels right.
        </p>
        <textarea
          value={backstory}
          onChange={e => setBackstory(e.target.value)}
          placeholder={`e.g. "Started selling bags because I couldn't find good quality ones in Addis that weren't overpriced. Now I source directly from artisans in Merkato. I've been doing this for 3 years."`}
          rows={3}
          maxLength={400}
          style={INP}
        />
        <div style={{ fontSize: 10, color: COLORS.textHint, textAlign: 'right', marginTop: 4 }}>
          {backstory.length}/400
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div style={{ background: '#0E2823', borderRadius: RADII.lg, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(79,163,138,0.7)', marginBottom: 8 }}>
            Your MiniMe's character
          </div>
          <p style={{ fontSize: 14, color: '#E4DED1', margin: 0, lineHeight: 1.6, fontFamily: SERIF, fontStyle: 'italic' }}>
            {preview}
          </p>
        </div>
      )}

      {/* Save */}
      <button
        onClick={save}
        disabled={saving || !hasChanges}
        style={{
          width: '100%', padding: '14px',
          background: hasChanges ? COLORS.textPrimary : COLORS.border,
          color: hasChanges ? '#fff' : COLORS.textHint,
          border: 'none', borderRadius: RADII.lg,
          fontSize: 15, fontWeight: 600, cursor: hasChanges ? 'pointer' : 'default',
          fontFamily: FONT.body, transition: 'all .15s ease',
        }}
      >
        {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Character'}
      </button>

      {!traits.length && !description && (
        <p style={{ fontSize: 12, color: COLORS.textHint, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
          Without a character, your MiniMe uses a generic friendly tone. Adding even 2-3 traits makes a noticeable difference.
        </p>
      )}
    </div>
  );
}
