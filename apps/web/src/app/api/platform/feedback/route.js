/**
 * POST /api/platform/feedback — submit platform feedback from a business owner
 * GET  /api/platform/feedback — admin-only: list all feedback with NPS breakdown
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { oneOf, str, num, ValidationError, validationResponse } from '../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── POST — submit feedback ─────────────────────────────────────────────────
export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  // Allow feedback even without a linked business (early onboarding users)

  const body = await request.json().catch(() => ({}));

  let nps_score, category, note, page;
  try {
    nps_score = body.nps_score != null ? num(body.nps_score, { field: 'nps_score', min: 0, max: 10, integer: true }) : null;
    category  = oneOf(body.category, ['bug', 'feature', 'general', 'praise'], { field: 'category', required: true });
    note      = str(body.note || '', { field: 'note', max: 2000, required: false });
    page      = str(body.page || '', { field: 'page', max: 200, required: false });
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const sb = supabase();
  const { error } = await sb.from('platform_feedback').insert({
    business_id:  business?.id || null,
    owner_tg_id:  tg?.id || null,
    nps_score,
    category,
    note:         note || null,
    page:         page || null,
    app_version:  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || null,
  });

  if (error) {
    // Table may not exist yet — fail gracefully
    console.error('[platform/feedback]', error.message);
    return NextResponse.json({ ok: true, warning: 'stored locally only' });
  }

  // Notify platform admin via Telegram
  const adminId   = process.env.PLATFORM_ADMIN_TELEGRAM_ID;
  const botToken  = process.env.TELEGRAM_BOT_TOKEN;
  if (adminId && botToken) {
    const bizName  = business?.name || 'Unknown business';
    const npsText  = nps_score != null ? `NPS: *${nps_score}/10*` : 'NPS: not given';
    const catEmoji = { bug: '🐛', feature: '✨', general: '💬', praise: '🎉' }[category] || '📣';
    const noteText = note ? `\n\n_"${note.slice(0, 300)}${note.length > 300 ? '…' : ''}"_` : '';
    const text = `${catEmoji} *Feedback from ${bizName}*\n\n${npsText}\nCategory: ${category}${noteText}\n\n_${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}_`;
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: adminId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(6000),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

// ── GET — admin feedback list ──────────────────────────────────────────────
export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  if (!isAdmin(tg?.id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data: rows, error } = await sb
    .from('platform_feedback')
    .select('id, business_id, owner_tg_id, nps_score, category, note, page, created_at, businesses(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute NPS breakdown
  const scored = (rows || []).filter(r => r.nps_score != null);
  const promoters  = scored.filter(r => r.nps_score >= 9).length;
  const passives   = scored.filter(r => r.nps_score >= 7 && r.nps_score <= 8).length;
  const detractors = scored.filter(r => r.nps_score <= 6).length;
  const nps = scored.length > 0
    ? Math.round(((promoters - detractors) / scored.length) * 100)
    : null;
  const avgScore = scored.length > 0
    ? Math.round((scored.reduce((s, r) => s + r.nps_score, 0) / scored.length) * 10) / 10
    : null;

  const byCategory = { bug: 0, feature: 0, general: 0, praise: 0 };
  for (const r of rows || []) if (r.category in byCategory) byCategory[r.category]++;

  return NextResponse.json({
    total: (rows || []).length,
    nps,
    avg_score: avgScore,
    promoters, passives, detractors,
    by_category: byCategory,
    feedback: (rows || []).map(r => ({
      id: r.id,
      business_name: r.businesses?.name || 'Unknown',
      nps_score: r.nps_score,
      category: r.category,
      note: r.note,
      page: r.page,
      created_at: r.created_at,
    })),
  });
}
