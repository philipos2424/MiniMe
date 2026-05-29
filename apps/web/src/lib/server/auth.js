/**
 * Shared authorization helpers for API routes.
 *
 * authenticate(request)
 *   Verifies Telegram initData header and resolves the business + telegram user.
 *   Returns { business, tgUser } or null.
 *
 * requireOwner(business, tgUser)
 *   Returns true if tgUser is the literal owner of the business.
 *   Used to gate destructive operations away from sub-admins.
 *
 * isSubAdmin(business, tgUser)
 *   True when tgUser is in the sub-admin list (and is not the owner).
 */
import { verifyTelegramInitData, parseTelegramUser } from '../telegram';
import { findBusinessForUser } from './businesses';

/**
 * Authenticate the request from the Telegram Mini App.
 * Returns { business, tgUser } or null on failure.
 */
export async function authenticate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return null;
  }
  const tgUser = parseTelegramUser(initData);
  if (!tgUser?.id) return null;
  const business = await findBusinessForUser(tgUser.id);
  if (!business) return null;
  return { business, tgUser };
}

/**
 * Returns true if tgUser is the literal owner of the business.
 * Sub-admins return false even if they otherwise have access.
 */
export function requireOwner(business, tgUser) {
  return !!business && !!tgUser && Number(tgUser.id) === Number(business.owner_telegram_id);
}

/**
 * Returns true if tgUser is a sub-admin (not the owner) of the business.
 */
export function isSubAdmin(business, tgUser) {
  if (!business || !tgUser) return false;
  if (Number(tgUser.id) === Number(business.owner_telegram_id)) return false;
  const ids = Array.isArray(business.sub_admin_telegram_ids) ? business.sub_admin_telegram_ids : [];
  return ids.map(Number).includes(Number(tgUser.id));
}
