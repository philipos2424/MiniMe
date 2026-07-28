/**
 * GET  /api/agent/team  → list active suppliers (team members) for the business
 * POST /api/agent/team  → add a team member
 *
 * Auth: x-telegram-init-data (same pattern as /api/agent/jobs).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'];

async function resolveBusiness(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return null;
  return findBusinessForUser(tg.id);
}

export async function GET(request) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data, error } = await sb
    .from('suppliers')
    .select('*')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .order('role', { ascending: true, nullsFirst: false })
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const team = data || [];

  // Enrich each member with their delegation workload + on-time rate so the
  // roster shows who's busy and who's reliable.
  const { data: tasks } = await sb
    .from('agent_tasks')
    .select('supplier_id, status, due_at, completed_at')
    .eq('business_id', business.id)
    .eq('type', 'delegated_task')
    .not('supplier_id', 'is', null);

  const byMember = new Map();
  for (const t of tasks || []) {
    const m = byMember.get(t.supplier_id) || { open: 0, completed: 0, onTime: 0, withDue: 0 };
    if (['pending', 'in_progress', 'blocked'].includes(t.status)) m.open += 1;
    if (t.status === 'completed') {
      m.completed += 1;
      if (t.due_at) {
        m.withDue += 1;
        if (t.completed_at && Date.parse(t.completed_at) <= Date.parse(t.due_at)) m.onTime += 1;
      }
    }
    byMember.set(t.supplier_id, m);
  }

  // Coverage: which members MiniMe has PROVEN it can reach on the owner's own
  // Telegram account (biz_conn_chats — populated from real business_message
  // traffic; see sendAs.js). Only meaningful when Secretary Mode is connected.
  let coverageByChatId = new Map();
  if (business.telegram_biz_conn_id) {
    const chatIds = team.map(m => m.contact_telegram).filter(Boolean);
    if (chatIds.length) {
      const { data: coverage } = await sb.from('biz_conn_chats')
        .select('chat_id, send_failed_at')
        .eq('business_id', business.id)
        .in('chat_id', chatIds);
      coverageByChatId = new Map((coverage || []).map(c => [String(c.chat_id), c]));
    }
  }

  const enriched = team.map(member => {
    const m = byMember.get(member.id) || { open: 0, completed: 0, onTime: 0, withDue: 0 };
    const cov = member.contact_telegram ? coverageByChatId.get(String(member.contact_telegram)) : null;
    const reachablePersonally = member.contact_channel !== 'bot'
      && !!business.telegram_biz_conn_id
      && !!cov && !cov.send_failed_at;
    return {
      ...member,
      open_tasks: m.open,
      completed_tasks: m.completed,
      on_time_rate: m.withDue > 0 ? Math.round((m.onTime / m.withDue) * 100) : null,
      // 'personal' = proven reachable as the owner; 'bot' = everything else
      // (including "auto" with no proven coverage yet — cold outreach as the
      // owner isn't possible, so it falls back to the bot until they've
      // messaged the owner's personal line once).
      channel: reachablePersonally ? 'personal' : 'bot',
    };
  });

  return NextResponse.json({ team: enriched });
}

export async function POST(request) {
  const business = await resolveBusiness(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const name = (body.name || '').trim();
  const role = (body.role || '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 });

  const telegramId = body.telegramId ? Number(body.telegramId) : null;
  const insert = {
    business_id: business.id,
    name,
    role,
    telegram_username: body.telegramUsername ? String(body.telegramUsername).replace(/^@/, '').trim() : null,
    contact_telegram: Number.isFinite(telegramId) ? telegramId : null,
    contact_phone: body.phone ? String(body.phone).trim() : null,
    specialties: body.specialties ? String(body.specialties).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    is_active: true,
  };

  const { data, error } = await supabase().from('suppliers').insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ member: data });
}
