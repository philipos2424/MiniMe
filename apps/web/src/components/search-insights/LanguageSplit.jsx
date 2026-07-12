'use client';
/**
 * LanguageSplit — Amharic vs English share of the searches that surfaced
 * this business. Helps owners write descriptions/taglines in the language
 * their customers actually search in.
 */
import { COLORS, FONT } from '../../lib/design-tokens';

export default function LanguageSplit({ languages }) {
  const am = languages?.am || 0;
  const en = languages?.en || 0;
  const total = am + en;
  if (!total) return null;
  const amPct = Math.round((am / total) * 100);
  const enPct = 100 - amPct;

  return (
    <div style={{ fontFamily: FONT.body }}>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
        {amPct > 0 && <div style={{ width: `${amPct}%`, background: '#B08A4A' }} />}
        {enPct > 0 && <div style={{ width: `${enPct}%`, background: COLORS.teal }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: COLORS.textSecondary }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#B08A4A' }} />
          አማርኛ Amharic · <strong>{amPct}%</strong> ({am})
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.teal }} />
          English · <strong>{enPct}%</strong> ({en})
        </span>
      </div>
      {amPct >= 40 && (
        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 8, lineHeight: 1.4 }}>
          💡 Many of your customers search in Amharic — add Amharic product names and descriptions so they find you more often.
        </div>
      )}
    </div>
  );
}
