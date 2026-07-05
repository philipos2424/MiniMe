/**
 * GET  /api/admin/businesses/bulk-activate-trials — dry-run: how many
 *      businesses are currently on subscription_status='trial', + a preview.
 * POST /api/admin/businesses/bulk-activate-trials — executes: moves every
 *      one of those businesses to active Pro for 30 days, for free (comp).
 *
 * Deliberately a two-step flow (GET preview, then explicit POST) — this is a
 * bulk revenue-affecting action with real blast radius, so it never fires
 * blind off a single click. One atomic UPDATE, audit-logged with the count.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { isAdmin } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';
import { sendTrialActivatedMessage } from '../../../../../lib/server/trialActivation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function GET(request) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await supabase()
    .from('businesses')
    .select('id, name')
    .eq('subscription_status', 'trial');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    count: (data || []).length,
    sample: (data || []).slice(0, 8).map(b => b.name),
  });
}

export async function POST(request) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

  // Single atomic UPDATE — same payload as the individual "Activate Pro
  // +30d" button, applied to every current trial at once.
  const { data, error } = await sb
    .from('businesses')
    .update({ subscription_status: 'active', plan_tier: 'pro', subscription_expires_at: expiresAt })
    .eq('subscription_status', 'trial')
    .select('id, name, owner_telegram_id, owner_private_chat_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const activated = data || [];

  // Confirmation DM to every activated owner — best-effort, never blocks the
  // response on a slow/blocked recipient. sendTelegramMessage already handles
  // 429 flood-waits internally per send.
  const notifyResults = await Promise.allSettled(
    activated.map(b => sendTrialActivatedMessage(b, { planTier: 'pro', expiresAt })));
  const notified = notifyResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;

  await audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.bulk_trials_activated',
    resource_type: 'business',
    metadata: { activated: activated.length, notified, subscription_expires_at: expiresAt },
    request,
  });

  return NextResponse.json({ ok: true, activated: activated.length, notified });
}
