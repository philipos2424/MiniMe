/**
 * GET /api/cron/conversation-summaries — daily "what happened + what to do".
 *
 * For every active business, finds conversations that wrapped up in the last
 * ~26 hours (had messages, now quiet ≥2h), summarizes each one with the LLM,
 * and DMs the owner ONE digest: who talked, what it was about, and a concrete
 * suggested next step per conversation. This is the owner's end-of-day recap —
 * the "so what should I actually do?" layer on top of raw chat logs.
 *
 * Idempotent: each conversation gets metadata.last_summary_at; we only
 * summarize again after new messages arrive.
 *
 * Opt-out: notification_prefs.conversation_summaries === false.
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`.
 * Schedule: daily 18:00 UTC (21:00 Addis) in vercel.json.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { loggedCompletion } from '../../../../lib/server/openai-wrapper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HOUR_MS = 3_600_000;
const QUIET_MS = 2 * HOUR_MS;         // conversation counts as "finished" after 2h of silence
const WINDOW_MS = 26 * HOUR_MS;       // look back this far for activity
const MIN_MESSAGES = 4;               // skip one-liner conversations
const MAX_CONVOS_PER_BIZ = 8;         // digest cap — keep the DM readable

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

async function sendDigest(token, chatId, text) {
  const url = appUrl();
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: url ? { inline_keyboard: [[{ text: '💬 Open conversations', web_app: { url: `${url}/conversations` } }]] } : undefined,
    }),
    signal: AbortSignal.timeout(8000),
  }).then(r => r.json()).catch(() => null);
}

/** Summarize one conversation → { summary, suggestion } or null. */
async function summarizeConversation(business, convo, messages, customerName) {
  const transcript = messages
    .map(m => `${m.direction === 'inbound' ? (customerName || 'CUSTOMER') : 'YOU'}: ${(m.content || '').slice(0, 250)}`)
    .join('\n');
  if (transcript.length < 60) return null;

  try {
    const res = await loggedCompletion({
      business_id: business.id,
      route: 'conversation_summary',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are summarizing a finished customer conversation for a busy Ethiopian business owner. Be concrete and short.

Business: ${business.name}${business.category ? ` (${business.category})` : ''}

CONVERSATION:
${transcript.slice(0, 5000)}

Return JSON:
{
  "summary": "<ONE sentence: who wanted what, and how it ended — e.g. 'Asked about leather totes, you quoted 3,200 birr, she said she'll think about it.'>",
  "suggestion": "<ONE concrete action for the owner, or empty string if none needed — e.g. 'Follow up tomorrow with a photo of the brown tote.' Skip generic advice like \\"be responsive\\".>",
  "outcome": "<one of: ordered | interested | undecided | resolved | lost | chitchat>"
}`,
      }],
    });
    const raw = res?.choices?.[0]?.message?.content || '{}';
    const j = JSON.parse(raw);
    if (!j.summary) return null;
    return { summary: String(j.summary).slice(0, 300), suggestion: String(j.suggestion || '').slice(0, 250), outcome: j.outcome || 'undecided' };
  } catch (e) {
    console.warn('[conv-summaries] LLM failed:', e.message);
    return null;
  }
}

const OUTCOME_EMOJI = { ordered: '✅', interested: '🟢', undecided: '🤔', resolved: '👌', lost: '🔻', chitchat: '💬' };

export async function GET(request) {
  if (!isCronAuthorized(request) && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();
  const sb = supabase();

  const { data: businesses } = await sb
    .from('businesses')
    .select('id, name, category, owner_name, owner_telegram_id, owner_private_chat_id, panic_mode, notification_prefs, onboarding_completed, telegram_bot_token_enc, shop_code')
    .or('telegram_bot_token_enc.not.is.null,and(onboarding_completed.eq.true,shop_code.not.is.null)')
    .limit(500);

  const out = { businesses: 0, conversations: 0, digests_sent: 0, dry_run: dryRun };

  for (const biz of businesses || []) {
    if (biz.panic_mode) continue;
    if (biz.notification_prefs?.conversation_summaries === false) continue;
    const chatId = biz.owner_private_chat_id || biz.owner_telegram_id;
    if (!chatId) continue;

    // Conversations active in the window but quiet for ≥2h.
    const { data: convos } = await sb
      .from('conversations')
      .select('id, customer_id, last_message_at, message_count, metadata')
      .eq('business_id', biz.id)
      .gte('last_message_at', new Date(now - WINDOW_MS).toISOString())
      .lte('last_message_at', new Date(now - QUIET_MS).toISOString())
      .gte('message_count', MIN_MESSAGES)
      .order('last_message_at', { ascending: false })
      .limit(20);
    if (!convos?.length) continue;

    // Skip already-summarized (no new messages since last summary).
    const fresh = convos.filter(c => {
      const last = c.metadata?.last_summary_at;
      return !last || new Date(c.last_message_at) > new Date(last);
    }).slice(0, MAX_CONVOS_PER_BIZ);
    if (!fresh.length) continue;

    out.businesses++;
    const lines = [];
    for (const c of fresh) {
      const [{ data: msgs }, { data: cust }] = await Promise.all([
        sb.from('messages')
          .select('direction, content, created_at')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(30)
          .then(r => ({ data: (r.data || []).reverse() })),
        sb.from('customers').select('name').eq('id', c.customer_id).maybeSingle(),
      ]);
      if (!msgs?.length) continue;

      const customerName = (cust?.name || '').trim() || 'A customer';
      const s = dryRun ? { summary: '(dry run)', suggestion: '', outcome: 'undecided' } : await summarizeConversation(biz, c, msgs, customerName);
      if (!s) continue;

      out.conversations++;
      lines.push(
        `${OUTCOME_EMOJI[s.outcome] || '💬'} *${customerName}* — ${s.summary}` +
        (s.suggestion ? `\n   👉 _${s.suggestion}_` : '')
      );

      if (!dryRun) {
        // Persist the summary on the conversation (merge metadata, don't clobber).
        await sb.from('conversations')
          .update({ metadata: { ...(c.metadata || {}), last_summary_at: new Date(now).toISOString(), last_summary: s } })
          .eq('id', c.id)
          .then(() => {}, () => {});
      }
    }
    if (!lines.length) continue;

    const first = (biz.owner_name || '').split(' ')[0] || 'there';
    const text =
      `🌙 *${biz.name} — today's conversations*\n\n` +
      lines.join('\n\n') +
      `\n\nHi ${first} — that's what MiniMe handled today. Tap below to read any chat in full or act on a suggestion.`;

    if (!dryRun) {
      const r = await sendDigest(token, chatId, text);
      if (r?.ok) out.digests_sent++;
      await new Promise(rs => setTimeout(rs, 80));
    }
  }

  console.log('[cron/conversation-summaries]', JSON.stringify(out));
  return NextResponse.json({ ok: true, ...out });
}
