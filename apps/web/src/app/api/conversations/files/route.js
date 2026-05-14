/**
 * GET /api/conversations/files
 * Returns all file attachments sent by clients (inbound) for the owner's business.
 * Used by Team > Files tab so team members can access client-sent files.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  // Get inbound messages with file attachments for this business
  const { data: msgs } = await sb.from('messages')
    .select(`
      id, created_at, file_url, file_type, file_name, media_url, media_type, media_filename,
      direction, conversation_id,
      conversations(customer_id, customers(name, telegram_username))
    `)
    .eq('business_id', business.id)
    .eq('direction', 'inbound')
    .or('file_url.neq.null,media_url.neq.null')
    .order('created_at', { ascending: false })
    .limit(100);

  const files = (msgs || []).map(m => ({
    id: m.id,
    created_at: m.created_at,
    file_url:   m.file_url  || m.media_url  || null,
    file_type:  m.file_type || m.media_type || null,
    file_name:  m.file_name || m.media_filename || null,
    conversation_id: m.conversation_id,
    customer_name: m.conversations?.customers?.name
      || (m.conversations?.customers?.telegram_username ? `@${m.conversations.customers.telegram_username}` : 'Client'),
  }));

  return NextResponse.json({ files });
}
