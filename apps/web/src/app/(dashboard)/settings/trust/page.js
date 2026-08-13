'use client';
import { useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';
import { UpgradeSheet, ProLock } from '../../../../components/ui/UpgradeSheet';
import { planStatus, effectiveTrustLevel, isTrustLevelCapped, FREE_MAX_TRUST_LEVEL } from '../../../../lib/plan';

const LEVELS = [
  { level: 0, emoji: '👁️', name: 'Shadow',     am: 'ጥላ',       color: COLORS.textSecondary, desc: 'Observe only. MiniMe watches but never drafts or sends anything.' },
  { level: 1, emoji: '✋', name: 'Supervised', am: 'ቁጥጥር',    color: COLORS.amber,          desc: 'Writes every reply for you. You read it and tap send.' },
  { level: 2, emoji: '🤝', name: 'Trusted',    am: 'ታማኝ',     color: COLORS.green,          desc: 'Sends routine replies itself. Flags anything complex for you.' },
  { level: 3, emoji: '🚀', name: 'Full Agent', am: 'ሙሉ ወኪል', color: '#7C3AED',              desc: 'Handles everything, day and night. You read the daily recap.' },
];

export default function TrustPage() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();
  // Local override so the UI updates instantly without waiting for context refresh
  const [localLevel, setLocalLevel] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const trustLevel = localLevel !== null ? localLevel : (ctxBusiness?.trust_level ?? 1);

  const { isPro } = planStatus(ctxBusiness);
  // The owner's stored level is never rewritten by a lapse, so a shop that was
  // on Trusted before the trial ended still reads Trusted here — it just isn't
  // what's running. Say so plainly rather than silently showing the wrong state.
  const capped = isTrustLevelCapped(ctxBusiness);
  const running = effectiveTrustLevel(ctxBusiness);

  async function setLevel(level) {
    if (!ctxBusiness?.id || level === trustLevel) return;
    if (!isPro && level > FREE_MAX_TRUST_LEVEL) { setUpgradeOpen(true); return; }
    setLocalLevel(level);
    try {
      await updateBusiness(initData, {
        trust_level: level,
        trust_promoted_at: new Date().toISOString(),
      });
      setBusiness(b => ({ ...b, trust_level: level }));
    } catch (e) {
      setLocalLevel(null);
      tgAlert('Could not save — check your connection and try again.');
    }
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Trust Controls</h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px' }}>
        Control how much autonomy MiniMe has. Start low and increase as you build confidence.
      </p>

      <UpgradeSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature="auto_send" />

      {/* A shop whose plan lapsed while set to Trusted/Full Agent. Never leave
          them guessing why replies stopped going out on their own. */}
      {capped && (
        <div style={{
          background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.25)',
          borderRadius: RADII.lg, padding: '13px 15px', marginBottom: 16,
          fontSize: 13, lineHeight: 1.5, color: COLORS.textPrimary,
        }}>
          Your setting is saved as <strong>{LEVELS[trustLevel]?.name}</strong>, but on Free MiniMe runs at{' '}
          <strong>{LEVELS[running]?.name}</strong> — it writes every reply and waits for your tap.
          {' '}Upgrade and your {LEVELS[trustLevel]?.name} setting comes straight back.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {LEVELS.map(l => {
          const active = trustLevel === l.level;
          const locked = !isPro && l.level > FREE_MAX_TRUST_LEVEL;
          return (
            <button
              key={l.level}
              onClick={() => setLevel(l.level)}
              style={{
                width: '100%', textAlign: 'left',
                background: COLORS.surface,
                border: `2px solid ${active ? COLORS.teal : COLORS.border}`,
                borderRadius: RADII.lg,
                padding: 16,
                cursor: 'pointer',
                fontFamily: FONT.body,
                transition: 'border-color 0.15s',
                boxShadow: active ? SHADOW.card : 'none',
                opacity: locked ? 0.72 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20 }}>{l.emoji}</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: l.color }}>{l.name}</span>
                <span style={{ fontSize: 13, color: COLORS.textHint }}>({l.am})</span>
                {locked && <ProLock />}
                {active && !locked && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, background: COLORS.teal, color: '#FFF', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0, paddingLeft: 32 }}>{l.desc}</p>
              {locked && (
                <p style={{ fontSize: 12, color: COLORS.textHint, margin: '6px 0 0', paddingLeft: 32 }}>
                  Pro — so you're not the one tapping send at 11pm.
                </p>
              )}
            </button>
          );
        })}
      </div>

      {!isPro && (
        <p style={{ fontSize: 12.5, color: COLORS.textHint, lineHeight: 1.5, margin: '16px 0 0' }}>
          On Free, MiniMe still reads every message and writes the reply — no customer is ever left
          unanswered. Pro is about who presses send.
        </p>
      )}
    </div>
  );
}
