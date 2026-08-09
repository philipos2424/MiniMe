/**
 * GET  /api/admin/settings — current platform settings (secrets masked)
 * PUT  /api/admin/settings — save them
 *
 * Lets the person who owns the bank account edit where money goes, without a
 * redeploy or Vercel access. Admin only.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { describeSettings, saveSettings } from '../../../../lib/server/platformSettings';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  return NextResponse.json(
    { ok: true, settings: await describeSettings() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PUT(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const entries = body?.settings;
  if (!entries || typeof entries !== 'object') {
    return NextResponse.json({ error: 'settings object required' }, { status: 400 });
  }

  try {
    const result = await saveSettings(entries, admin.id);

    // Audit the KEYS only. Logging values would put the bank account — and,
    // for the gateway rows, a live API key — into the audit trail in clear.
    await audit({
      // audit_logs has a CHECK constraint on actor_type
      // ('owner','staff','platform_admin','system','customer'). 'admin' is not
      // in it, so every one of these inserts was rejected and swallowed by the
      // .catch below — changes to where the platform's money goes were silently
      // not being recorded at all.
      actor_type: 'platform_admin',
      actor_id: String(admin.id),
      action: 'platform_settings.update',
      resource_type: 'platform_settings',
      metadata: { keys: Object.keys(entries), ...result },
      request,
    }).catch(() => {});

    return NextResponse.json({ ok: true, ...result, settings: await describeSettings() });
  } catch (e) {
    console.error('[admin/settings] save failed:', e.message);
    return NextResponse.json({ error: e.message || 'save failed' }, { status: 500 });
  }
}
