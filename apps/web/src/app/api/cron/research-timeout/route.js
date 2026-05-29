/**
 * GET /api/cron/research-timeout — sweep any open research campaigns past
 * their 24h expires_at, mark them reporting, run synthesis on whatever
 * partial data we have, and DM the owner.
 *
 * Scheduled hourly via vercel.json.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { synthesizeAndDeliver } from '../../../../lib/server/research';
import { tg } from '../../../../lib/server/telegramApi';
import { decrypt } from '../../../../lib/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const authed = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!authed && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabase();
  const { data: stale } = await sb
    .from('research_campaigns')
    .select('*')
    .eq('status', 'open')
    .lt('expires_at', new Date().toISOString())
    .limit(50);

  const results = [];
  for (const c of stale || []) {
    try {
      if ((c.reply_count || 0) === 0 && (c.target_ids || []).length > 0) {
        // No replies at all — send a polite "no replies yet" DM and mark complete
        await sb.from('research_campaigns').update({
          status: 'complete', completed_at: new Date().toISOString(),
          report: { summary_line: 'No replies received within 24h.', comparison: [], recommendation: null },
        }).eq('id', c.id);
        await notifyNoReplies(c);
      } else {
        await synthesizeAndDeliver(c.id);
      }
      results.push({ id: c.id, ok: true });
    } catch (e) {
      console.error('[research-timeout]', c.id, e.message);
      results.push({ id: c.id, ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, swept: results.length, results });
}

async function notifyNoReplies(campaign) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses')
    .select('telegram_bot_token_enc, owner_telegram_id, owner_private_chat_id, name')
    .eq('id', campaign.business_id).maybeSingle();
  if (!biz?.telegram_bot_token_enc) return;
  let token;
  try { token = decrypt(biz.telegram_bot_token_enc); } catch { return; }
  const chat = biz.owner_private_chat_id || biz.owner_telegram_id;
  if (!token || !chat) return;
  await tg(token, 'sendMessage', {
    chat_id: chat, parse_mode: 'Markdown',
    text: `🔕 *No replies yet*\n\nI reached out about _"${escapeMd(campaign.query)}"_ but no one responded within 24h.\n\n_Want me to try a different angle or broaden the search?_`,
  });
}

function escapeMd(s) {
  return String(s || '').replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
