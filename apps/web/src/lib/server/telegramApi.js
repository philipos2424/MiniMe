/**
 * Thin fetch wrapper around the Telegram Bot API.
 *
 * Factored out of replyEngine.js so other server modules (jobFanout, etc.)
 * can DM suppliers / owners without importing the whole reply engine.
 *
 * Business API support: when a bot handles messages on behalf of a connected
 * Telegram Business account, every reply must include business_connection_id.
 * Call setBizConnId(chatId, connId) at the start of a business_message update,
 * and clearBizConnId(chatId) when done. tg() will auto-inject it.
 */

// Maps chatId → business_connection_id for the duration of a business_message update
const _bizConnIds = new Map();

const BIZ_SEND_METHODS = new Set([
  'sendMessage', 'sendPhoto', 'sendDocument', 'sendAudio', 'sendVideo',
  'sendSticker', 'sendChatAction', 'sendInvoice', 'copyMessage', 'sendVoice',
  'sendLocation', 'sendMediaGroup',
]);

export function setBizConnId(chatId, connId) {
  if (chatId && connId) _bizConnIds.set(String(chatId), connId);
}
export function clearBizConnId(chatId) {
  if (chatId) _bizConnIds.delete(String(chatId));
}

export async function tg(token, method, body) {
  // Auto-inject business_connection_id for Business API message contexts
  if (BIZ_SEND_METHODS.has(method) && body?.chat_id) {
    const bizConnId = _bizConnIds.get(String(body.chat_id));
    if (bizConnId && !body.business_connection_id) {
      body = { ...body, business_connection_id: bizConnId };
    }
  }
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
