import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { authenticate } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = new Set(['pending', 'completed', 'cancelled']);

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data, error } = await supabase()
      .from('business_tasks')
      .select('*')
      .eq('business_id', auth.business.id)
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('deadline', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (e) {
    console.error('[agent/tasks GET]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { taskId, status = 'completed' } = await request.json().catch(() => ({}));
    if (!taskId) return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    }

    const { data, error } = await supabase()
      .from('business_tasks')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('id', taskId)
      .eq('business_id', auth.business.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[agent/tasks POST]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
