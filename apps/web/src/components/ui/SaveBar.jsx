'use client';
/**
 * SaveBar — sticky bottom action bar for settings pages.
 * Always visible so users never have to scroll to the bottom to save.
 *
 * The ONE save pattern for settings pages (audit, Oct 2026: pages used an
 * always-active Save, a "No changes" bar, per-field Save buttons, or none).
 * It reads "No changes" until the form differs from what was loaded/saved.
 *
 * Rule: anything typed (text, numbers, multi-field forms) saves through this
 * bar. A single toggle or radio choice saves on tap with no bar, as on the
 * Secretary Mode and Notifications pages. No per-field Save buttons.
 *
 * Usage:
 *   const { dirty, markSaved } = useUnsavedChanges(form);
 *   // after loading: markSaved(loadedForm); after a successful save: markSaved();
 *   <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} />
 *
 * Props:
 *   dirty   — true when the form has unsaved changes (required; defaults to false)
 *   saving  — true while the async save is in progress
 *   saved   — true after a successful save; shown only while nothing has changed since
 *   onSave  — function to call when the button is tapped
 *   label   — button label (default: "Save")
 */
import { useCallback, useRef, useState } from 'react';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

/**
 * Tracks whether `value` differs from the last loaded/saved snapshot. Until
 * markSaved() is first called (i.e. while loading) nothing counts as a change.
 */
export function useUnsavedChanges(value) {
  const baseline = useRef(null);
  const [, bump] = useState(0);
  const markSaved = useCallback((v) => {
    baseline.current = JSON.stringify(v === undefined ? value : v);
    bump(n => n + 1);
  }, [value]);
  const dirty = baseline.current !== null && JSON.stringify(value) !== baseline.current;
  return { dirty, markSaved };
}

export default function SaveBar({ dirty = false, saving, saved, onSave, label = 'Save' }) {
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
        {saved && !dirty && !saving && (
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.green, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            ✓ Saved
          </div>
        )}
      </div>
    </div>
  );
}
