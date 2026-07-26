// MiniMe v4 design tokens — indigo + warm white, theme-aware.
//
// Every value here points at a CSS variable defined in globals.css (light) and
// html[data-theme="dark"] (dark). Because these strings are used inside React
// inline styles, `var(--x)` resolves live — so flipping the theme instantly
// recolors every one of the ~700 call sites without touching them.
export const COLORS = {
  // Core palette
  ink:      'var(--ink)',
  ink2:     'var(--ink-2)',
  inkSoft:  'var(--ink-soft)',
  muted:    'var(--muted)',
  line:     'var(--line)',
  lineSoft: 'var(--line-soft)',
  cream:    'var(--cream)',
  cream2:   'var(--cream-2)',
  paper:    'var(--paper)',
  gold:     'var(--gold)',
  goldSoft: 'var(--gold-soft)',
  mint:     'var(--mint)',
  error:    'var(--error)',

  // Semantic aliases (kept for backwards compat with older screens)
  bg:           'var(--paper)',
  surface:      'var(--paper)',
  surfaceMuted: 'var(--cream)',
  border:       'var(--line)',
  divider:      'var(--line-soft)',
  textPrimary:  'var(--ink)',
  textSecondary:'var(--ink-2)',
  textHint:     'var(--muted)',
  green:        'var(--mint)',
  greenLight:   'rgba(16, 185, 129, 0.10)',
  amber:        'var(--gold)',
  amberLight:   'rgba(212, 175, 55, 0.10)',
  red:          'var(--error)',
  redLight:     'rgba(209, 117, 112, 0.10)',
  teal:         'var(--mint)',
  tealLight:    'rgba(16, 185, 129, 0.10)',
};

export const FONT = {
  body:    "'Geist', 'Inter', -apple-system, system-ui, sans-serif",
  serif:   "'Newsreader', Georgia, serif",
  serifI:  "'Newsreader', Georgia, serif",
  amharic: "'Noto Sans Ethiopic', 'Geist', sans-serif",
  mono:    "'Geist Mono', ui-monospace, monospace",
  // legacy alias
  display: "'Newsreader', Georgia, serif",
};

export const RADII = { sm: 10, md: 16, lg: 22, xl: 28 };
export const SHADOW = {
  card:  '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)',
  float: '0 10px 30px -10px rgba(14,40,35,.25)',
};

export function isAmharic(s) { return /[ሀ-፿]/.test(s || ''); }
