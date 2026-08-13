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
import { runProductEmbeddingBackfillBatch, runImageTagBackfillBatch } from '../../../../lib/server/productEmbeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 100;
const PRODUCT_BATCH_SIZE = 200;
// Small on purpose: a vision call costs meaningfully more per call than a
// batched text embedding, and this is a one-time historical catch-up (photos
// uploaded before image tagging shipped), not an ongoing hot path.
const IMAGE_TAG_BATCH_SIZE = 20;

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Image tagging runs after the other two: tagging a product nulls its
  // search_embedding (product_image_tags.sql trigger), so running it last
  // avoids racing a same-request re-embed — the next day's run picks it up.
  const [businesses, products] = await Promise.all([
    runEmbeddingBackfillBatch({ limit: BATCH_SIZE }),
    runProductEmbeddingBackfillBatch({ limit: PRODUCT_BATCH_SIZE }),
  ]);
  const imageTags = await runImageTagBackfillBatch({ limit: IMAGE_TAG_BATCH_SIZE });
  return NextResponse.json({ businesses, products, imageTags });
}
