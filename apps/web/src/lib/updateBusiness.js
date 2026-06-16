/**
 * Browser-side helper for writing to the `businesses` table.
 *
 * Replaces direct `supabase.from('businesses').update(...).eq('id', biz.id)`
 * calls — those would bypass our pre-launch RLS hardening. ALL business
 * writes from the UI MUST go through this helper so the server-side
 * /api/business/update endpoint enforces auth + field whitelist.
 *
 * Usage:
 *   await updateBusiness(initData, { panic_mode: true });
 *
 * Returns the updated business on success; throws Error on failure so the
 * caller can show an error toast.
 */
export async function updateBusiness(initData, updates) {
  // Dev-only preview mode: skip the network round-trip so toggles respond
  // instantly while clicking through the UI without a real Telegram token.
  // Inlined at build time; dead/false in any normal build.
  if (process.env.NEXT_PUBLIC_MOCK_TELEGRAM_AUTH === '1') {
    return { ...(updates || {}) };
  }
  if (!initData) throw new Error('Missing auth');
  if (!updates || typeof updates !== 'object') throw new Error('Missing updates');

  const r = await fetch('/api/business/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
    body: JSON.stringify({ updates }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'update_failed');
  return j.business;
}
