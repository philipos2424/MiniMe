/**
 * Reading a payment screenshot: is this a receipt, and what is its transaction
 * number?
 *
 * Two jobs, deliberately in one Vision call:
 *
 *   1. TYPING. An owner's photo could be a product, a price list, a receipt or
 *      their lunch. Only a receipt may be routed into the payment pipeline, and
 *      keyword-matching a caption doesn't decide it — most people send the
 *      screenshot with no caption at all. The model looks at the image and says
 *      which it is, so a product photo from a merchant who once asked for
 *      payment details still reaches teachFromPhoto.
 *
 *   2. THE REFERENCE. verify.et checks the BANK's transaction number. Typed by
 *      hand it was the single most error-prone field in the flow — a
 *      12-character mixed-case string, copied off an SMS, on a phone, into a
 *      Mini App. It is printed on the screenshot the merchant is already
 *      sending. Reading it there removes the typing and the typo together.
 *
 * Nothing here decides whether anyone gets Pro. It produces a candidate the
 * merchant confirms and verify.et checks against the bank — an OCR misread ends
 * as a failed verification, never as unearned access.
 */
import { MODEL_MINI } from './constants';
import { loggedCompletion } from './openai-wrapper';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Download a Telegram file once. We need the bytes anyway (they get uploaded
 * to storage as evidence), and passing the bytes to Vision as a data URL keeps
 * the bot token out of the request we send the model — the URL form embeds it.
 */
export async function downloadTelegramPhoto(token, msg) {
  const photos = msg.photo;
  if (!photos?.length) return null;
  const best = photos[photos.length - 1];
  if (best.file_size && best.file_size > MAX_BYTES) return null;
  return downloadTelegramFile(token, best.file_id);
}

/**
 * Same download by file_id alone — the follow-up path has only the id it
 * stashed when the merchant sent a screenshot it could not read a reference
 * from. Telegram file_ids stay resolvable, so nothing has to be parked in our
 * storage while we wait for them to type the number.
 */
export async function downloadTelegramFile(token, fileId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!j?.ok || !j.result?.file_path) throw new Error(`getFile failed: ${j?.description}`);

  const resp = await fetch(`https://api.telegram.org/file/bot${token}/${j.result.file_path}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`file download ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_BYTES) return null;

  const ext = (j.result.file_path.split('.').pop() || 'jpg').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { buffer, mime };
}

/**
 * @returns {Promise<null | {
 *   isPayment: boolean, confidence: 'high'|'low',
 *   reference: string|null, amount: number|null,
 *   recipient: string|null, rail: 'telebirr'|'bank'|null,
 * }>}
 */
export async function readPaymentScreenshot({ buffer, mime }) {
  try {
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    const resp = await loggedCompletion({
      route: 'payment_screenshot',
      model: MODEL_MINI,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
`This image was sent by an Ethiopian shop owner. Decide whether it is proof of a MONEY TRANSFER they made (a Telebirr receipt, a CBE / bank transfer confirmation, an SMS confirming a transfer) or something else entirely (a product, a price list, a document, a person, a screenshot of a chat).

Return JSON only:
{
  "is_payment": true | false,
  "confidence": "high" | "low",
  "reference": "the transaction / reference number exactly as printed, or null",
  "amount": number in ETB or null,
  "recipient": "who received the money, or null",
  "rail": "telebirr" | "bank" | null
}

Rules:
- "reference" is the BANK's transaction number (Telebirr: often starts CH/BE and mixes letters and digits; CBE: often starts FT). Copy it character for character, preserving case. Do NOT invent, complete or correct it — if it is cut off, blurred or absent, return null.
- A receipt for money the owner RECEIVED from a customer is still is_payment true; we decide what to do with it, you only read it.
- If it is not a transfer receipt at all, return is_payment false and null for every other field.` },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      }],
    });

    const raw = resp.choices[0]?.message?.content || '';
    let j;
    try { j = JSON.parse(raw); } catch { return null; }

    const reference = typeof j.reference === 'string' ? j.reference.trim() : '';
    return {
      isPayment: j.is_payment === true,
      confidence: j.confidence === 'high' ? 'high' : 'low',
      // A reference is a bank's transaction id, not a sentence. Anything long,
      // spaced or punctuated is the model narrating rather than reading, and
      // sending that to verify.et burns a credit to be told nothing.
      reference: /^[A-Za-z0-9-]{6,32}$/.test(reference) ? reference : null,
      amount: Number.isFinite(Number(j.amount)) && Number(j.amount) > 0 ? Number(j.amount) : null,
      recipient: typeof j.recipient === 'string' ? j.recipient.trim().slice(0, 80) || null : null,
      rail: j.rail === 'telebirr' || j.rail === 'bank' ? j.rail : null,
    };
  } catch (e) {
    console.error('[payment-screenshot]', e.message);
    return null;
  }
}
