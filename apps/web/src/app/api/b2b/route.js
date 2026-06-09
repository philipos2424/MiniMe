/**
 * GET  /api/b2b?tab=inbox|sent  — list threads for the current owner's business
 * POST /api/b2b                  — actions: { action: 'send'|'reply'|'decline'|'block', ... }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import {
  findBusinessByUsername, sendBusinessMessage, recordReply, recordDecline,
  blockSender, listInbox, listOutbox, getThread, unreadCount, bizLabel,
  browseNetwork, sendWarmIntro,
} from '../../../lib/server/b2b';
import { startCampaign, listCampaigns, getCampaign, cancelCampaign, synthesizeAndDeliver } from '../../../lib/server/research';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const business = await findBusinessForUser(tg.id);
  if (!business) return { error: NextResponse.json({ error: 'no_business' }, { status: 404 }) };
  return { tg, business };
}

export async function GET(request) {
  const { error, business } = await authBusiness(request);
  if (error) return error;
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') || 'inbox';
  const threadId = url.searchParams.get('thread');

  if (threadId) {
    const messages = await getThread(threadId, business.id);
    return NextResponse.json({ thread_id: threadId, messages });
  }

  const limit  = Number(url.searchParams.get('limit')  || 50);
  const offset = Number(url.searchParams.get('offset') || 0);

  if (tab === 'sent') {
    const items = await listOutbox(business.id, { limit, offset });
    return NextResponse.json({ tab: 'sent', items });
  }
  if (tab === 'research') {
    const campaignId = url.searchParams.get('id');
    // On-demand sweep: process any of this business's stale open campaigns now
    // (we run a daily cron globally, but this gives instant report when the
    // owner opens the page — no waiting up to 24h for the global sweep).
    try {
      const sb = supabase();
      const { data: stale } = await sb.from('research_campaigns')
        .select('id')
        .eq('business_id', business.id)
        .eq('status', 'open')
        .lt('expires_at', new Date().toISOString())
        .limit(10);
      for (const s of stale || []) {
        synthesizeAndDeliver(s.id).catch(() => {});
      }
    } catch {}

    if (campaignId) {
      const campaign = await getCampaign(campaignId, business.id);
      if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      return NextResponse.json({ tab: 'research', campaign });
    }
    const items = await listCampaigns(business.id, { limit });
    return NextResponse.json({ tab: 'research', items });
  }

  if (tab === 'deals') {
    // Threads where a deal was agreed (either side)
    const sb = supabase();
    const { data } = await sb.from('business_messages')
      .select('*, sender:businesses!sender_id(id,name,telegram_bot_username), recipient:businesses!recipient_id(id,name,telegram_bot_username)')
      .or(`sender_id.eq.${business.id},recipient_id.eq.${business.id}`)
      .eq('thread_status', 'agreed')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    return NextResponse.json({ tab: 'deals', items: data || [] });
  }
  if (tab === 'browse') {
    const category = url.searchParams.get('category') || '';
    const q        = url.searchParams.get('q') || '';
    const items = await browseNetwork({ category: category || undefined, query: q || undefined, excludeId: business.id, limit });
    return NextResponse.json({ tab: 'browse', items });
  }

  const items = await listInbox(business.id, { limit, offset });
  const unread = await unreadCount(business.id);
  return NextResponse.json({ tab: 'inbox', items, unread });
}

export async function POST(request) {
  const { error, tg: tgUser, business } = await authBusiness(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const action = body.action;

  if (action === 'send') {
    const target = String(body.target_username || '').trim();
    const message = String(body.message || '').trim();
    if (!target || !message) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const recipientBiz = await findBusinessByUsername(target);
    if (!recipientBiz) {
      return NextResponse.json({ error: 'not_on_minime', message: `@${target.replace(/^@/,'')} isn't on MiniMe.`, target }, { status: 404 });
    }
    const res = await sendBusinessMessage({
      senderBiz: business,
      recipientBiz,
      initiatedBy: tgUser.id,
      intent: body.intent || 'inquiry',
      content: message,
      structured: body.structured || {},
    });
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    return NextResponse.json({ ok: true, thread_id: res.threadId, recipient: bizLabel(recipientBiz) });
  }

  if (action === 'connect') {
    const targetUsername = String(body.target_username || '').trim();
    if (!targetUsername) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const targetBiz = await findBusinessByUsername(targetUsername);
    if (!targetBiz) return NextResponse.json({ error: 'not_on_minime' }, { status: 404 });
    const res = await sendWarmIntro({
      requesterBiz: business,
      targetBiz,
      campaignQuery: body.context || 'your inquiry',
      note: body.note,
    });
    return NextResponse.json(res);
  }

  if (action === 'reply') {
    const msgId = body.original_msg_id;
    const content = String(body.content || '').trim();
    if (!msgId || !content) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    // Confirm the original message is to me (recipient)
    const sb = supabase();
    const { data: orig } = await sb.from('business_messages').select('recipient_id, sender_id').eq('id', msgId).maybeSingle();
    if (!orig || orig.recipient_id !== business.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const res = await recordReply({ originalMsgId: msgId, content, byAi: false, replierTgId: tgUser.id });
    return NextResponse.json(res);
  }

  if (action === 'decline') {
    const msgId = body.msg_id;
    if (!msgId) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const sb = supabase();
    const { data: orig } = await sb.from('business_messages').select('recipient_id').eq('id', msgId).maybeSingle();
    if (!orig || orig.recipient_id !== business.id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const res = await recordDecline(msgId, body.reason);
    return NextResponse.json(res);
  }

  if (action === 'block') {
    const initiatedBy = body.initiated_by;
    if (!initiatedBy) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const res = await blockSender(business.id, initiatedBy);
    return NextResponse.json(res);
  }

  if (action === 'start_research') {
    const query = String(body.query || '').trim();
    if (!query) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const res = await startCampaign({
      business,
      ownerTgId:  tgUser.id,
      query,
      category:   body.category,
      budget:     body.budget,
      maxTargets: body.max_targets,
      questions:  body.questions,
    });
    return NextResponse.json(res);
  }

  if (action === 'cancel_campaign') {
    if (!body.campaign_id) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const res = await cancelCampaign(body.campaign_id, business.id);
    return NextResponse.json(res);
  }

  if (action === 'set_auto_negotiate') {
    const sb = supabase();
    await sb.from('businesses')
      .update({ b2b_auto_negotiate: !!body.enabled })
      .eq('id', business.id);
    return NextResponse.json({ ok: true, b2b_auto_negotiate: !!body.enabled });
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
