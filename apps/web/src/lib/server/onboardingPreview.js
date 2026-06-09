/**
 * Tiny in-memory store binding a preview question/draft pair to a short-lived
 * token. Both /api/onboarding/preview (mints) and /api/onboarding/edit-reply
 * (reads) live in this same Lambda instance during a typical onboarding session,
 * so an in-process Map is sufficient and avoids a DB round-trip per turn.
 *
 * Across cold starts the token expires; the client just re-asks the question —
 * harmless. 10-minute TTL covers any reasonable Try-It session.
 */
import crypto from 'node:crypto';

const PREVIEW_TTL_MS = 10 * 60 * 1000;

// Module-scoped Map kept on globalThis so HMR + nested route imports share one.
const sessions = (globalThis.__minime_preview_sessions__ ||= new Map());

export function storePreviewSession(tgId, payload) {
  const token = crypto.randomUUID();
  sessions.set(token, { ...payload, owner_tg_id: tgId, expires_at: Date.now() + PREVIEW_TTL_MS });
  // Lazy sweep — bounded by however many previews this instance has seen.
  if (sessions.size > 1000) {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires_at < now) sessions.delete(k);
  }
  return token;
}

export function getPreviewSession(token, tgId) {
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) { sessions.delete(token); return null; }
  if (s.owner_tg_id !== tgId) return null;                  // never cross owners
  return s;
}
