/**
 * GET  /api/admin/bulk-channel-import — preview: how many businesses have a
 *      connected Telegram channel but a thin catalog (<3 active products).
 * POST /api/admin/bulk-channel-import — runs importChannelBackCatalog for up
 *      to 15 of them per call.
 *
 * Reuses lib/server/channelBackfill.js's importChannelBackCatalog exactly as
 * the owner-facing one-at-a-time route does (api/settings/channel/import) —
 * it's already idempotent (de-dupes by product name), so re-running is safe.
 * Self-draining: a successful import raises the business's product count
 * past the <3 threshold, so it naturally drops out of the next call's query
 * — tap "run" again until processed:0, same UX as the embeddings sync button.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { importChannelBackCatalog } from '../../../../lib/server/channelBackfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PRODUCT_THRESHOLD = 3;
const BATCH_SIZE = 15;

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

/** Businesses with a connected channel and fewer than PRODUCT_THRESHOLD active products. */
async function findEligible(sb) {
  const [{ data: channelBiz }, { data: prodRows }] = await Promise.all([
    fetchAllRows(() => sb.from('businesses')
      .select('id, name, source_channel_username')
      .not('source_channel_username', 'is', null)
      .order('created_at', { ascending: true })),
    fetchAllRows(() => sb.from('products').select('business_id').eq('is_active', true)),
  ]);
  const counts = {};
  for (const p of prodRows || []) counts[p.business_id] = (counts[p.business_id] || 0) + 1;
  return (channelBiz || []).filter(b => (counts[b.id] || 0) < PRODUCT_THRESHOLD);
}

export async function GET(request) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const eligible = await findEligible(supabase());
  return NextResponse.json({ count: eligible.length, sample: eligible.slice(0, 8).map(b => b.name) });
}

export async function POST(request) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const eligible = await findEligible(sb);
  const batch = eligible.slice(0, BATCH_SIZE);

  let totalAdded = 0;
  let totalUpdated = 0;
  const failures = [];

  for (const biz of batch) {
    try {
      const result = await importChannelBackCatalog({ business: biz, username: biz.source_channel_username });
      if (!result.ok) {
        failures.push({ name: biz.name, reason: result.reason });
        continue;
      }
      totalAdded += result.added;
      totalUpdated += result.updated;
    } catch (e) {
      failures.push({ name: biz.name, reason: e.message });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: batch.length,
    remaining: Math.max(0, eligible.length - batch.length),
    totalAdded,
    totalUpdated,
    failures,
  });
}
