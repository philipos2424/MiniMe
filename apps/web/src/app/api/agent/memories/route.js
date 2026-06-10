import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { authenticate } from '../../../../lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { data, error } = await supabase()
      .from('customer_memories')
      .select('*')
      .eq('business_id', auth.business.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (e) {
    console.error('[agent/memories]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
