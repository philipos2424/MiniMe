/**
 * GET /api/admin/auth/session — who am I?
 * Used by /admin to decide between Telegram initData and cookie session.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({
    admin: { id: admin.id, username: admin.username || null, via: admin.via },
  });
}
