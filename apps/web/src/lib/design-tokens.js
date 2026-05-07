// MiniMe v2 design tokens — warm-white minimal mobile.
// Used by the redesigned screens (onboarding, home, conversation, settings, agent).
// Older screens still reference the Tailwind tokens until they're migrated.

export const COLORS = {
  bg: '#FAFAF8',
  surface: '#FFFFFF',
  border: '#EBEBEB',
  divider: '#F3F3F1',

  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textHint: '#9CA3AF',

  green: '#16A34A', greenLight: '#F0FDF4',
  amber: '#D97706', amberLight: '#FFFBEB',
  red: '#DC2626',   redLight: '#FEF2F2',
  teal: '#0D9488',  tealLight: '#F0FDFA',
};

export const FONT = {
  body: "'Inter', -apple-system, system-ui, sans-serif",
  amharic: "'Noto Serif Ethiopic', 'Noto Sans Ethiopic', serif",
};

export const RADII = { sm: 8, md: 12, lg: 16, xl: 20 };
export const SHADOW = { card: '0 1px 3px rgba(0,0,0,0.06)' };

// Helper for mixing English + Amharic detection
export function isAmharic(s) { return /[ሀ-፿]/.test(s || ''); }
