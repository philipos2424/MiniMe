/**
 * GET  /api/agent/team  → list active suppliers (team members) for the business
 * POST /api/agent/team  → add a team member
 *
 * Auth: x-telegram-init-data (same pattern as /api/agent/jobs).
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { sendMemberWelcome, resolveBotUsername } from '../../../../lib/server/delegation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kept in sync with the dashboard's role dropdown (agent/team/page.js) and
// api/agent/team/[id]/route.js. The DB has no CHECK constraint on this column
// (migration 041) specifically so this list can grow without a migration —
// "Other" always stays last as the true escape hatch, with a free-text
// specialty (suppliers.specialties) capturing whatever isn't on the list.
const ROLES = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'accountant', 'cashier', 'sales', 'cleaner', 'security', 'other'];

/** Opaque, URL-safe invite token — collision odds are astronomically low; the column's UNIQUE constraint is the backstop. */
function generateInviteToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function buildInviteUrl(botUsername, inviteToken) {
  if (!botUsername || !inviteToken) return null;
  return `https://t.me/${botUsername}?start=team_${inviteToken}`;
}

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
    .select('id, supplier_id, supplier_name, title, description, status, due_at, completed_at, blocked_reason, completion_file_id, created_at, updated_at, payload')
    .eq('business_id', business.id)
    .eq('type', 'delegated_task');

  const byMember = new Map();
  for (const t of tasks || []) {
    const m = byMember.get(t.supplier_id) || { open: 0, completed: 0, onTime: 0, withDue: 0 };
    if (t.supplier_id && ['pending', 'in_progress', 'blocked'].includes(t.status)) m.open += 1;
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

  // Pending members (never claimed an invite) need a link to (re)share —
  // only resolve the bot username once, and only if someone's actually pending.
  const hasPending = team.some(m => !m.contact_telegram);
  const botUsername = hasPending ? await resolveBotUsername(business).catch(() => null) : null;

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
      invite_url: !member.contact_telegram ? buildInviteUrl(botUsername, member.invite_token) : null,
    };
  });

  const openTasks = (tasks || [])
    .filter(t => ['pending', 'in_progress', 'blocked'].includes(t.status))
    .sort((a, b) => {
      const ad = a.due_at ? Date.parse(a.due_at) : Infinity;
      const bd = b.due_at ? Date.parse(b.due_at) : Infinity;
      if (ad !== bd) return ad - bd;
      return Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0);
    })
    .slice(0, 30);

  const taskIds = openTasks.map(t => t.id);
  const { data: events } = taskIds.length
    ? await sb.from('agent_task_events')
      .select('task_id, actor, action, note, created_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
    : { data: [] };
  const latestEventByTask = new Map();
  for (const ev of events || []) {
    if (!latestEventByTask.has(ev.task_id)) latestEventByTask.set(ev.task_id, ev);
  }

  const delegatedTasks = openTasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    supplier_id: t.supplier_id,
    supplier_name: t.supplier_name,
    due_at: t.due_at,
    blocked_reason: t.blocked_reason,
    completion_file_id: t.completion_file_id,
    created_at: t.created_at,
    updated_at: t.updated_at,
    last_channel: t.payload?.last_sent_as || null,
    latest_event: latestEventByTask.get(t.id) || null,
  }));

  return NextResponse.json({
    team: enriched,
    delegatedTasks,
    secretary: {
      connected: !!business.telegram_biz_conn_id,
      team_group_connected: !!business.business_group_chat_id,
    },
  });
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

  const rawTg = (body.telegramUsername || body.telegramId || '').toString().trim();
  let telegramUsername = null;
  let telegramId = null;

  if (/^\d+$/.test(rawTg)) {
    telegramId = Number(rawTg);
  } else if (rawTg) {
    telegramUsername = rawTg.replace(/^@/, '');
  }

  // Same loose validation PATCH /api/agent/team/[id] uses — malformed
  // active_hours is treated as "no window" by delegationLogic.parseActiveHours,
  // so there's nothing stricter to enforce here.
  const maxDailyTasksNum = Number(body.maxDailyTasks);

  const insert = {
    business_id: business.id,
    name,
    role,
    telegram_username: telegramUsername,
    contact_telegram: telegramId,
    contact_phone: body.phone ? String(body.phone).trim() : null,
    specialties: body.specialties ? String(body.specialties).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    contact_channel: ['auto', 'bot', 'personal'].includes(body.contactChannel) ? body.contactChannel : 'auto',
    active_hours: body.activeHours ? String(body.activeHours).trim() : null,
    max_daily_tasks: Number.isFinite(maxDailyTasksNum) && maxDailyTasksNum > 0 ? Math.floor(maxDailyTasksNum) : null,
    is_active: true,
    // Always mint an invite token, even when a username/ID was typed in —
    // it's the reliable fallback the dashboard shows if a direct DM attempt
    // below fails (or was never attempted because no handle was given).
    invite_token: generateInviteToken(),
    invite_created_at: new Date().toISOString(),
  };

  const sb = supabase();
  const { data, error } = await sb.from('suppliers').insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Welcome them now, not only when they're first assigned something — the
  // whole point is a member knows who's texting them from the moment they're
  // added. Never fails the add: if Telegram rejects it (they've never opened
  // the bot), surface the hint so the dashboard can show it inline and fall
  // back to the invite link instead.
  let welcome = { ok: true };
  if (data.contact_telegram) {
    welcome = await sendMemberWelcome({ sb, business, supplier: data }).catch(e => ({ ok: false, reason: e.message }));
  }

  const botUsername = await resolveBotUsername(business).catch(() => null);
  const inviteUrl = !data.contact_telegram ? buildInviteUrl(botUsername, data.invite_token) : null;

  return NextResponse.json({ member: data, welcome, inviteUrl });
}
