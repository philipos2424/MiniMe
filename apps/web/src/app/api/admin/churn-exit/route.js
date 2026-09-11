/**
 * GET  /api/admin/churn-exit — dry run: who would be asked why their shop went
 *      quiet, and why everyone else is excluded.
 * POST /api/admin/churn-exit — actually asks them. `?limit=N` sends to the N
 *      quietest-longest first, so the first batch can be small.
 *
 * Why this is a deliberate, admin-triggered route and not a cron: it messages
 * real merchants about having stopped using the product. That is a judgement
 * call every time, not a schedule. Deliberately two-step for the same reason
 * bulk-activate-trials is — preview, then an explicit POST.
 *
 * What it is for: the platform holds five exit reasons, total. The exit
 * question works and always has (reengage/copy.mjs → agent-bot/webhook →
 * admin dashboard → weekly digest); it has only ever been put to people who
 * abandoned SIGNUP. The 57 shops that had real customer traffic in June and
 * none in August were never asked anything. Until migration 051 added
 * last_shop_activity_date we could not even identify them.
 *
 * Asked once per shop, ever, enforced through the outreach_sends ledger the
 * rest of the outreach system already dedupes on.
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { fetchAllRows } from '../../../../lib/server/fetch-all.mjs';
import { sendTelegramMessage } from '../../../../lib/server/telegram-send.mjs';
import { churnExitEligibility, churnExitMessage } from '../../../../lib/server/churnExit.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// The dedupe key in outreach_sends. Bump the suffix only if the question itself
// changes enough to be worth re-asking someone — which it almost never is.
const RULE_KEY = 'churn_exit_v1';

// source_type is CHECK-constrained to rule | campaign | feature_update. This is
// rule-shaped (a standing condition, not a one-off blast) but carries no
// outreach_rules row, so rule_id stays null and rule_key does the identifying.
const SOURCE_TYPE = 'rule';

const COLS = 'id, name, owner_name, owner_telegram_id, owner_private_chat_id, '
  + 'last_shop_activity_date, notification_prefs';

async function loadCandidates(sb) {
  const { data: shops, error } = await fetchAllRows(() => sb.from('businesses')
    .select(COLS)
    .not('last_shop_activity_date', 'is', null)
    .order('last_shop_activity_date', { ascending: true }));
  if (error) return { error };

  // Who has already been asked. One query for the whole run.
  const { data: prior, error: priorErr } = await fetchAllRows(() => sb.from('outreach_sends')
    .select('business_id, sent_at')
    .eq('rule_key', RULE_KEY)
    .order('sent_at', { ascending: false }));
  if (priorErr) return { error: priorErr };

  const askedAt = {};
  for (const row of prior || []) {
    if (!askedAt[row.business_id]) askedAt[row.business_id] = row.sent_at;
  }

  const eligible = [];
  const excluded = {};
  for (const shop of shops || []) {
    const d = churnExitEligibility(shop, { askedAt: askedAt[shop.id] || null });
    if (d.ask) eligible.push(shop);
    else excluded[d.reason] = (excluded[d.reason] || 0) + 1;
  }
  // Quietest-longest first: they are the ones whose memory is most at risk.
  return { eligible, excluded, scanned: shops?.length || 0 };
}

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { eligible, excluded, scanned, error } = await loadCandidates(sb);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    dry_run: true,
    scanned,
    would_ask: eligible.length,
    excluded,
    sample: eligible.slice(0, 8).map(b => ({
      name: b.name, quiet_since: b.last_shop_activity_date,
    })),
    preview: churnExitMessage(eligible[0] || { name: 'Bole Fabrics', owner_name: 'Selam' }),
  });
}

export async function POST(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : Infinity;

  const sb = supabase();
  const { eligible, error } = await loadCandidates(sb);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const batch = eligible.slice(0, limit === Infinity ? eligible.length : limit);
  const summary = { asked: 0, blocked: 0, failed: 0, eligible: eligible.length };

  for (const shop of batch) {
    const message = churnExitMessage(shop);
    const chatId = shop.owner_private_chat_id || shop.owner_telegram_id;

    const res = await sendTelegramMessage(token, {
      chat_id: chatId,
      text: message.text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: message.buttons.map(row =>
          row.map(b => ({ text: b.text, callback_data: b.action }))),
      },
    }).catch(e => ({ ok: false, error: e?.message || 'send_threw' }));

    // 403 means the owner blocked the bot — recorded, never retried, and not
    // counted as a failure to investigate.
    const status = res?.ok ? 'sent' : (/blocked|403/i.test(res?.error || '') ? 'blocked' : 'failed');
    if (status === 'sent') summary.asked++;
    else if (status === 'blocked') summary.blocked++;
    else summary.failed++;

    // Written for every outcome, not just success: the ledger is what stops a
    // second ask, and someone who could not be reached must not be retried
    // into indefinitely either.
    await sb.from('outreach_sends').insert({
      business_id: shop.id,
      source_type: SOURCE_TYPE,
      rule_key: RULE_KEY,
      status,
      telegram_error: status === 'sent' ? null : (res?.error || null),
      message_preview: message.text.slice(0, 200),
    }).then(() => {}, e => console.warn('[churn-exit] ledger insert failed:', e.message));
  }

  await audit({
    actor_type: 'platform_admin',
    actor_id: String(admin?.id ?? admin?.telegram_id ?? 'unknown'),
    action: 'outreach.churn_exit_asked',
    resource_type: 'businesses',
    metadata: summary,
    request,
  }).catch(() => {});

  return NextResponse.json({ ok: true, ...summary });
}
