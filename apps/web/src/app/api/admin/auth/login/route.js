/**
 * POST /api/admin/auth/login — browser login for the master admin.
 *
 * Body: the Telegram Login Widget payload
 *   { id, first_name, username?, photo_url?, auth_date, hash }
 * Verifies Telegram's HMAC (verifyLoginWidget), checks the admin allowlist,
 * then sets the HttpOnly mm_admin_session cookie. Failed attempts are
 * audited and rate-limited by IP.
 */
import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../../lib/server/admin';
import { mintAdminSession, verifyLoginWidget, COOKIE_NAME } from '../../../../../lib/server/adminSession';
import { rateLimit } from '../../../../../lib/server/rateLimit';
import { audit } from '../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'admin-login', 10, 300);
  if (!rl.ok) return NextResponse.json({ error: 'slow_down' }, { status: 429 });

  let body = {};
  try { body = await request.json(); } catch {}

  if (!verifyLoginWidget(body, process.env.TELEGRAM_BOT_TOKEN)) {
    audit({
      actor_type: 'admin', actor_id: String(body?.id || 'unknown'),
      action: 'admin.login_failed', metadata: { reason: 'bad_signature' }, request,
    }).catch(() => {});
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  if (!isAdmin(body.id)) {
    audit({
      actor_type: 'admin', actor_id: String(body.id),
      action: 'admin.login_failed', metadata: { reason: 'not_admin', username: body.username || null }, request,
    }).catch(() => {});
    return NextResponse.json({ error: 'not_admin' }, { status: 403 });
  }

  let token;
  try {
    token = mintAdminSession(body);
  } catch (e) {
    // ADMIN_SESSION_SECRET not configured — browser login unavailable.
    return NextResponse.json({ error: 'sessions_not_configured' }, { status: 500 });
  }

  audit({
    actor_type: 'admin', actor_id: String(body.id),
    action: 'admin.login', metadata: { username: body.username || null, via: 'login_widget' }, request,
  }).catch(() => {});

  const res = NextResponse.json({ ok: true, admin: { id: Number(body.id), username: body.username || null } });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 7 * 86400,
    path: '/',
  });
  return res;
}
