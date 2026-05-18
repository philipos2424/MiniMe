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

/**
 * Download a file from Telegram servers by file_id.
 * Returns a Buffer, or null on failure.
 */
export async function tgDownloadFile(token, fileId) {
  try {
    const r1 = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10000),
    });
    const j1 = await r1.json();
    if (!j1?.ok || !j1.result?.file_path) return null;
    const url = `https://api.telegram.org/file/bot${token}/${j1.result.file_path}`;
    const r2 = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r2.ok) return null;
    return Buffer.from(await r2.arrayBuffer());
  } catch (e) {
    console.warn('[tgDownloadFile]', e.message);
    return null;
  }
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
