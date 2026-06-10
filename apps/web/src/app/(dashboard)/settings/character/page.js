'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
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

// ── Ready-made personalities — one tap to a vibe ──────────────────────────────
// Each preset just fills the SAME fields the auto-detect/manual editor uses, so
// there's no separate code path. Crafted to sound like a real person, not a bot.
// Owners can apply one, then tweak anything before saving.
const PRESETS = [
  {
    id: 'warm', emoji: '🤗', name: 'Warm & friendly',
    blurb: 'Treats everyone like a friend. Welcoming, never pushy.',
    traits: ['warm', 'caring', 'patient'], energy: 'balanced', values: ['relationships', 'quality'],
    description: 'I treat everyone like a friend — warm and welcoming, never pushy.',
  },
  {
    id: 'quick', emoji: '⚡', name: 'Quick & clear',
    blurb: 'Short, sharp answers. Gets you what you need fast.',
    traits: ['direct', 'focused', 'confident'], energy: 'balanced', values: ['speed', 'honesty'],
    description: 'I keep it short and clear — no fluff, I get you what you need fast.',
  },
  {
    id: 'playful', emoji: '😎', name: 'Fun & playful',
    blurb: 'Jokes, slang, good energy. Keeps things light.',
    traits: ['funny', 'playful', 'warm'], energy: 'energetic', values: ['creativity', 'relationships'],
    description: 'I keep things light and fun — a joke here and there, never too serious.',
  },
  {
    id: 'calm', emoji: '🧘', name: 'Calm & patient',
    blurb: 'Relaxed and reassuring. No rush, no pressure.',
    traits: ['patient', 'caring', 'humble'], energy: 'chill', values: ['quality', 'relationships'],
    description: "I take my time with people — no rush, no pressure, I make sure you're comfortable.",
  },
  {
    id: 'expert', emoji: '💪', name: 'Confident expert',
    blurb: 'Knows the products cold. Straight talk, decisive.',
    traits: ['confident', 'direct', 'storyteller'], energy: 'balanced', values: ['quality', 'honesty'],
    description: "I know my products inside out and I'll tell you straight what's best for you.",
  },
  {
    id: 'personal', emoji: '❤️', name: 'Caring & personal',
    blurb: 'Remembers the little things and follows up.',
    traits: ['caring', 'warm', 'storyteller'], energy: 'balanced', values: ['relationships', 'honesty'],
    description: "I remember the little things and check in — you're not just a customer to me.",
  },
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

/* ─── Conversation picker row ─── */
function ConvoRow({ convo, selected, onToggle, wasUsedBefore }) {
  const timeAgo = formatTimeAgo(convo.lastActive);
  return (
    <button
      onClick={() => onToggle(convo.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 12px',
        background: selected ? 'rgba(79,163,138,0.08)' : 'transparent',
        border: `1.5px solid ${selected ? COLORS.teal : COLORS.border}`,
        borderRadius: RADII.md, cursor: 'pointer',
        fontFamily: FONT.body, textAlign: 'left',
        transition: 'all .12s ease',
        marginBottom: 6,
      }}
    >
      {/* Checkbox */}
      <div style={{
        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
        border: `2px solid ${selected ? COLORS.teal : COLORS.border}`,
        background: selected ? COLORS.teal : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .12s ease',
      }}>
        {selected && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>
            {convo.customerName}
          </span>
          {wasUsedBefore && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(176,138,74,0.15)', color: '#B08A4A', fontWeight: 600 }}>
              used before
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: COLORS.textHint, display: 'flex', gap: 8 }}>
          <span>{convo.ownerMessages} of your replies</span>
          <span>·</span>
          <span>{timeAgo}</span>
        </div>
        {convo.preview && (
          <div style={{
            fontSize: 11, color: COLORS.textSecondary, marginTop: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontStyle: 'italic',
          }}>
            "{convo.preview}"
          </div>
        )}
      </div>

      {/* Message quality indicator */}
      <div style={{
        fontSize: 10, fontWeight: 600, color: convo.ownerMessages >= 5 ? COLORS.teal : COLORS.textHint,
        flexShrink: 0,
      }}>
        {convo.ownerMessages >= 5 ? '🟢' : convo.ownerMessages >= 2 ? '🟡' : '⚪'}
      </div>
    </button>
  );
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function CharacterPage() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();

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

  // Conversation picker state
  const [conversations, setConversations] = useState([]);
  const [lastUsed, setLastUsed] = useState([]);
  const [selectedConvos, setSelectedConvos] = useState([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [msgCount, setMsgCount] = useState(null);

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

  // Apply a ready-made personality into the editable fields. Doesn't save —
  // the owner can tweak first, then hit Save (the manual editor opens below).
  function applyPreset(p) {
    setTraits(p.traits.slice(0, 4));
    setEnergy(p.energy);
    setValues(p.values.slice(0, 3));
    // Only fill the description if the owner hasn't written their own yet.
    setDescription(prev => (prev && prev.trim()) ? prev : p.description);
    setShowManual(true);
    setShowPicker(false);
  }

  // A preset is "active" when its traits/energy/values match the current pick.
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const activePreset = PRESETS.find(p =>
    sameSet(p.traits, traits) && p.energy === energy && sameSet(p.values, values)
  )?.id;

  // Load conversations for the picker
  const loadConversations = useCallback(async () => {
    if (loadingConvos || conversations.length) return;
    setLoadingConvos(true);
    try {
      const res = await fetch('/api/settings/character', {
        headers: { 'x-telegram-init-data': initData || '' },
      });
      const data = await res.json();
      setConversations(data.conversations || []);
      setLastUsed(data.lastUsed || []);
      // Pre-select previously used conversations
      if (data.lastUsed?.length) {
        setSelectedConvos(data.lastUsed.filter(id =>
          (data.conversations || []).some(c => c.id === id)
        ));
      }
    } catch {
      // silent
    }
    setLoadingConvos(false);
  }, [initData, loadingConvos, conversations.length]);

  function toggleConvo(id) {
    setSelectedConvos(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  async function autoDetect(useSelected) {
    setDetecting(true);
    setMsgCount(null);
    try {
      const body = useSelected && selectedConvos.length
        ? { conversationIds: selectedConvos }
        : {};
      const res = await fetch('/api/settings/character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
        body: JSON.stringify(body),
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
      setMsgCount(data.messagesAnalyzed || null);
      setBusiness(b => ({
        ...b,
        voice_embedding: { ...(b.voice_embedding || {}), character: c },
      }));
      setShowManual(true);
      setShowPicker(false);
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
    // Preserve source_conversations from auto-detect
    if (existing.source_conversations) character.source_conversations = existing.source_conversations;
    if (existing.detected_at) character.detected_at = existing.detected_at;
    const voiceEmbed = { ...(ctxBusiness.voice_embedding || {}), character };
    try {
      await updateBusiness(initData, { voice_embedding: voiceEmbed });
      setBusiness(b => ({ ...b, voice_embedding: voiceEmbed }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      tgAlert('Could not save — check your connection.');
    } finally {
      setSaving(false);
    }
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
        onClick={() => autoDetect(false)}
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
            Re-detect from all conversations
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>✨</span>
            Detect my personality
          </>
        )}
      </button>

      {/* Choose which chats to learn from */}
      <button
        onClick={() => { setShowPicker(!showPicker); if (!showPicker) loadConversations(); }}
        disabled={detecting}
        style={{
          width: '100%', padding: '12px 16px',
          background: showPicker ? 'rgba(79,163,138,0.08)' : 'transparent',
          color: showPicker ? COLORS.teal : COLORS.textSecondary,
          border: `1.5px solid ${showPicker ? COLORS.teal : COLORS.border}`,
          borderRadius: RADII.lg,
          fontSize: 13, fontWeight: 500, cursor: 'pointer',
          fontFamily: FONT.body, marginBottom: 8,
          transition: 'all .15s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>💬</span>
        {showPicker ? 'Hide chat picker' : 'Or choose which chats to learn from'}
      </button>

      {/* Conversation picker */}
      {showPicker && (
        <div style={{
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.lg, padding: 14, marginBottom: 12,
          boxShadow: SHADOW.card,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.teal, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Pick conversations
            </div>
            {selectedConvos.length > 0 && (
              <span style={{ fontSize: 11, color: COLORS.textHint }}>
                {selectedConvos.length} selected
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
            Pick the chats where you sound most like yourself. Green dots mean more of your replies.
          </p>

          {loadingConvos ? (
            <div style={{ textAlign: 'center', padding: 20, color: COLORS.textHint, fontSize: 13 }}>
              Loading your conversations...
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: COLORS.textHint, fontSize: 13 }}>
              No conversations with your replies yet.
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
                {conversations.map(c => (
                  <ConvoRow
                    key={c.id}
                    convo={c}
                    selected={selectedConvos.includes(c.id)}
                    onToggle={toggleConvo}
                    wasUsedBefore={lastUsed.includes(c.id)}
                  />
                ))}
              </div>

              {/* Select all / clear */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  onClick={() => setSelectedConvos(conversations.map(c => c.id))}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 500,
                    background: 'none', border: `1px solid ${COLORS.border}`,
                    borderRadius: RADII.sm, cursor: 'pointer', color: COLORS.textSecondary,
                    fontFamily: FONT.body,
                  }}
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedConvos([])}
                  style={{
                    flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 500,
                    background: 'none', border: `1px solid ${COLORS.border}`,
                    borderRadius: RADII.sm, cursor: 'pointer', color: COLORS.textSecondary,
                    fontFamily: FONT.body,
                  }}
                >
                  Clear
                </button>
              </div>

              {/* Detect from selected */}
              <button
                onClick={() => autoDetect(true)}
                disabled={detecting || selectedConvos.length === 0}
                style={{
                  width: '100%', padding: '14px 16px',
                  background: selectedConvos.length === 0 ? COLORS.border : COLORS.teal,
                  color: '#fff', border: 'none', borderRadius: RADII.lg,
                  fontSize: 14, fontWeight: 600,
                  cursor: selectedConvos.length === 0 ? 'default' : 'pointer',
                  fontFamily: FONT.body,
                  transition: 'all .15s ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {detecting ? (
                  <>
                    <span style={{ animation: 'spin 1s linear infinite' }}>🔍</span>
                    Analyzing...
                  </>
                ) : (
                  <>
                    ✨ Learn from {selectedConvos.length} selected chat{selectedConvos.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', margin: '0 0 18px' }}>
        {msgCount
          ? `Analyzed ${msgCount} of your real messages`
          : 'Analyzes your real messages to find your style'}
      </p>

      {/* ─── Or pick a ready-made personality ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
        <div style={{ flex: 1, height: 1, background: COLORS.border }} />
        <span style={{ fontSize: 11, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase' }}>or pick a vibe</span>
        <div style={{ flex: 1, height: 1, background: COLORS.border }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
        {PRESETS.map(p => {
          const active = activePreset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              style={{
                textAlign: 'left', cursor: 'pointer', fontFamily: FONT.body,
                background: active ? 'rgba(79,163,138,0.08)' : COLORS.surface,
                border: `1.5px solid ${active ? COLORS.teal : COLORS.border}`,
                borderRadius: RADII.lg, padding: '12px 13px',
                display: 'flex', flexDirection: 'column', gap: 4,
                transition: 'all .15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 17 }}>{p.emoji}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: active ? COLORS.teal : COLORS.textPrimary }}>{p.name}</span>
                {active && <span style={{ marginLeft: 'auto', fontSize: 11, color: COLORS.teal, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.textSecondary, lineHeight: 1.4 }}>{p.blurb}</div>
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', margin: '-12px 0 20px', lineHeight: 1.5 }}>
        Pick one to start — then tweak the traits, energy and your own words below before saving.
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
