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

/**
 * Drop Markdown-significant characters from text that goes INSIDE an entity
 * (*bold*, _italic_). Legacy Markdown has no escapes inside entities, so the
 * only safe option there is to remove them. Used for business names and tags.
 */
export function plainForEntity(s) {
  return String(s ?? '').replace(/[*_`[\]]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Send with Markdown; if Telegram can't parse it, send the same text as plain
 * text. `send` is (body) => Promise<telegramResult>.
 */
export async function sendMarkdownSafe(send, body) {
  const res = await send(body);
  if (res?.ok || !body?.parse_mode || !/parse entities/i.test(res?.description || '')) return res;
  const { parse_mode, ...plain } = body;
  return send({ ...plain, text: stripMd(body.text) });
}
