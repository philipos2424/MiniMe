import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';

export async function GET(req) {
  try {
    // In a real app, we would get the business_id from the auth session
    // For now, we'll look for a query param or use the primary business
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
    }

    const { data, error } = await supabase()
      .from('business_tasks')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('deadline', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { businessId, taskId, status = 'completed' } = await req.json();
    
    const { error } = await supabase()
      .from('business_tasks')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('id', taskId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
