/**
 * Browser-side authenticated API helpers.
 *
 * The dashboard runs on the Supabase ANON key, which (after the pre-launch RLS
 * lockdown) can no longer read or write the tenant tables directly. ALL data
 * access from the UI must go through server routes that verify Telegram initData
 * and scope every query to the caller's own business.
 *
 * These helpers attach the Telegram initData header and unwrap JSON / errors so
 * call sites stay terse:
 *
 *   const { products } = await apiGet('/api/products?status=all', initData);
 *   await apiSend('POST', '/api/products', initData, { product });
 */

export async function apiGet(path, initData) {
  if (!initData) throw new Error('Missing auth');
  const r = await fetch(path, {
    headers: { 'x-telegram-init-data': initData },
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `GET ${path} failed`);
  return j;
}

export async function apiSend(method, path, initData, body) {
  if (!initData) throw new Error('Missing auth');
  const r = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${method} ${path} failed`);
  return j;
}
