/**
 * GET /api/conversations?filter=all|drafts|unread&offset=0
 *
 * The inbox list. ConversationsPage used to read `conversations` and `messages`
 * straight from the browser with the anon key, but anon holds no grants on
 * those tables (RLS on, no policies), so every read came back as a permission
 * error the page swallowed — a populated inbox rendered as "No conversations
 * yet". Reads now happen here under the service role, scoped to the business
 * the Telegram initData actually belongs to.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';
import { fetchConversationPage, PAGE_SIZE } from '../../../lib/server/conversationList.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILTERS = new Set(['all', 'drafts', 'unread']);

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const filter = FILTERS.has(params.get('filter')) ? params.get('filter') : 'all';
  const rawOffset = Number.parseInt(params.get('offset') || '0', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  try {
    const page = await fetchConversationPage(supabase(), {
      businessId: business.id,
      filter,
      offset,
      limit: PAGE_SIZE,
    });
    return NextResponse.json(page);
  } catch (error) {
    console.error('[/api/conversations] query failed:', error);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }
}
