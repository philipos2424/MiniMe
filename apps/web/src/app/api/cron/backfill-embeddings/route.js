/**
 * GET /api/cron/backfill-embeddings
 *
 * Generates search embeddings for businesses that don't have one yet.
 * Runs daily — once all businesses have embeddings, it's a no-op.
 *
 * Batch bumped 20 -> 100: at current signup volume a small daily batch was
 * falling behind, leaving newly-discoverable businesses unfindable in search
 * for days. Embedding calls are cheap/fast, well within the 300s budget.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { runEmbeddingBackfillBatch } from '../../../../lib/server/embeddingBackfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 100;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runEmbeddingBackfillBatch({ limit: BATCH_SIZE });
  return NextResponse.json(result);
}
