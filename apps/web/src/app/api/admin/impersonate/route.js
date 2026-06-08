/**
 * POST /api/admin/impersonate
 * Body: { business_id, duration_mins? }
 *
 * Creates a short-lived signed token that lets a platform admin view a
 * business's dashboard as if they were the owner.
 *
 * Security:
 *  - Only callable by platform admins (verified via initData)
 *  - Token is HS256 JWT signed with IMPERSONATE_SECRET env var
 *  - Default 30-minute expiry (max 120 minutes)
 *  - Every start + end is written to audit_logs
 *  - The impersonated dashboard shows a visible warning banner
 *
 * DELETE /api/admin/impersonate — end the impersonation session
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import crypto from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DURATION_MINS = 30;
const MAX_DURATION_MINS = 120;

export function signImpersonateToken(payload) {
  const secret = process.env.IMPERSONATE_SECRET;
  if (!secret) throw new Error('IMPERSONATE_SECRET env var not set');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig    = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyImpersonateToken(token) {
  const secret = process.env.IMPERSONATE_SECRET;
  if (!secret || !token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(sig.padEnd(Math.ceil(sig.length / 4) * 4, '='), 'base64');
    const expBuf = Buffer.from(expectedSig.padEnd(Math.ceil(expectedSig.length / 4) * 4, '='), 'base64');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return payload;
  } catch { return null; }
}

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden — admin only' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { business_id, duration_mins } = body;
  if (!business_id || typeof business_id !== 'string') {
    return NextResponse.json({ error: 'business_id required' }, { status: 400 });
  }
  const dur = Math.min(Math.max(1, Number(duration_mins) || DEFAULT_DURATION_MINS), MAX_DURATION_MINS);

  if (!process.env.IMPERSONATE_SECRET) {
    return NextResponse.json({ error: 'IMPERSONATE_SECRET not configured on server' }, { status: 500 });
  }

  const sb = supabase();
  const { data: target } = await sb.from('businesses')
    .select('id, name, owner_telegram_id')
    .eq('id', business_id)
    .single();
  if (!target) return NextResponse.json({ error: 'business_not_found' }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'minime-admin',
    target_business_id: business_id,
    original_owner_id: target.owner_telegram_id,
    admin_tg_id: String(tg.id),
    iat: now,
    exp: now + dur * 60,
  };

  const token = signImpersonateToken(payload);

  await audit({
    business_id,
    actor_type: 'platform_admin',
    actor_id: String(tg.id),
    action: 'admin.impersonate_started',
    resource_type: 'business',
    resource_id: business_id,
    metadata: { business_name: target.name, duration_mins: dur },
    request,
  });

  return NextResponse.json({
    ok: true,
    token,
    business_name: target.name,
    expires_at: new Date((now + dur * 60) * 1000).toISOString(),
    duration_mins: dur,
  });
}

export async function DELETE(request) {
  const initData = request.headers.get('x-telegram-init-data');
  const impToken = request.headers.get('x-impersonate-token');
  const tg = initData ? parseTelegramUser(initData) : null;

  if (!isAdmin(tg?.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const payload = impToken ? verifyImpersonateToken(impToken) : null;
  if (payload?.target_business_id) {
    await audit({
      business_id: payload.target_business_id,
      actor_type: 'platform_admin',
      actor_id: String(tg?.id || payload.admin_tg_id || 'unknown'),
      action: 'admin.impersonate_ended',
      resource_type: 'business',
      resource_id: payload.target_business_id,
      metadata: {},
      request,
    });
  }

  return NextResponse.json({ ok: true });
}
