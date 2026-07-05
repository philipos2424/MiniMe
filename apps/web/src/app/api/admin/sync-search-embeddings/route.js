/**
 * POST /api/admin/sync-search-embeddings — on-demand embedding backfill.
 *
 * Same underlying batch as the daily cron, but admin-gated instead of
 * CRON_SECRET-gated, so the founder can catch up search coverage themselves
 * from the Pulse dashboard anytime instead of asking someone to curl the
 * cron endpoint with a secret.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { runEmbeddingBackfillBatch } from '../../../../lib/server/embeddingBackfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await runEmbeddingBackfillBatch({ limit: 150 });
  return NextResponse.json(result);
}
