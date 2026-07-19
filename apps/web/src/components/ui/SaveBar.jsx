'use client';
/**
 * SaveBar — sticky bottom action bar for settings pages.
 * Always visible so users never have to scroll to the bottom to save.
 *
 * Usage:
 *   <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} />
 *
 * Props:
 *   dirty   — true when the form has unsaved changes
 *   saving  — true while the async save is in progress
 *   saved   — true briefly after a successful save (caller clears after ~2s)
 *   onSave  — function to call when the button is tapped
 *   label   — button label (default: "Save")
 */
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

export default function SaveBar({ dirty = true, saving, saved, onSave, label = 'Save' }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(64px + env(safe-area-inset-bottom))',
      left: 0, right: 0, zIndex: 40,
      background: 'color-mix(in srgb, #FFFFFF 95%, transparent)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderTop: `1px solid ${COLORS.border}`,
      padding: '12px 20px',
    }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onSave}
          disabled={saving || !dirty}
          style={{
            flex: 1,
            background: saving ? COLORS.textHint : dirty ? COLORS.textPrimary : COLORS.border,
            color: dirty ? '#fff' : COLORS.textHint,
            fontWeight: 600, padding: '14px 0',
            borderRadius: RADII.lg, border: 'none', fontSize: 15,
            cursor: saving || !dirty ? 'default' : 'pointer',
            fontFamily: FONT.body, transition: 'all .15s ease',
          }}
        >
          {saving ? 'Saving…' : dirty ? label : 'No changes'}
        </button>
        {saved && (
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.green, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            ✓ Saved
          </div>
        )}
      </div>
    </div>
  );
}
