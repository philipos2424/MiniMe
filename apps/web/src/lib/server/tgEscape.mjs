/**
 * Escaping for Telegram's legacy `parse_mode: 'Markdown'` — the only mode this
 * app sends with. Legacy Markdown lets you escape just _ * ` [ ; any other
 * backslash is shown literally. The old escapers were written for MarkdownV2
 * (they also escaped . - ( ) ! …), so owners saw "gmail\.com" and
 * "\(@shop\_bot\)" in partner lists, research reports and /start.
 */
export function escapeLegacyMd(s) {
  if (s == null) return '';
  return String(s).replace(/([_*`[])/g, '\\$1');
}

/** Remove Markdown markers for a plain-text resend when Telegram can't parse. */
export function stripMd(s) {
  return String(s ?? '').replace(/\\([_*`[\]()~>#+\-=|{}.!\\])/g, '$1').replace(/[*_`]/g, '');
}
