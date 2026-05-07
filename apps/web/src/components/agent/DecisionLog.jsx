'use client';
import { useState } from 'react';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

export default function DecisionLog({ log }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, fontFamily: FONT.body }}>
      <button onClick={() => setOpen(p => !p)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT.body, padding: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.teal }}>🧠 AI Decision Log ({log.length})</span>
        <span style={{ color: COLORS.textHint }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {log.map((entry, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${COLORS.teal}40`, paddingLeft: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>{entry.decision}</p>
              <p style={{ fontSize: 12, color: COLORS.textHint, margin: '4px 0 0' }}>{entry.reasoning}</p>
              {entry.confidence && <p style={{ fontSize: 11, color: COLORS.textHint, margin: '2px 0 0' }}>Confidence: {Math.round(entry.confidence * 100)}%</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
