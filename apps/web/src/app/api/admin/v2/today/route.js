import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { loadTodayPanel, TODAY_PANELS } from '../../../../../lib/server/metrics/today.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  if (!await requireAdminRequest(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  const panel = new URL(request.url).searchParams.get('panel');
  if (panel && !TODAY_PANELS.includes(panel)) return NextResponse.json({ error: 'Unknown panel' }, { status: 400, headers });
  const sb = supabase();
  const now = Date.now();
  async function load(name) {
    try { return { data: await loadTodayPanel(sb, name, now) }; }
    catch { return { error: 'This panel could not be loaded. Please retry.' }; }
  }
  if (panel) {
    const result = await load(panel);
    return NextResponse.json(result, { status: result.error ? 503 : 200, headers });
  }
  const panels = await Promise.all(TODAY_PANELS.map(async name => [name, await load(name)]));
  return NextResponse.json({ panels: Object.fromEntries(panels) }, { headers });
}
