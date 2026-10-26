/**
 * The link an owner shares with customers (client-safe).
 *
 * The branded /shop/<code> page previews as the owner's business, which is
 * what we want — but only on a real domain. Served from a *.vercel.app preview
 * host it looks like phishing and breaks when the deployment changes, so until
 * NEXT_PUBLIC_APP_URL points at a real domain we use the same t.me deep link
 * every other surface (search, nudges, directory) already sends.
 */
const SHARED_BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || 'MiniMeAgentBot';

export function brandedWebBase(appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  const base = String(appUrl || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(base) || /\.vercel\.app$/i.test(base)) return null;
  return base;
}

export function customerShopLink(business, appUrl) {
  if (business?.telegram_bot_username) return `https://t.me/${business.telegram_bot_username}`;
  if (!business?.shop_code) return null;
  const web = brandedWebBase(appUrl);
  return web
    ? `${web}/shop/${business.shop_code}`
    : `https://t.me/${SHARED_BOT}?start=shop_${business.shop_code}`;
}
