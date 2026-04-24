/**
 * Thin fetch wrapper around the Telegram Bot API.
 *
 * Factored out of replyEngine.js so other server modules (jobFanout, etc.)
 * can DM suppliers / owners without importing the whole reply engine.
 */

export async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j?.ok) console.warn(`tg ${method}:`, j?.description);
  return j;
}

/** multipart sendDocument — used for auto-sending PDFs/files. */
export async function tgSendDocument(token, chatId, buffer, filename, caption) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('document', new Blob([buffer]), filename);
  if (caption) fd.append('caption', caption);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: fd,
  });
  return r.json();
}
