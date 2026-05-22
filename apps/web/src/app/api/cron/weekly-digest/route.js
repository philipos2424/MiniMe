/**
 * GET /api/cron/weekly-digest — Monday morning summary to every owner.
 * Scheduled at 05:00 UTC (08:00 Addis) every Monday via vercel.json.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { tg } from '../../../../lib/server/telegramApi';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed =
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const { data: businesses } = await sb.from('businesses')
    .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, shop_code, onboarding_completed, panic_mode, trust_level')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)');

  const summary = [];
  for (const business of businesses || []) {
    if (business.panic_mode) continue;
    const ownerChat = business.owner_private_chat_id || business.owner_telegram_id;
    if (!ownerChat) continue;
    let token;
    if (business.telegram_bot_token_enc) {
      try { token = decrypt(business.telegram_bot_token_enc); } catch { continue; }
    } else {
      if (!AGENT_TOKEN) continue;
      token = AGENT_TOKEN;
    }

    const [
      { data: msgs },
      { data: orders },
      { count: newCustomers },
      { data: openJobs },
      { data: learned },
    ] = await Promise.all([
      sb.from('messages').select('direction, is_ai_generated, owner_edited, edit_distance').eq('business_id', business.id).gte('created_at', since).limit(2000),
      sb.from('orders').select('total, currency, status').eq('business_id', business.id).gte('created_at', since).limit(500),
      sb.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', business.id).gte('created_at', since),
      sb.from('jobs').select('id, title, status, budget, currency').eq('business_id', business.id).in('status', ['active', 'awaiting_approval', 'blocked', 'draft']),
      sb.from('documents').select('title').eq('business_id', business.id).eq('tag', 'auto-learned').gte('created_at', since).limit(20),
    ]);

    const outbound = (msgs || []).filter(m => m.direction === 'outbound');
    const ai = outbound.filter(m => m.is_ai_generated);
    const edited = ai.filter(m => m.owner_edited || (m.edit_distance || 0) > 0);
    const aiAuto = ai.length - edited.length;
    const editRate = ai.length ? Math.round((edited.length / ai.length) * 100) : 0;

    const paidRevenue = (orders || [])
      .filter(o => ['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase()))
      .reduce((s, o) => s + (Number(o.total) || 0), 0);
    const pipelineETB = (openJobs || []).filter(j => (j.currency || 'ETB') === 'ETB').reduce((s, j) => s + (Number(j.budget) || 0), 0);

    // Hours-saved estimate: 2 minutes per AI auto-sent reply
    const minutesSaved = aiAuto * 2;
    const hoursSaved = (minutesSaved / 60).toFixed(1);

    const lines = [];
    lines.push(`📊 *Your week at ${business.name}*`);
    lines.push('');
    lines.push(`💬  ${msgs?.length || 0} messages handled`);
    lines.push(`✨  ${aiAuto} replies sent automatically (${hoursSaved}h saved)`);
    if (editRate > 0) lines.push(`✍️  ${editRate}% edit rate ${editRate <= 15 ? '— excellent' : editRate <= 30 ? '— good' : '— MiniMe needs more teaching'}`);
    lines.push(`👥  ${newCustomers || 0} new customers`);
    if (paidRevenue > 0) lines.push(`💰  ${paidRevenue.toLocaleString()} ETB collected`);
    if (pipelineETB > 0) lines.push(`📈  ${pipelineETB.toLocaleString()} ETB open in pipeline`);
    if (learned?.length) lines.push(`🧠  MiniMe learned ${learned.length} new things from your chats`);

    // Promote suggestion
    const trust = business.trust_level ?? 0;
    if (trust < 3 && ai.length >= 10 && editRate <= 15) {
      const next = ['Shadow', 'Supervised', 'Trusted', 'Full Agent'][trust + 1];
      lines.push('');
      lines.push(`🚀 *Ready to upgrade to ${next}.* Your edit rate is ${editRate}% — MiniMe is matching your voice. Tap below to promote.`);
    }

    if (msgs?.length === 0) {
      lines.push('');
      lines.push('_No activity yet — share your bot link with customers to get started._');
    }

    lines.push('');
    lines.push(`_Open the dashboard for the full picture._`);

    try {
      await tg(token, 'sendMessage', {
        chat_id: ownerChat,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📊 Open dashboard', url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app'}/` },
          ]],
        },
      });
      summary.push({ business: business.name, sent: true, ai_auto: aiAuto, edit_rate: editRate });
    } catch (e) {
      summary.push({ business: business.name, sent: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, sent: summary.length, summary });
}
