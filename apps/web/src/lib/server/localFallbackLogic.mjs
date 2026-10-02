/**
 * Pure core of MiniMe's "answer from what we already hold" fallback.
 *
 * Used by replyEngine when reply GENERATION fails outright — every model
 * provider down, quota exhausted, or a bug in the prompt path. The behaviour it
 * replaces was to go straight to a customer-facing apology ("I'm having trouble
 * right now — I'll make sure the owner sees your message"). That is the right
 * shape for a question we genuinely cannot answer, but it was also being sent
 * for questions the business had ALREADY answered: a price sitting in the
 * catalog, or an FAQ the owner taught us. To a customer that reads as the
 * business not knowing its own prices.
 *
 * Kept pure (no Supabase, no network) so the matching rules can be tested
 * directly — the same reason amharicScript.mjs and delegationLogic.mjs live
 * outside replyEngine.js, which the test runner cannot import (extensionless
 * specifiers only the Next bundler resolves).
 *
 * Deliberately conservative: every branch returns null rather than guessing, so
 * the caller keeps its holding-reply path. The FAQ branch matches on the owner's
 * stored question, so it is language-agnostic — it works for Amharic and
 * mixed-script messages without knowing anything about the language, which is
 * the same rule the knowledge-retrieval gate now follows. The catalog branch
 * requires the stored product name (or its Amharic name) to appear in the
 * message: precise, but it does not survive Amharic inflection ("ሰማያዊ" vs
 * "ሰማያዊው"). That is a deliberate trade — quoting the WRONG product's price is
 * worse than a holding reply. The payment branch is an English keyword proxy, so
 * it can only ADD an answer where a holding reply would otherwise go out; it can
 * never remove a correct one.
 */

function norm(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Mirrors answersSimilar() in replyEngine: exact, or one clearly contains the
// other. The 20-char floor on both sides stops a short stub matching half the
// inbox — a customer message that merely CONTAINS a stored question (for
// example "hi, how much is delivery?") still matches the longer one.
function similar(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 20 && y.length >= 20 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

const PAYMENT_ASK_RE = /\b(account|bank|telebirr|cbe|pay|payment|transfer)\b/i;

/**
 * Pick a customer-ready answer out of local data, or null if nothing fits.
 *
 * @param {object}   args
 * @param {string}   args.text           the customer's inbound message
 * @param {object[]} [args.faqs]         {question, answer} pairs the owner taught
 * @param {object[]} [args.products]     {name, name_am, price, currency}
 * @param {string[]} [args.paymentLines] configured payment lines (shared verbatim)
 * @returns {string|null}
 */
export function pickLocalFallback({ text, faqs = [], products = [], paymentLines = [] } = {}) {
  const msg = (text || '').trim();
  // Over-long input is a paste/forward, not a question we can match safely.
  if (!msg || msg.length > 400) return null;

  // 1) An owner-taught FAQ — their own words, so language and detail are right.
  for (const f of faqs) {
    if (!f?.question || !f?.answer) continue;
    if (similar(f.question, msg)) return String(f.answer).trim();
  }

  const lower = msg.toLowerCase();

  // 2) A catalog price — the most common "obvious" question there is. Matched
  //    on the whole stored name, never a single word of it: "blue" alone must
  //    not match "Blue Tote" and quote a price for the wrong product.
  for (const p of products) {
    const names = [p?.name, p?.name_am]
      .filter(Boolean)
      .map(n => String(n).toLowerCase().trim())
      .filter(n => n.length > 2);
    if (!names.length || !names.some(n => lower.includes(n))) continue;
    if (p.price == null || p.price === '') continue;
    return `${p.name} — ${p.price} ${p.currency || 'ETB'}`;
  }

  // 3) Payment details, only when payment is what they actually asked about.
  if (PAYMENT_ASK_RE.test(msg) && paymentLines.length) {
    return paymentLines.join('\n');
  }

  return null;
}
