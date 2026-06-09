'use client';
/**
 * /settings/personalize — "Make MiniMe Yours" hub.
 *
 * The discoverability problem: personalization is spread across 8 submenus
 * (character, voice, faq, modes, hours, people, …). Most owners never realise
 * how much MiniMe has actually LEARNED about them — and never refine it.
 *
 * This page surfaces it all in ONE scrollable view:
 *   - What MiniMe sounds like (voice_embedding: tone, opener, phrases, closings)
 *   - Their personality (character / character description)
 *   - Their rules + FAQ counts (owner_instructions) with quick links
 *   - Their people (personal_contacts) with quick link
 *
 * Voice fields are editable INLINE (single source of truth = voice_embedding
 * JSONB on businesses). Everything else links out to its dedicated page,
 * because those flows are already well-built and we don't want to fork them.
 *
 * Auth: via TelegramContext (business + setBusiness already provided).
 * Writes: a single Supabase update on businesses.voice_embedding when the
 * owner taps "Save changes" — no new endpoint needed.
 */
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

export default function PersonalizePage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();
  const biz = ctxBusiness || {};

  // ── Pull current personalization state ──────────────────────────────────
  const voice = biz.voice_embedding || {};
  const instructions = Array.isArray(biz.owner_instructions) ? biz.owner_instructions : [];
  const ruleCount = instructions.filter(r => r.source !== 'faq' && r.rule).length;
  const faqCount  = instructions.filter(r => r.source === 'faq' && r.question && r.answer).length;
  const sampleCount = Array.isArray(biz.sample_replies) ? biz.sample_replies.length : 0;
  const personalContactCount = Array.isArray(biz.notification_prefs?.personal_contacts)
    ? biz.notification_prefs.personal_contacts.length : 0;
  const characterDesc = voice.character?.description
    || (typeof voice.character === 'string' ? voice.character : '')
    || '';
  const traits = Array.isArray(voice.character?.traits) ? voice.character.traits : [];

  // ── Local edit state for the inline voice editor ────────────────────────
  // We hydrate from `voice` on first render. The owner edits; on save we
  // merge back into voice_embedding so we never clobber fields we didn't
  // surface here (e.g. emoji_set, character.backstory, future fields).
  const initialOpener = voice.greeting?.opener || '';
  const initialTone = voice.tone || '';
  const initialPhrases = Array.isArray(voice.uniquePhrases) ? voice.uniquePhrases.join(', ') : '';
  const initialClosings = Array.isArray(voice.closings) ? voice.closings.join(', ') : '';

  const [opener, setOpener] = useState(initialOpener);
  const [tone, setTone] = useState(initialTone);
  const [phrases, setPhrases] = useState(initialPhrases);
  const [closings, setClosings] = useState(initialClosings);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => (
    opener !== initialOpener || tone !== initialTone
    || phrases !== initialPhrases || closings !== initialClosings
  ), [opener, tone, phrases, closings, initialOpener, initialTone, initialPhrases, initialClosings]);

  async function saveVoice() {
    if (!biz.id || saving || !dirty) return;
    setSaving(true);
    // Parse comma-lists. Trim, dedupe (case-insensitive), cap.
    const parseList = (s, max) => {
      const seen = new Set();
      const out = [];
      for (const raw of (s || '').split(',')) {
        const t = raw.trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
        if (out.length >= max) break;
      }
      return out;
    };

    const merged = { ...(biz.voice_embedding || {}) };
    if (tone.trim()) merged.tone = tone.trim().slice(0, 120);
    else delete merged.tone;
    if (opener.trim()) {
      merged.greeting = { ...(merged.greeting || {}), opener: opener.trim().slice(0, 80) };
    } else if (merged.greeting?.opener) {
      merged.greeting = { ...merged.greeting };
      delete merged.greeting.opener;
    }
    const newPhrases = parseList(phrases, 12);
    if (newPhrases.length) merged.uniquePhrases = newPhrases;
    else delete merged.uniquePhrases;
    const newClosings = parseList(closings, 8);
    if (newClosings.length) merged.closings = newClosings;
    else delete merged.closings;

    const { error } = await supabase.from('businesses')
      .update({ voice_embedding: merged }).eq('id', biz.id);
    setSaving(false);
    if (error) {
      tgAlert('Could not save — check your connection and try again.');
      return;
    }
    setBusiness(b => ({ ...b, voice_embedding: merged }));
    tgAlert('Saved.');
  }

  const card = {
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    borderRadius: RADII.lg, padding: 18, marginBottom: 14,
  };

  return (
    <div style={{ maxWidth: 580, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 40 }}>
      <h1 style={{
        fontSize: 26, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em',
        fontFamily: SERIF,
      }}>
        Make MiniMe <span style={{ fontStyle: 'italic' }}>yours</span>.
      </h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 22px', lineHeight: 1.55 }}>
        Everything MiniMe has learned about you, in one place. Edit anything inline — your changes are
        live the moment you save.
      </p>

      {/* ── Your voice ──────────────────────────────────────────────────── */}
      <div style={card}>
        <SectionHeader title="Your voice" emoji="🗣" />
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '6px 0 14px', lineHeight: 1.5 }}>
          How MiniMe sounds when replying for you. Captured during signup and refined as you use it.
          Edit anything below — the changes ship immediately.
        </p>

        <Field label="Tone in one line">
          <input
            value={tone}
            onChange={e => setTone(e.target.value)}
            placeholder="e.g. warm, casual, mixes Amharic"
            maxLength={120}
            style={inputStyle}
          />
        </Field>

        <Field label="How you typically greet customers">
          <input
            value={opener}
            onChange={e => setOpener(e.target.value)}
            placeholder="e.g. selam, welcome"
            maxLength={80}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Your signature phrases"
          hint="Comma-separated. Up to 12. MiniMe will sprinkle these into replies."
        >
          <input
            value={phrases}
            onChange={e => setPhrases(e.target.value)}
            placeholder="for sure, no worries, sounds good"
            style={inputStyle}
          />
        </Field>

        <Field
          label="Your typical sign-offs"
          hint="Comma-separated. Up to 8."
        >
          <input
            value={closings}
            onChange={e => setClosings(e.target.value)}
            placeholder="thanks, much love, ciao"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button
            onClick={saveVoice}
            disabled={!dirty || saving}
            style={{
              appearance: 'none', border: 0, borderRadius: 999,
              padding: '11px 22px', fontSize: 13, fontWeight: 600, fontFamily: FONT.body,
              background: dirty ? COLORS.ink : 'rgba(138,149,144,0.18)',
              color: dirty ? COLORS.paper : COLORS.textHint,
              cursor: dirty && !saving ? 'pointer' : 'default',
              opacity: saving ? 0.65 : 1,
            }}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* ── Your personality ────────────────────────────────────────────── */}
      <LinkSection
        title="Your personality"
        emoji="✨"
        summary={characterDesc
          ? characterDesc.slice(0, 140) + (characterDesc.length > 140 ? '…' : '')
          : (traits.length ? traits.map(t => t[0].toUpperCase() + t.slice(1)).join(' · ') : null)}
        emptyHint="Not set yet — describe your traits, values, and energy so MiniMe matches your soul."
        ctaHref="/settings/character"
        ctaLabel={characterDesc || traits.length ? 'Refine' : 'Set up'}
      />

      {/* ── Your sample replies (voice training data) ───────────────────── */}
      <LinkSection
        title="Your sample replies"
        emoji="💬"
        summary={sampleCount > 0
          ? `${sampleCount} real reply${sampleCount === 1 ? '' : 'es'} saved as voice reference.`
          : null}
        emptyHint="Paste 10–20 real messages you've sent customers. MiniMe will mirror your style."
        ctaHref="/settings/voice"
        ctaLabel={sampleCount > 0 ? 'Manage' : 'Add samples'}
      />

      {/* ── Your rules ──────────────────────────────────────────────────── */}
      <LinkSection
        title="Your rules"
        emoji="📐"
        summary={ruleCount > 0
          ? `${ruleCount} active rule${ruleCount === 1 ? '' : 's'} shaping every reply.`
          : null}
        emptyHint="Set behavior rules like “always confirm address before order”. MiniMe follows them on every turn."
        ctaHref="/advisor"
        ctaLabel={ruleCount > 0 ? 'Manage' : 'Add rules'}
      />

      {/* ── Your FAQ ────────────────────────────────────────────────────── */}
      <LinkSection
        title="Your FAQ"
        emoji="💡"
        summary={faqCount > 0
          ? `${faqCount} exact answer${faqCount === 1 ? '' : 's'} taught — MiniMe quotes them verbatim.`
          : null}
        emptyHint="Teach exact answers to common questions (delivery zones, return policy, hours). Faster + always accurate."
        ctaHref="/settings/faq"
        ctaLabel={faqCount > 0 ? 'Manage' : 'Add FAQ'}
      />

      {/* ── Your people ─────────────────────────────────────────────────── */}
      <LinkSection
        title="People you know"
        emoji="💛"
        summary={personalContactCount > 0
          ? `${personalContactCount} family / friend contact${personalContactCount === 1 ? '' : 's'} mapped — secretary won't pitch them.`
          : null}
        emptyHint="Tell MiniMe which of your contacts are family vs friends so it never tries to sell to mom."
        ctaHref="/settings/people"
        ctaLabel={personalContactCount > 0 ? 'Manage' : 'Set up'}
      />

      {/* ── Footer hint ─────────────────────────────────────────────────── */}
      <div style={{
        ...card,
        background: COLORS.cream, border: `1px solid ${COLORS.border}`, marginTop: 8,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6, letterSpacing: '0.04em' }}>
          PRO TIP
        </div>
        <p style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0, lineHeight: 1.55 }}>
          The best way to teach MiniMe? Send <code style={{ background: 'rgba(176,138,74,0.15)', padding: '1px 6px', borderRadius: 5, fontSize: 12 }}>/teach</code> in
          your bot with a price list, a photo, or a screenshot of how you handled a tricky customer. MiniMe
          learns from real examples better than from settings.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function SectionHeader({ title, emoji }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>{title}</h2>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: COLORS.textHint, marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 11.5, color: COLORS.textHint, marginTop: 5, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', appearance: 'none',
  border: `1.5px solid ${COLORS.divider}`, borderRadius: 12,
  background: COLORS.surface, color: COLORS.textPrimary,
  padding: '11px 13px', fontSize: 14, fontFamily: "'Geist', sans-serif",
  outline: 'none', boxSizing: 'border-box',
};

// A read-summary section that links out to the existing dedicated settings
// page. We don't fork the editing flows; we just surface state + a clear
// "Refine" or "Set up" CTA depending on whether there's data.
function LinkSection({ title, emoji, summary, emptyHint, ctaHref, ctaLabel }) {
  const hasData = !!summary;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: 18, marginBottom: 14,
    }}>
      <SectionHeader title={title} emoji={emoji} />
      <p style={{
        fontSize: 13,
        color: hasData ? COLORS.textPrimary : COLORS.textSecondary,
        margin: '8px 0 14px', lineHeight: 1.55,
      }}>
        {summary || emptyHint}
      </p>
      <Link
        href={ctaHref}
        style={{
          display: 'inline-block', textDecoration: 'none',
          appearance: 'none', border: `1.5px solid ${hasData ? COLORS.divider : COLORS.ink}`,
          background: hasData ? COLORS.surface : COLORS.ink,
          color: hasData ? COLORS.textPrimary : COLORS.paper,
          borderRadius: 999, padding: '9px 18px',
          fontSize: 13, fontWeight: 600, fontFamily: FONT.body,
          cursor: 'pointer',
        }}>
        {ctaLabel} →
      </Link>
    </div>
  );
}
