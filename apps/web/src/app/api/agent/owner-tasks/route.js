/**
 * GET    /api/agent/owner-tasks        — list the owner's scheduled tasks (owner_action)
 * DELETE /api/agent/owner-tasks?id=…   — cancel one
 *
 * Powers the "What I'm working on for you" board in the Mini App. Read-only over
 * the agent_tasks rows created by handleOwnerPrompt (schedule_task /
 * schedule_recurring); the actual send still goes through the Telegram
 * approve-flow, never from here.
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { authenticate } from '../../../../lib/server/auth';
import { decrypt } from '../../../../lib/server/crypto';
import { sendApprovedOwnerTask } from '../../../../lib/server/ownerCommands';

export const dynamic = 'force-dynamic';

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
function resolveToken(business) {
  if (business?.telegram_bot_token_enc) { try { return decrypt(business.telegram_bot_token_enc); } catch {} }
  return AGENT_TOKEN;
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data, error } = await supabase()
      .from('agent_tasks')
      .select('id, title, description, status, scheduled_at, payload')
      .eq('business_id', auth.business.id)
      .eq('type', 'owner_action')
      .in('status', ['pending', 'awaiting_approval'])
      .order('scheduled_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    const tasks = (data || []).map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      scheduled_at: t.scheduled_at,
      action: t.payload?.action || null,
      target: t.payload?.target || null,
      message: t.payload?.message_draft || t.payload?.message || t.description || '',
      recurrence: t.payload?.recurrence || { kind: 'once' },
    }));
    return NextResponse.json({ tasks });
  } catch (e) {
    console.error('[agent/owner-tasks GET]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// POST { taskId, action: 'send' | 'cancel' } — approve a drafted message.
export async function POST(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { taskId, action } = await request.json().catch(() => ({}));
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });

    const sb = supabase();
    const { data: task } = await sb.from('agent_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('business_id', auth.business.id)
      .eq('type', 'owner_action')
      .maybeSingle();
    if (!task) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (task.status !== 'awaiting_approval' && task.status !== 'pending') {
      return NextResponse.json({ error: 'already_handled' }, { status: 409 });
    }

    if (action === 'cancel') {
      await sb.from('agent_tasks').update({ status: 'cancelled' }).eq('id', taskId);
      return NextResponse.json({ ok: true, status: 'cancelled' });
    }

    const token = resolveToken(auth.business);
    const confirm = await sendApprovedOwnerTask(token, auth.business, task);
    return NextResponse.json({ ok: true, status: 'sent', confirm });
  } catch (e) {
    console.error('[agent/owner-tasks POST]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data, error } = await supabase()
      .from('agent_tasks')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('business_id', auth.business.id)
      .eq('type', 'owner_action')
      .in('status', ['pending', 'awaiting_approval'])
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[agent/owner-tasks DELETE]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
