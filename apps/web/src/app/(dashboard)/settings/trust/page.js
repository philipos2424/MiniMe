'use client';
import { useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const LEVELS = [
  { level: 0, emoji: '👁️', name: 'Shadow',     am: 'ጥላ',       color: COLORS.textSecondary, desc: 'Observe only. MiniMe watches but never drafts or sends anything.' },
  { level: 1, emoji: '✋', name: 'Supervised', am: 'ቁጥጥር',    color: COLORS.amber,          desc: 'Drafts every reply. You approve each one before it sends.' },
  { level: 2, emoji: '🤝', name: 'Trusted',    am: 'ታማኝ',     color: COLORS.green,          desc: 'Auto-sends routine messages (>85% confidence). Flags complex ones.' },
  { level: 3, emoji: '🚀', name: 'Full Agent', am: 'ሙሉ ወኪል', color: '#7C3AED',              desc: 'Handles everything. You review daily summary.' },
];

export default function TrustPage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();
  // Local override so the UI updates instantly without waiting for context refresh
  const [localLevel, setLocalLevel] = useState(null);
  const trustLevel = localLevel !== null ? localLevel : (ctxBusiness?.trust_level ?? 1);

  async function setLevel(level) {
    if (!ctxBusiness?.id || level === trustLevel) return;
    setLocalLevel(level);
    await supabase.from('businesses').update({
      trust_level: level,
      trust_promoted_at: new Date().toISOString(),
    }).eq('id', ctxBusiness.id);
    // Keep context in sync
    setBusiness(b => ({ ...b, trust_level: level }));
  }

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Trust Controls</h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px' }}>
        Control how much autonomy MiniMe has. Start low and increase as you build confidence.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {LEVELS.map(l => {
          const active = trustLevel === l.level;
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
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>{l.emoji}</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: l.color }}>{l.name}</span>
                <span style={{ fontSize: 13, color: COLORS.textHint }}>({l.am})</span>
                {active && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, background: COLORS.teal, color: '#FFF', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                    Active
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0, paddingLeft: 32 }}>{l.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
