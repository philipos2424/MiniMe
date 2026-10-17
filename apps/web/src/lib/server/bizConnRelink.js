/**
 * Self-heal for Secretary messages that arrive on a business connection no
 * shop has stored.
 *
 * The link (businesses.telegram_biz_conn_id) is written only when Telegram
 * sends the business_connection event, and only if the owner's shop already
 * exists then. An owner who connects first and sets up the shop later, or
 * whose event was missed, never gets linked, and every customer message on
 * their personal account was dropped with "no business for conn_id"
 * (~100 messages from ~30 connections in 25 minutes on 2026-10-17).
 *
 * Telegram can say who owns a connection (getBusinessConnection), so on an
 * unknown id: ask, find that owner's shop, store the id, carry on. Owners
 * with no shop are remembered for a while per instance so a busy personal
 * account doesn't cost a Telegram call per message.
 */

export const NEGATIVE_TTL_MS = 10 * 60 * 1000;

/**
 * @param {object} deps
 * @param {(connId: string) => Promise<any>} deps.getConnection  Bot API getBusinessConnection result ({ ok, result })
 * @param {(ownerTelegramId: string) => Promise<any>} deps.findOwnerBusiness
 * @param {(businessId: string, connId: string) => Promise<void>} deps.storeConnId
 * @param {() => number} [deps.now]
 * @param {number} [deps.negativeTtlMs]
 */
export function makeBizConnRelinker({ getConnection, findOwnerBusiness, storeConnId, now = Date.now, negativeTtlMs = NEGATIVE_TTL_MS }) {
  const noShopUntil = new Map();

  return async function relink(connId) {
    if (!connId) return null;
    const key = String(connId);
    const until = noShopUntil.get(key);
    if (until && until > now()) return null;

    const res = await getConnection(key);
    const conn = res?.ok ? res.result : null;
    const ownerId = conn?.user?.id;
    // A disabled connection must not be relinked — the owner turned it off.
    // Transient Telegram failures (no ok) are not cached: try again next time.
    if (!res?.ok) return null;
    if (!ownerId || conn.is_enabled === false) {
      noShopUntil.set(key, now() + negativeTtlMs);
      return null;
    }

    const business = await findOwnerBusiness(String(ownerId));
    if (!business) {
      noShopUntil.set(key, now() + negativeTtlMs);
      return null;
    }
    await storeConnId(business.id, key);
    noShopUntil.delete(key);
    return { ...business, telegram_biz_conn_id: key };
  };
}
