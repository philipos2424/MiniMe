'use client';

// MiniMe mark: owner M-arch above gold mirror line, reflected mini-me below.
export function MiniMeLogo({ size = 48, color = '#0E2823', accent = '#B08A4A' }) {
  const stroke = size * 0.06;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="MiniMe">
      <path
        d="M18 50 Q18 22 34 22 Q50 22 50 50 Q50 22 66 22 Q82 22 82 50"
        stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none"
      />
      <circle cx="50" cy="34" r="3.4" fill={color} />
      <line x1="14" y1="50" x2="86" y2="50" stroke={accent} strokeWidth={stroke * 0.5} strokeLinecap="round" />
      <circle cx="50" cy="50" r={stroke * 0.55} fill={accent} />
      <path
        d="M18 50 Q18 78 34 78 Q50 78 50 50 Q50 78 66 78 Q82 78 82 50"
        stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" opacity="0.38"
      />
      <circle cx="50" cy="66" r="2.8" stroke={color} strokeWidth={stroke * 0.7} fill="none" opacity="0.55" />
    </svg>
  );
}

export function MiniMeWordmark({ size = 28, color = '#0E2823' }) {
  return (
    <span style={{
      fontFamily: "'Newsreader', Georgia, serif",
      fontWeight: 300, fontStyle: 'italic',
      fontSize: size, color, letterSpacing: '-0.015em', lineHeight: 1,
    }}>
      minime
    </span>
  );
}

export function MiniMeLockup({ size = 36, color = '#0E2823', accent = '#B08A4A' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <MiniMeLogo size={size} color={color} accent={accent} />
      <MiniMeWordmark size={size * 0.78} color={color} />
    </div>
  );
}
