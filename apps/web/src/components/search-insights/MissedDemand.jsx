'use client';
/**
 * MissedDemand — "people searched for this in your category and nobody had it."
 * The stocking hit-list for the owner, plus the waitlist banner.
 */
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

export default function MissedDemand({ missedDemand, waitlistCount }) {
  const hasList = missedDemand && missedDemand.length > 0;
  if (!hasList && !waitlistCount) return null;

  return (
    <div style={{ fontFamily: FONT.body }}>
      {waitlistCount > 0 && (
        <div style={{
          background: 'rgba(176,138,74,0.08)', border: '1px solid rgba(176,138,74,0.25)',
          borderRadius: RADII.lg, padding: '12px 14px', marginBottom: hasList ? 14 : 0,
          fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
        }}>
          🔔 <strong>{waitlistCount} {waitlistCount === 1 ? 'person is' : 'people are'} waiting</strong> for
          a business like yours on @MiniMeSearchBot — they'll be notified the moment you stock what they need.
        </div>
      )}

      {hasList && (
        <>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
            Customers searched for these in your category and <strong>nobody had them</strong>. Stock them and you win the sale by default.
          </div>
          {missedDemand.slice(0, 8).map((m, i) => (
            <div key={m.query} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < Math.min(missedDemand.length, 8) - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
              <span style={{ flex: 1, fontSize: 13, color: COLORS.textPrimary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{m.query}"
              </span>
              <span style={{ fontSize: 12, color: COLORS.textHint, fontWeight: 600, flexShrink: 0 }}>{m.searches}× searched</span>
              {m.waiting > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#B08A4A', background: 'rgba(176,138,74,0.12)', padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>
                  {m.waiting} waiting
                </span>
              )}
            </div>
          ))}
          <a href="/settings/catalog" style={{
            display: 'inline-block', marginTop: 12, padding: '8px 16px', borderRadius: 10,
            background: COLORS.ink, color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}>
            ➕ Add these to your catalog
          </a>
        </>
      )}
    </div>
  );
}
