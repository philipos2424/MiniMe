/** POST /api/admin/auth/logout — clear the browser admin session cookie. */
import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '../../../../../lib/server/adminSession';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/',
  });
  return res;
}
