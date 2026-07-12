/**
 * POST /api/admin/sync-search-embeddings — on-demand embedding backfill.
 *
 * Same underlying batch as the daily cron, but admin-gated instead of
 * CRON_SECRET-gated, so the founder can catch up search coverage themselves
 * from the Pulse dashboard anytime instead of asking someone to curl the
 * cron endpoint with a secret.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { runEmbeddingBackfillBatch } from '../../../../lib/server/embeddingBackfill';
import { runProductEmbeddingBackfillBatch } from '../../../../lib/server/productEmbeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [businesses, products] = await Promise.all([
    runEmbeddingBackfillBatch({ limit: 150 }),
    runProductEmbeddingBackfillBatch({ limit: 300 }),
  ]);
  return NextResponse.json({
    ok: true,
    processed: (businesses.processed || 0) + (products.processed || 0),
    failed: (businesses.failed || 0) + (products.failed || 0),
    businesses,
    products,
  });
}
