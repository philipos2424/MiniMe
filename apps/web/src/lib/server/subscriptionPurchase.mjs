// Only server-priced monthly/yearly purchases may reach a payment provider.
export function validateSubscriptionPurchase(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const { plan = 'pro', method = 'chapa', durationMonths = 1 } = body;
  return plan === 'pro'
    && ['stripe', 'paypal', 'chapa', 'telebirr', 'telebirr_manual', 'bank', 'cbe', 'cbe_manual'].includes(method)
    && Number.isInteger(durationMonths) && [1, 12].includes(durationMonths)
    && (durationMonths === 1 || ['stripe', 'chapa'].includes(method));
}

export function verifiedPurchasePayment(provider, body) {
  if (provider === 'stripe') {
    const session = body?.data?.object;
    if (body?.type !== 'checkout.session.completed' || session?.payment_status !== 'paid') return null;
    return {
      reference: session.metadata?.txRef,
      amountMinor: session.amount_total,
      currency: String(session.currency || '').toUpperCase(),
    };
  }
  if (provider === 'chapa' && body?.status === 'success'
      && (!body.event || body.event === 'charge.success')) {
    const amount = Number(body.amount);
    return {
      reference: body.tx_ref || body.reference,
      amountMinor: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null,
      currency: String(body.currency || '').toUpperCase(),
    };
  }
  return null;
}

export async function confirmChapaPayment(payment, apiKey, fetcher = fetch) {
  if (!apiKey || !payment?.reference) throw new Error('Chapa verification is not configured');
  const response = await fetcher(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(payment.reference)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Chapa verification is temporarily unavailable');
  const result = await response.json();
  const expectedMode = apiKey.includes('_TEST-') ? 'test' : 'live';
  if (result.status !== 'success' || result.data?.mode !== expectedMode) return null;
  const verified = verifiedPurchasePayment('chapa', result.data);
  if (!verified || verified.reference !== payment.reference
      || verified.amountMinor !== payment.amountMinor || verified.currency !== payment.currency) return null;
  return verified;
}

export function matchesPurchase(purchase, provider, payment) {
  return !!purchase && !!payment
    && purchase.provider === provider
    && purchase.reference === payment.reference
    && Number.isSafeInteger(payment.amountMinor) && payment.amountMinor > 0
    && purchase.amount_minor === payment.amountMinor
    && purchase.currency === payment.currency;
}
