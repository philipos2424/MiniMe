/**
 * Account restore — brings back a shop that was deleted, from the
 * deleted_business_backups vault (see /api/businesses/delete).
 *
 * GET  → { has_backup, original_name, deleted_at, expires_at } for the current
 *        owner. Drives the "Welcome back — restore your shop?" banner.
 * POST → re-hydrates the anonymized business row + core child records from the
 *        most recent non-expired backup, deletes the backup row, returns the
 *        restored business.
 *
 * OWNER-ONLY. Media files in Storage are not restored (DB records only).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { requireOwner } from '../../../../lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function authOwner(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return { error: 'unauthorized', status: 401 };
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return { error: 'unauthorized', status: 401 };
  if (!requireOwner(business, tg)) return { error: 'forbidden', status: 403 };
  return { tg, business };
}

// Most recent non-expired backup for this owner.
async function latestBackup(sb, ownerId) {
  const { data } = await sb
    .from('deleted_business_backups')
    .select('*')
    .eq('owner_telegram_id', ownerId)
    .gt('expires_at', new Date().toISOString())
    .order('deleted_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function GET(request) {
  const a = await authOwner(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const sb = supabase();
  const backup = await latestBackup(sb, a.tg.id);
  if (!backup) return NextResponse.json({ has_backup: false });
  return NextResponse.json({
    has_backup: true,
    original_name: backup.original_name,
    deleted_at: backup.deleted_at,
    expires_at: backup.expires_at,
  });
}

export async function POST(request) {
  const a = await authOwner(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const sb = supabase();
  const bid = a.business.id;

  const backup = await latestBackup(sb, a.tg.id);
  if (!backup) return NextResponse.json({ error: 'no_backup' }, { status: 404 });

  const snap = backup.snapshot || {};
  const snapBiz = snap.business || {};

  // Restore the business row (exclude identity/pk fields we shouldn't overwrite).
  const { id, created_at, owner_telegram_id, ...bizFields } = snapBiz;
  const bizUpdates = { ...bizFields, panic_mode: false };
  try {
    const { error } = await sb.from('businesses').update(bizUpdates).eq('id', bid);
    if (error) throw error;
  } catch (e) {
    console.error('[business.restore] business update failed:', e.message);
    return NextResponse.json({ error: 'restore_failed', detail: e.message }, { status: 500 });
  }

  // Re-hydrate child tables. Best effort per table — a failure on one must not
  // abort the rest. Rows carry their original ids, so re-insert as-is.
  const tables = snap.tables || {};
  const RESTORE_ORDER = [
    'customers', 'conversations', 'messages', 'customer_memory',
    'products', 'discounts', 'suppliers', 'documents', 'document_chunks',
    'agent_thoughts', 'orders',
  ];
  for (const t of RESTORE_ORDER) {
    const rows = tables[t];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    try {
      await sb.from(t).upsert(rows, { onConflict: 'id' });
    } catch (e) { console.warn(`[business.restore] restore ${t} failed:`, e.message); }
  }

  // Backup consumed — remove it so it can't be restored twice.
  try { await sb.from('deleted_business_backups').delete().eq('id', backup.id); } catch {}

  await audit({
    business_id: bid, actor_type: 'owner', actor_id: String(a.tg.id),
    action: 'business.restored', resource_type: 'business', resource_id: bid,
    metadata: { original_name: backup.original_name }, request,
  });

  const { data: restored } = await sb.from('businesses').select('*').eq('id', bid).single();
  return NextResponse.json({ ok: true, business: restored });
}
