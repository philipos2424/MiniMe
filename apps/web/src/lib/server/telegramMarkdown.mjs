/**
 * Telegram legacy-Markdown helpers ("parse_mode: 'Markdown'").
 *
 * An unclosed *bold*, _italic_ or `code` makes the Bot API reject the whole
 * message ("can't parse entities") — no partial delivery, just a 400 that
 * most call sites only log. Measured 2026-10-17: the first-customer nudge
 * failed for 104 of 109 shops (the "_" in start=shop_<code>), and ~4.7% of
 * customer messages would sink the owner's draft card on their own text.
 */
export { escapeMd } from './reengage/copy.mjs';

/** True when Telegram's legacy-Markdown parser would accept `text`. */
export function legacyMarkdownOk(text) {
  const t = String(text ?? '');
  let open = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (!open && c === '\\') { i++; continue; }
    if (open) { if (c === open) open = null; continue; }
    if (c === '*' || c === '_' || c === '`') open = c;
  }
  return open === null;
}

/** Last-resort plain text: drop entity markers, unescape escaped characters. */
export function plainText(text) {
  return String(text ?? '').replace(/\\([_*`[\]])|[*_`]/g, (m, escaped) => escaped || '');
}

// Legacy Markdown has no escaping INSIDE an entity: in *bold* only "*" ends
// it ("\" would print literally), in _italic_ only "_" does. So values going
// inside an entity lose that one character; values outside get escapeMd().
export const inBold = s => String(s ?? '').replace(/\*/g, '');
export const inItalic = s => String(s ?? '').replace(/_/g, ' ');

export const isParseError = j => /can't parse entities/i.test(j?.description || '');

/**
 * The same request without Markdown: parse_mode dropped, text/caption made
 * plain. Used to retry once after a parse error so the words still arrive.
 */
export function withoutMarkdown(body) {
  const { parse_mode, ...rest } = body || {};
  if (typeof rest.text === 'string') rest.text = plainText(rest.text);
  if (typeof rest.caption === 'string') rest.caption = plainText(rest.caption);
  return rest;
}
