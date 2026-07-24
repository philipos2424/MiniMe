/**
 * Thin fetch wrapper around the Telegram Bot API.
 *
 * Factored out of replyEngine.js so other server modules (jobFanout, etc.)
 * can DM suppliers / owners without importing the whole reply engine.
 *
 * Business API support: when a bot handles messages on behalf of a connected
 * Telegram Business account, every reply must include business_connection_id.
 *
 * Primary mechanism: runWithBizConn(connId, fn) — uses AsyncLocalStorage so
 * the connection id is isolated per async call chain, not shared process-wide.
 * This matters because chatId (the customer's Telegram id) is a GLOBAL
 * identifier: the same real person can message two different Secretary-Mode
 * owners around the same time, on the same warm serverless instance. A plain
 * `chatId → connId` Map (the old approach, kept below as a narrow fallback for
 * call sites not yet wrapped) would let one business's in-flight request
 * overwrite the entry the other business just set, so a reply built with
 * business A's data could get sent through business B's connection — which
 * reads, to anyone watching, as MiniMe "mixing up" who it's talking to.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const _bizConnStore = new AsyncLocalStorage();

/** Run fn with connId scoped to this async call chain only — never leaks to concurrent requests. */
export function runWithBizConn(connId, fn) {
  if (!connId) return fn();
  return _bizConnStore.run({ connId: String(connId) }, fn);
}

// Legacy fallback: maps chatId → business_connection_id. Only consulted when
// no AsyncLocalStorage context is active (call sites not yet wrapped in
// runWithBizConn) — still racy the same way the old global map always was,
// but narrowed to a shrinking set of call sites instead of every reply.
const _bizConnIds = new Map();

function currentBizConnId(chatId) {
  const fromStore = _bizConnStore.getStore()?.connId;
  if (fromStore) return fromStore;
  return _bizConnIds.get(String(chatId));
}

// Maps business_connection_id → { chatId, businessId } so that when Telegram
// refuses a reply (BUSINESS_CONNECTION_NOT_ALLOWED) we can DM the owner with the fix.
const _bizConnOwner = new Map();

export function setBizConnOwner(connId, chatId, businessId) {
  if (connId && chatId) _bizConnOwner.set(String(connId), { chatId: String(chatId), businessId: businessId || null });
}

const BIZ_PERM_GUIDANCE = `⚠️ *I can see your customers' messages but Telegram won't let me reply yet.*\n\nTo turn replies on (10 seconds):\nTelegram → *Settings* → *Business* → *Chatbots* → tap me → enable *"Reply to Messages"*.\n\nOnce that's on, I'll start answering automatically. 💬`;

// When a reply is rejected for lack of permission, DM the owner the fix —
// throttled to once per 6h per business so we never spam them.
async function maybeAlertOwnerBizPerm(token, connId) {
  try {
    if (!connId) return;
    const info = _bizConnOwner.get(String(connId));
    if (!info?.chatId) return;
    const { supabase } = await import('./db');
    const sb = supabase();
    let meta = {};
    if (info.businessId) {
      const { data: biz } = await sb.from('businesses').select('meta').eq('id', info.businessId).maybeSingle();
      meta = biz?.meta || {};
      const last = meta.biz_perm_alerted_at ? Date.parse(meta.biz_perm_alerted_at) : 0;
      if (Date.now() - last < 6 * 60 * 60 * 1000) return;
    }
    // Send WITHOUT business_connection_id — this goes straight to the owner's DM with the bot.
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: info.chatId, parse_mode: 'Markdown', text: BIZ_PERM_GUIDANCE }),
    });
    if (info.businessId) {
      await sb.from('businesses')
        .update({ meta: { ...meta, biz_perm_alerted_at: new Date().toISOString() } })
        .eq('id', info.businessId)
        .then(() => {}, () => {});
    }
  } catch { /* best-effort, never block a reply */ }
}

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
    const bizConnId = currentBizConnId(body.chat_id);
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
  if (!j?.ok) {
    console.warn(`tg ${method}:`, j?.description);
    if (BIZ_SEND_METHODS.has(method) && /BUSINESS_CONNECTION_NOT_ALLOWED/i.test(j?.description || '')) {
      maybeAlertOwnerBizPerm(token, body?.business_connection_id).catch(() => {});
    }
  }
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
  // Secretary mode (Telegram Business API): every outbound send must carry
  // business_connection_id or Telegram rejects it — tg() auto-injects it for
  // JSON sends, so mirror that here for the multipart path.
  const bizConnId = currentBizConnId(chatId);
  if (bizConnId) fd.append('business_connection_id', bizConnId);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: fd,
  });
  return r.json();
}
