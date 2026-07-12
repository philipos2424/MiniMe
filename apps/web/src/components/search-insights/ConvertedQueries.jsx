'use client';
/**
 * ConvertedQueries — "searches that became customers": queries whose search
 * referrals actually opened the owner's bot and (converted) sent a message.
 */
import { COLORS, FONT } from '../../lib/design-tokens';

export default function ConvertedQueries({ convertedQueries }) {
  if (!convertedQueries?.length) return null;

  return (
    <div style={{ fontFamily: FONT.body }}>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
        These searches sent customers to your bot. Lean into what's working — mention these words in your description and tagline.
      </div>
      {convertedQueries.map((q, i) => (
        <div key={q.query} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < convertedQueries.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
          <span style={{ flex: 1, fontSize: 13, color: COLORS.textPrimary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            "{q.query}"
          </span>
          <span style={{ fontSize: 12, color: COLORS.textHint, fontWeight: 600, flexShrink: 0 }}>{q.referrals} {q.referrals === 1 ? 'click' : 'clicks'}</span>
          {q.converted > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.green, background: 'rgba(52,168,83,0.1)', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>
              {q.converted} chatted
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
