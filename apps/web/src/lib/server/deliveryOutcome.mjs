/** A lost response is not proof that the provider rejected a send. */
export async function observeDelivery(send, { timeoutMs = 15000 } = {}) {
  let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(send),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('delivery response timed out')), timeoutMs);
      }),
    ]);
    if (response?.ok === true) {
      return { ok: true, outcome: 'sent', message_id: response.result?.message_id ?? null };
    }
    if (response?.ok === false) {
      return { ok: false, outcome: 'rejected', error: response.description || 'provider rejected delivery' };
    }
    return { ok: false, outcome: 'unknown', error: 'provider returned no delivery confirmation' };
  } catch (error) {
    return { ok: false, outcome: 'unknown', error: error?.message || 'delivery response unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
