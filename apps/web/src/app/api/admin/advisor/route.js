/**
 * POST /api/admin/advisor
 * Platform-level advisor for the master admin.
 * Knows the entire platform: all businesses, stats, subscription status,
 * webhook health, revenue, churn signals, and AI performance.
 *
 * Anti-hallucination design:
 *   - Every answer is grounded in data loaded fresh at query time
 *   - Temperature 0.15 for factual answers, 0.4 for strategic suggestions
 *   - System prompt explicitly forbids inventing numbers, names, or statuses
 *   - Data blocks are injected verbatim so the model can cite exact values
 */
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { isAdmin } from '../../../../lib/server/admin';
import { supabase } from '../../../../lib/server/db';
import { MODEL } from '../../../../lib/server/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

// ── Load platform data ────────────────────────────────────────────────────────
async function loadPlatformData() {
  const sb = supabase();
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const since30d = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    { data: bizRaw },
    { data: msgStats },
    { data: orderStats },
    { data: newCustomers },
    { data: lessons },
  ] = await Promise.all([
    // All businesses with key fields
    sb.from('businesses').select(
      'id, name, owner_name, category, plan_tier, subscription_status, trial_ends_at, ' +
      'subscription_expires_at, panic_mode, brain_mode, trust_level, created_at, ' +
      'telegram_bot_username, telegram_bot_token_enc'
    ).order('created_at', { ascending: false }),

    // Message volume per business — last 7 days
    sb.from('messages')
      .select('business_id, direction, is_ai_generated, created_at')
      .gte('created_at', since7d),

    // Orders + revenue — last 7 days
    sb.from('orders')
      .select('business_id, status, total, created_at')
      .gte('created_at', since7d),

    // New customers — last 7 days
    sb.from('customers')
      .select('business_id, created_at')
      .gte('created_at', since7d),

    // Auto-learned lessons — last 7 days
    sb.from('documents')
      .select('business_id, created_at')
      .eq('tag', 'auto-learned')
      .gte('created_at', since7d),
  ]);

  // ── Aggregate per-business stats ─────────────────────────────────────────────
  const bizMap = {};
  for (const b of bizRaw || []) {
    bizMap[b.id] = {
      ...b,
      msgs_week: 0, ai_msgs_week: 0, orders_week: 0,
      revenue_week: 0, new_customers_week: 0, lessons_week: 0,
    };
  }

  for (const m of msgStats || []) {
    if (bizMap[m.business_id]) {
      bizMap[m.business_id].msgs_week++;
      if (m.is_ai_generated && m.direction === 'outbound') bizMap[m.business_id].ai_msgs_week++;
    }
  }
  for (const o of orderStats || []) {
    if (bizMap[o.business_id]) {
      bizMap[o.business_id].orders_week++;
      if (['paid', 'fulfilled'].includes(o.status)) {
        bizMap[o.business_id].revenue_week += Number(o.total || 0);
      }
    }
  }
  for (const c of newCustomers || []) {
    if (bizMap[c.business_id]) bizMap[c.business_id].new_customers_week++;
  }
  for (const l of lessons || []) {
    if (bizMap[l.business_id]) bizMap[l.business_id].lessons_week++;
  }

  const businesses = Object.values(bizMap);

  // ── Platform-level aggregates ──────────────────────────────────────────────
  const linked = businesses.filter(b => b.telegram_bot_token_enc).length;
  const active7d = businesses.filter(b => b.msgs_week > 0).length;
  const totalMsgs = businesses.reduce((s, b) => s + b.msgs_week, 0);
  const totalAiMsgs = businesses.reduce((s, b) => s + b.ai_msgs_week, 0);
  const totalRevenue = businesses.reduce((s, b) => s + b.revenue_week, 0);
  const totalOrders = businesses.reduce((s, b) => s + b.orders_week, 0);
  const totalLessons = businesses.reduce((s, b) => s + b.lessons_week, 0);

  // Churn signals: trial ending in < 3 days, or expired, or no activity
  const now = new Date();
  const churnRisk = businesses.filter(b => {
    if (b.subscription_status === 'expired' || b.subscription_status === 'cancelled') return true;
    if (b.subscription_status === 'trial' && b.trial_ends_at) {
      const daysLeft = (new Date(b.trial_ends_at) - now) / 86400000;
      if (daysLeft < 3) return true;
    }
    return false;
  });

  // Top performers by message volume
  const topByMessages = [...businesses]
    .filter(b => b.msgs_week > 0)
    .sort((a, b) => b.msgs_week - a.msgs_week)
    .slice(0, 10);

  // Inactive (linked but 0 messages this week)
  const inactive = businesses.filter(b => b.telegram_bot_token_enc && b.msgs_week === 0);

  return {
    totals: {
      businesses: businesses.length,
      linked,
      active7d,
      totalMsgs,
      totalAiMsgs,
      aiRatePct: totalMsgs > 0 ? Math.round((totalAiMsgs / totalMsgs) * 100) : 0,
      totalRevenue,
      totalOrders,
      totalLessons,
      churnRiskCount: churnRisk.length,
      inactiveCount: inactive.length,
    },
    businesses,
    churnRisk,
    topByMessages,
    inactive,
    asOf: new Date().toISOString(),
  };
}

