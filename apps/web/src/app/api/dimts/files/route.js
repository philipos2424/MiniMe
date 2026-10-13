import { NextResponse } from 'next/server';
import { verifySignature } from '../../../../lib/server/dimtsLogic.mjs';
import { handleDimtsFiles } from '../../../../lib/server/dimtsFilesAdapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const body = await request.text();
  if (Buffer.byteLength(body) > 16_384) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    verifySignature({ body, id: request.headers.get('webhook-id'), timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature') }, process.env.DIMTS_LINK_SECRET);
  } catch { return NextResponse.json({ error: 'invalid_signature' }, { status: 401 }); }
  let input;
  try { input = JSON.parse(body); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
  try { return NextResponse.json(await handleDimtsFiles(input), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (err) {
    return NextResponse.json({ error: err.code || 'files_unavailable' }, { status: err.status || 503 });
  }
}
