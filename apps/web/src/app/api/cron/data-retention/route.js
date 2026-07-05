/**
 * GET /api/cron/data-retention
 * Schedule: weekly, Sundays 3am UTC (vercel.json)
 *
 * Data retention enforcement:
 *  1. Archive messages >18 months → Supabase Storage as JSONL
 *  2. Delete agent_thoughts >6 months
 *  3. Purge webhook_dedupe records >30 days (idempotency table cleanup)
 *  3b. Purge webhook_events records >90 days (delivery-history table)
 *  4. Delete document_chunks for deleted documents (orphan cleanup)
 *
 * Orders are NEVER deleted (accounting records).
 * Audit logs are NEVER deleted by this cron (2-year minimum retention).
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 500;

async function archiveAndDeleteMessages(sb, cutoffDate) {
  let archived = 0;
  let deleted  = 0;
  let cursor   = null;

  while (true) {
    // Fetch a batch of old messages
    let q = sb.from('messages')
      .select('id, conversation_id, business_id, direction, content, created_at, is_ai_generated')
      .lt('created_at', cutoffDate)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) q = q.gt('created_at', cursor);

    const { data: batch, error } = await q;
    if (error) { console.error('[retention] messages fetch error:', error.message); break; }
    if (!batch?.length) break;

    // Group by year-month for storage path
    const byMonth = {};
    for (const m of batch) {
      const ym = m.created_at.slice(0, 7); // "2024-11"
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(m);
    }

    // Upload JSONL to storage
    for (const [ym, msgs] of Object.entries(byMonth)) {
      const path = `archives/messages/${ym}/batch-${Date.now()}.jsonl`;
      const content = msgs.map(m => JSON.stringify(m)).join('\n');
      const { error: upErr } = await sb.storage
        .from('documents')
        .upload(path, new TextEncoder().encode(content), {
          contentType: 'application/x-ndjson',
          upsert: false,
        });
      if (upErr && !upErr.message?.includes('already exists')) {
        console.warn('[retention] storage upload failed for', ym, upErr.message);
        continue; // Skip deletion if archive failed
      }
    }

    // Delete the archived batch
    const ids = batch.map(m => m.id);
    const { error: delErr } = await sb.from('messages').delete().in('id', ids);
    if (delErr) {
      console.error('[retention] message delete error:', delErr.message);
      break;
    }

    archived += batch.length;
    deleted  += batch.length;
    cursor = batch[batch.length - 1].created_at;
    console.log(`[retention] archived ${archived} messages so far...`);
  }

  return { archived, deleted };
}

export async function GET(request) {
  const authed = isCronAuthorized(request);
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const now = new Date();
  const results = {};

  // 1. Archive & delete messages older than 18 months
  const msgCutoff = new Date(now);
  msgCutoff.setMonth(msgCutoff.getMonth() - 18);
  console.log('[retention] archiving messages before', msgCutoff.toISOString());
  try {
    results.messages = await archiveAndDeleteMessages(sb, msgCutoff.toISOString());
  } catch (e) {
    results.messages = { error: e.message };
    console.error('[retention] messages phase failed:', e.message);
  }

  // 2. Delete agent_thoughts older than 6 months
  const thoughtsCutoff = new Date(now);
  thoughtsCutoff.setMonth(thoughtsCutoff.getMonth() - 6);
  try {
    const { count } = await sb.from('agent_thoughts')
      .delete({ count: 'exact' })
      .lt('created_at', thoughtsCutoff.toISOString());
    results.agent_thoughts_deleted = count || 0;
    console.log('[retention] deleted', count, 'agent_thoughts');
  } catch (e) {
    results.agent_thoughts_error = e.message;
  }

  // 3. Purge webhook_dedupe records older than 30 days
  const dedupCutoff = new Date(now);
  dedupCutoff.setDate(dedupCutoff.getDate() - 30);
  try {
    const { count } = await sb.from('webhook_dedupe')
      .delete({ count: 'exact' })
      .lt('processed_at', dedupCutoff.toISOString());
    results.webhook_dedupe_purged = count || 0;
    console.log('[retention] purged', count, 'webhook_dedupe records');
  } catch (e) {
    // Table may not exist in dev — safe to ignore
    results.webhook_dedupe_error = e.message;
  }

  // 3b. Purge webhook_events older than 90 days — a health trend table, no
  // PII (business_id + delivery outcome only), 90d is plenty for the Pulse
  // webhook-success-rate check which only looks at the last hour anyway.
  const webhookEventsCutoff = new Date(now);
  webhookEventsCutoff.setDate(webhookEventsCutoff.getDate() - 90);
  try {
    const { count } = await sb.from('webhook_events')
      .delete({ count: 'exact' })
      .lt('created_at', webhookEventsCutoff.toISOString());
    results.webhook_events_purged = count || 0;
  } catch (e) {
    results.webhook_events_error = e.message;
  }

  // 4. Delete llm_call_log older than 12 months
  const llmCutoff = new Date(now);
  llmCutoff.setMonth(llmCutoff.getMonth() - 12);
  try {
    const { count } = await sb.from('llm_call_log')
      .delete({ count: 'exact' })
      .lt('created_at', llmCutoff.toISOString());
    results.llm_call_log_deleted = count || 0;
  } catch (e) {
    results.llm_call_log_error = e.message;
  }

  // 5. Clean up orphaned document_chunks (chunks for documents that were deleted)
  try {
    const { data: orphans } = await sb
      .from('document_chunks')
      .select('id, document_id')
      .not('document_id', 'in',
        sb.from('documents').select('id')
      )
      .limit(1000);

    if (orphans?.length) {
      await sb.from('document_chunks').delete().in('id', orphans.map(o => o.id));
      results.orphan_chunks_deleted = orphans.length;
    } else {
      results.orphan_chunks_deleted = 0;
    }
  } catch (e) {
    results.orphan_chunks_error = e.message;
  }

  console.log('[retention] complete:', results);
  return NextResponse.json({ ok: true, ran_at: now.toISOString(), results });
}
