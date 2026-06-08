/**
 * GET /api/conversations/[id]/export?format=csv|txt
 * Returns the full conversation thread as a downloadable file.
 * Owner-authenticated via Telegram initData.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeCSV(str) {
  if (!str) return '';
  const s = String(str).replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') === 'txt' ? 'txt' : 'csv';

  const sb = supabase();

  // Verify the conversation belongs to this business
  const { data: conv } = await sb.from('conversations')
    .select('id, customers(name, telegram_username)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Fetch all messages (up to 5000)
  const { data: messages } = await sb.from('messages')
    .select('direction, content, created_at, is_ai_generated, owner_edited, file_type, file_url')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(5000);

  const customerName = conv.customers?.name || conv.customers?.telegram_username || 'Customer';
  const businessName = business.name || 'Business';
  const filename = `chat-${customerName.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}`;

  if (format === 'csv') {
    const header = 'Timestamp,Direction,Sender,Message,AI Generated,Edited,File Type,File URL\n';
    const rows = (messages || []).map(m => {
      const sender = m.direction === 'inbound' ? customerName : businessName;
      const ts = new Date(m.created_at).toISOString().replace('T', ' ').slice(0, 19);
      return [
        escapeCSV(ts),
        escapeCSV(m.direction),
        escapeCSV(sender),
        escapeCSV(m.content || ''),
        m.is_ai_generated ? 'yes' : 'no',
        m.owner_edited ? 'yes' : 'no',
        escapeCSV(m.file_type || ''),
        escapeCSV(m.file_url || ''),
      ].join(',');
    }).join('\n');

    return new Response(header + rows, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  // Plain text transcript
  const lines = [`Chat transcript: ${customerName} ↔ ${businessName}`, `Exported: ${new Date().toLocaleString('en-GB')}`, '─'.repeat(60), ''];
  for (const m of messages || []) {
    const ts = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const sender = m.direction === 'inbound' ? customerName : businessName;
    const aiTag = m.is_ai_generated ? ' [AI]' : '';
    const editTag = m.owner_edited ? ' [edited]' : '';
    lines.push(`[${ts}] ${sender}${aiTag}${editTag}:`);
    if (m.content) lines.push(m.content);
    if (m.file_url) lines.push(`📎 File: ${m.file_type || 'attachment'} — ${m.file_url}`);
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.txt"`,
    },
  });
}
