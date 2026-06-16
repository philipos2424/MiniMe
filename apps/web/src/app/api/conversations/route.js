/**
 * GET /api/conversations — paginated conversation list for the dashboard inbox.
 *
 * ?filter=all|drafts|unread   ?offset=N   (page size 30)
 *
 * Returns conversations (with joined customer) enriched with a last-message
 * preview and last file attachment, matching what the inbox needs to render —
 * the same enrichment the page used to do over the anon client, now server-side
 * with the service role and scoped to the caller's business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'all';
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);

  const sb = supabase();
  let q = sb.from('conversations').select('*, customers(*)')
    .eq('business_id', business.id)
    .order('last_message_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (filter === 'drafts') q = q.eq('requires_owner', true).eq('last_ai_action', 'drafted');
  if (filter === 'unread') q = q.eq('requires_owner', true);

  const { data: convs } = await q;
  if (!convs?.length) {
    return NextResponse.json({ conversations: [], has_more: false });
  }

  const ids = convs.map(c => c.id);
  const [{ data: lastMsgs }, { data: fileMsgs }] = await Promise.all([
    sb.from('messages')
      .select('conversation_id, content, direction, file_url, media_url, file_type, media_type')
      .eq('business_id', business.id)
      .in('conversation_id', ids)
      .in('status', ['sent', 'drafted', 'approved'])
      .order('created_at', { ascending: false })
      .limit(ids.length * 3),
    sb.from('messages')
      .select('conversation_id, file_url, file_type, media_url, media_type')
      .eq('business_id', business.id)
      .in('conversation_id', ids)
      .or('file_url.neq.null,media_url.neq.null')
      .order('created_at', { ascending: false })
      .limit(ids.length * 2),
  ]);

  const lastMsgMap = {};
  for (const m of lastMsgs || []) { if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m; }
  const fileMap = {};
  for (const m of fileMsgs || []) { if (!fileMap[m.conversation_id]) fileMap[m.conversation_id] = m; }

  const conversations = convs.map(c => {
    const lm = lastMsgMap[c.id];
    const hasFile = !!(fileMap[c.id]?.file_url || fileMap[c.id]?.media_url);
    return {
      ...c,
      last_file_url:  hasFile ? (fileMap[c.id]?.file_url || fileMap[c.id]?.media_url) : null,
      last_file_type: hasFile ? (fileMap[c.id]?.file_type || fileMap[c.id]?.media_type) : null,
      last_preview:   lm?.content || null,
      last_direction: lm?.direction || null,
    };
  });

  return NextResponse.json({ conversations, has_more: convs.length === PAGE_SIZE });
}
