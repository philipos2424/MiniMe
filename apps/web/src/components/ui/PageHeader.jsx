'use client';
import { useLanguage } from '../../context/LanguageContext';
import { COLORS, FONT } from '../../lib/design-tokens';

export default function PageHeader({ title, subtitleAm, subtitleEn, right }) {
  const { showAmharic } = useLanguage();
  const amVisible = showAmharic && subtitleAm;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, fontFamily: FONT.body }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: COLORS.textPrimary, letterSpacing: '-0.02em', margin: 0 }}>
          {title}
        </h1>
        {(amVisible || subtitleEn) && (
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4, marginBottom: 0 }}>
            {amVisible && <span>{subtitleAm}</span>}
            {amVisible && subtitleEn && <span> · </span>}
            {subtitleEn && <span>{subtitleEn}</span>}
          </p>
        )}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </div>
  );
}
