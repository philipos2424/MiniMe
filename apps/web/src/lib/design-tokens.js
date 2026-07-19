// MiniMe v3 design tokens — forest + cream + gold
export const COLORS = {
  // Core palette
  ink:      '#0E2823',
  ink2:     '#1E3A35',
  inkSoft:  '#4A5E5A',
  muted:    '#8A9590',
  line:     '#E4DED1',
  lineSoft: '#EEE9DE',
  cream:    '#F4EEE1',
  cream2:   '#EDE6D6',
  paper:    '#FFFFFF',
  gold:     '#B08A4A',
  goldSoft: '#D4B987',
  mint:     '#4FA38A',
  error:    '#B85450',

  // Semantic aliases (kept for backwards compat with older screens)
  bg:           '#FFFFFF',
  surface:      '#FFFFFF',
  border:       '#E4DED1',
  divider:      '#EEE9DE',
  textPrimary:  '#0E2823',
  textSecondary:'#4A5E5A',
  textHint:     '#8A9590',
  green:        '#4FA38A',
  greenLight:   'rgba(79,163,138,0.10)',
  amber:        '#B08A4A',
  amberLight:   'rgba(176,138,74,0.10)',
  red:          '#B85450',
  redLight:     'rgba(184,84,80,0.10)',
  teal:         '#4FA38A',
  tealLight:    'rgba(79,163,138,0.10)',
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
