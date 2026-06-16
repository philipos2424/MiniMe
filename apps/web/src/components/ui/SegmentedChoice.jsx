'use client';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

// "Pick one of N" control rendered as full-width stacked cards. Generalizes the
// inline radio pattern that lived in settings/modes/page.js so Modes, Trust and
// new-contact handling all share it. A "Recommended" pill on the default option
// anchors the choice and removes decision paralysis.
//
// options: [{ value, label, desc, recommended?, badge?, disabled? }]
export default function SegmentedChoice({
  label,
  value,
  onChange,
  options = [],
  saving = false,
  style: extraStyle,
}) {
  return (
    <div style={{ fontFamily: FONT.body, ...extraStyle }}>
      {label && (
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: COLORS.textHint, marginBottom: 8,
        }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => {
          const selected = value === opt.value;
          const disabled = saving || opt.disabled;
          return (
            <button
              key={opt.value}
              onClick={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              style={{
                appearance: 'none', textAlign: 'left',
                cursor: disabled ? (saving ? 'wait' : 'default') : 'pointer',
                background: selected ? COLORS.greenLight : COLORS.surface,
                border: `1.5px solid ${selected ? COLORS.green : COLORS.divider}`,
                borderRadius: RADII.md, padding: '12px 14px',
                fontFamily: FONT.body, color: COLORS.textPrimary,
                opacity: saving ? 0.7 : 1,
                display: 'flex', alignItems: 'flex-start', gap: 11,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                border: `2px solid ${selected ? COLORS.green : COLORS.border}`,
                background: selected ? COLORS.green : 'transparent',
                display: 'grid', placeItems: 'center',
              }}>
                {selected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: selected ? COLORS.green : COLORS.textPrimary }}>
                    {opt.label}
                  </span>
                  {opt.recommended && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      background: COLORS.greenLight, color: COLORS.green,
                      padding: '2px 8px', borderRadius: 999,
                    }}>
                      Recommended
                    </span>
                  )}
                  {opt.badge && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      background: COLORS.amberLight, color: COLORS.amber,
                      padding: '2px 8px', borderRadius: 999,
                    }}>
                      {opt.badge}
                    </span>
                  )}
                </div>
                {opt.desc && (
                  <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 3, lineHeight: 1.45 }}>
                    {opt.desc}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
