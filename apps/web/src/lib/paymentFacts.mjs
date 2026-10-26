/**
 * Payment details come only from Settings → Payments (paymentInfoLines in
 * replyEngine). Learned owner facts sometimes capture an account or phone
 * number ("My Telebirr is 0911…"), and one live shop's facts held a Telebirr
 * number different from the one in Payments, so MiniMe could have told a
 * customer to pay the wrong number. Any fact that pairs a payment word with an
 * account-length number is kept out of prompts and out of storage.
 */
const PAYMENT_WORD = /\b(telebirr|tele\s*birr|cbe|bank|account|acct|a\/c|m-?pesa|mpesa|awash|dashen|abyssinia|boa|coop|chapa|pay(ment)?|transfer|deposit|iban|swift)\b|ቴሌብር|ባንክ|አካውንት|ሂሳብ/i;
const ACCOUNT_NUMBER = /(?:\+?\d[\s-]?){6,}/;

export function isPaymentDetailFact(fact) {
  const s = String(fact || '');
  return PAYMENT_WORD.test(s) && ACCOUNT_NUMBER.test(s);
}

export function withoutPaymentDetails(facts) {
  return (Array.isArray(facts) ? facts : []).filter(f => typeof f === 'string' && !isPaymentDetailFact(f));
}
