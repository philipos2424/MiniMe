'use client';
import { tokenizeTgMarkdown } from '../../lib/tgMarkdown.mjs';

/** Renders Telegram-style Markdown as React nodes (never HTML). */
export default function TgMarkdown({ text }) {
  return tokenizeTgMarkdown(text).map((t, i) => {
    if (t.type === 'bold') return <strong key={i}>{t.text}</strong>;
    if (t.type === 'italic') return <em key={i}>{t.text}</em>;
    if (t.type === 'code') return <code key={i} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{t.text}</code>;
    if (t.type === 'link') return <a key={i} href={t.href} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{t.text}</a>;
    return <span key={i}>{t.text}</span>;
  });
}
