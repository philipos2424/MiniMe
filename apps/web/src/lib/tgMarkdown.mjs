/**
 * Tokenise the Telegram-style Markdown our bot copy is written in (*bold*,
 * **bold**, _italic_, `code`, [label](url), MarkdownV2 backslash escapes) so
 * the web app can show it formatted instead of leaking raw asterisks and
 * `[Name](tg://user?id=…)` into the Assistant, Digest preview and Partners.
 *
 * Returns plain tokens; <TgMarkdown> turns them into React nodes, so nothing
 * here is ever HTML. Only http(s) links become links — tg:// and anything
 * else render as their label. No regex lookbehind: older iOS webviews fail to
 * parse it and would take the whole page down.
 */
const PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(^|[^A-Za-z0-9\\])_([^_\n]+)_(?![A-Za-z0-9])|`([^`\n]+)`/g;
const ESCAPED = /\\([_*[\]()~`>#+\-=|{}.!\\])/g;

const unescape = s => s.replace(ESCAPED, '$1');

export function tokenizeTgMarkdown(input) {
  const src = String(input ?? '');
  const out = [];
  const pushText = t => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev?.type === 'text') prev.text += unescape(t);
    else out.push({ type: 'text', text: unescape(t) });
  };
  let last = 0;
  for (const m of src.matchAll(PATTERN)) {
    const [whole, label, href, bold2, bold1, italicPrefix, italic, code] = m;
    let start = m.index;
    if (italic != null) {
      // The italic alternative consumes one character before the underscore.
      pushText(src.slice(last, start) + italicPrefix);
      out.push({ type: 'italic', text: unescape(italic) });
    } else {
      pushText(src.slice(last, start));
      if (label != null) {
        out.push(/^https?:\/\//i.test(href)
          ? { type: 'link', text: unescape(label), href }
          : { type: 'text', text: unescape(label) });
      } else if (bold2 != null || bold1 != null) {
        out.push({ type: 'bold', text: unescape(bold2 ?? bold1) });
      } else if (code != null) {
        out.push({ type: 'code', text: code });
      }
    }
    last = start + whole.length;
  }
  pushText(src.slice(last));
  // Merge adjacent plain-text tokens produced by non-http links.
  return out.reduce((acc, t) => {
    const prev = acc[acc.length - 1];
    if (t.type === 'text' && prev?.type === 'text') prev.text += t.text;
    else acc.push({ ...t });
    return acc;
  }, []);
}

/** Plain-text version, for places that can't render formatting. */
export function stripTgMarkdown(input) {
  return tokenizeTgMarkdown(input).map(t => t.text).join('');
}
