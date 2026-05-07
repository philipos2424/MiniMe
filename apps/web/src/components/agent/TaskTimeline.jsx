'use client';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

export default function TaskTimeline({ steps }) {
  if (!steps.length) return <p style={{ fontSize: 14, color: COLORS.textHint, fontFamily: FONT.body }}>No steps recorded yet.</p>;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, fontFamily: FONT.body }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Timeline</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map((s, i) => {
          const dotColor = s.status === 'completed' ? COLORS.green : s.status === 'in_progress' ? COLORS.amber : COLORS.textHint;
          return (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className={s.status === 'in_progress' ? 'animate-pulse' : ''} style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, marginTop: 6, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0 }}>{s.step}</p>
                {s.timestamp && <p style={{ fontSize: 11, color: COLORS.textHint, margin: '2px 0 0' }}>{new Date(s.timestamp).toLocaleTimeString()}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