// ── Build system prompt with grounded data ────────────────────────────────────
function buildAdminSystemPrompt(data) {
  const { totals, businesses, churnRisk, topByMessages, inactive } = data;

  // Format each business as a one-line summary
  function bizLine(b) {
    const status = b.subscription_status === 'active' ? '✅' :
      b.subscription_status === 'trial' ? '🔵 trial' :
      b.subscription_status === 'expired' ? '🔴 expired' :
      b.subscription_status === 'cancelled' ? '❌ cancelled' : b.subscription_status || '—';
    const trial = b.trial_ends_at ? ` (trial ends ${new Date(b.trial_ends_at).toLocaleDateString('en-GB')})` : '';
    return `• ${b.name || 'Unnamed'}${b.owner_name ? ` (${b.owner_name})` : ''} | ${status}${trial} | plan=${b.plan_tier || 'free'} | msgs_7d=${b.msgs_week} | rev_7d=${b.revenue_week.toFixed(0)} ETB | orders=${b.orders_week} | new_cust=${b.new_customers_week} | trust=${b.trust_level ?? 0}${b.panic_mode ? ' | ⚠️ PANIC' : ''}`;
  }

  const allBizBlock = businesses.map(bizLine).join('\n');
  const churnBlock = churnRisk.length
    ? churnRisk.map(bizLine).join('\n')
    : '(none at risk right now)';
  const topBlock = topByMessages.length
    ? topByMessages.map(bizLine).join('\n')
    : '(no active businesses)';
  const inactiveBlock = inactive.slice(0, 15).map(bizLine).join('\n') ||
    '(all linked businesses were active this week)';

  return `You are the platform advisor for MiniMe — an AI business assistant platform serving Ethiopian small businesses.
You have full access to live platform data loaded RIGHT NOW. Your job is to give the platform admin (the founder/owner of MiniMe) honest, grounded analysis and strategic advice.

═══ STRICT GROUNDING RULE ═══
You may ONLY state facts that appear in the DATA BLOCKS below.
NEVER invent business names, numbers, statuses, dates, or statistics.
If a fact isn't in the data, say "I don't have that detail in the current snapshot."
Use exact numbers from the data — do not round unless asked.
If the question is about a specific business not in the data, say so.
═══════════════════════════════

HOW TO RESPOND:
- Be direct and concise — the admin is busy
- Lead with the most important finding
- For strategic questions, give 2-3 concrete actions with the business names or numbers
- For factual questions, cite the exact value from the data
- Flag anomalies proactively (e.g., "Note: 3 businesses are in PANIC mode")
- Speak like a sharp COO briefing the CEO — not a customer service rep

DATA AS OF: ${new Date(data.asOf).toUTCString()}

═══ PLATFORM OVERVIEW (this week) ═══
Total businesses: ${totals.businesses}
Bot-linked: ${totals.linked}
Active (7d): ${totals.active7d}
Messages: ${totals.totalMsgs.toLocaleString()} (${totals.aiRatePct}% AI-handled)
Revenue processed: ${totals.totalRevenue.toLocaleString()} ETB
Orders: ${totals.totalOrders}
Auto-learned lessons: ${totals.totalLessons}
Churn risk count: ${totals.churnRiskCount}
Inactive (linked, 0 msgs): ${totals.inactiveCount}

═══ ALL BUSINESSES ═══
${allBizBlock}

═══ CHURN RISK ═══
${churnBlock}

═══ TOP BY MESSAGES (7d) ═══
${topBlock}

═══ INACTIVE THIS WEEK (linked but 0 messages) ═══
${inactiveBlock}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { question = 'Give me a platform health summary — who is growing, who is at risk, and what should I focus on today.' } = await request.json().catch(() => ({}));
  if (!question?.trim()) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const t0 = Date.now();
  try {
    const data = await loadPlatformData();
    const systemPrompt = buildAdminSystemPrompt(data);

    // Lower temperature for factual queries
    const isFact = /how many|what is|who has|which business|list|count|total|revenue|show me/i.test(question);
    const temperature = isFact ? 0.15 : 0.4;

    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    });

    const answer = res.choices[0]?.message?.content?.trim() || 'No response generated.';
    const tokens = res.usage;

    return NextResponse.json({
      ok: true,
      answer,
      latency_ms: Date.now() - t0,
      tokens: (tokens?.prompt_tokens || 0) + (tokens?.completion_tokens || 0),
      model: res.model,
      data_as_of: data.asOf,
      totals: data.totals,
    });
  } catch (e) {
    console.error('[admin/advisor]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
