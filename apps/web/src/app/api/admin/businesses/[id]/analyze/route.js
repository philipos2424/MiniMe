/**
 * POST /api/admin/businesses/:id/analyze
 * Admin-only: runs the full advisor pipeline on a specific business and
 * returns a rich analysis. Reads every data source (clients, orders, jobs,
 * agent activity, feedback, team) in a single parallel fetch.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../lib/telegram';
import { isAdmin } from '../../../../../../lib/server/admin';
import { getAdvisorContext, buildAdvisorPrompt, generateAdvisorResponse } from '../../../../../../lib/server/advisor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function POST(request, { params }) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { question = 'Full business health check — strengths, risks, and 3 concrete actions for this week.' } = await request.json().catch(() => ({}));

  const t0 = Date.now();
  try {
    const { response, suggestedActions, tokens, model } = await generateAdvisorResponse(
      params.id,
      question,
      { adminMode: true }  // skips instruction gating, uses longer context
    );
    const latency = Date.now() - t0;

    // Rough cost estimate ($2.50/M input + $10/M output for gpt-4.1)
    const costUsd = tokens ? ((tokens.prompt || 0) * 2.50 + (tokens.completion || 0) * 10.00) / 1_000_000 : null;

    return NextResponse.json({
      ok: true,
      response,
      suggested_actions: suggestedActions || [],
      latency_ms: latency,
      tokens: tokens ? (tokens.prompt || 0) + (tokens.completion || 0) : null,
      cost_usd: costUsd,
      model,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
