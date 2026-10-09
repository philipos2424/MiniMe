import { NextResponse } from 'next/server';
import { verifySignature, parseSendRequest } from '../../../../lib/server/dimtsLogic.mjs';
import { dimtsSecret, handleDimtsSend, unlinkDimts } from '../../../../lib/server/dimts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dimts -> MiniMe, signed with DIMTS_LINK_SECRET.
 * { type: 'send', ... }   send what the owner promised on a call
 * { type: 'unlink', user_id }   the owner disconnected MiniMe in Dimts
 */
export async function POST(request) {
  const body = await request.text();
  try {
    verifySignature({
      body,
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    }, dimtsSecret());
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let input;
  try { input = JSON.parse(body); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }

  if (input?.type === 'unlink') {
    if (typeof input.user_id !== 'string' || !input.user_id) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    await unlinkDimts(input.user_id);
    return NextResponse.json({ ok: true });
  }

  let req;
  try { req = parseSendRequest(input); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
  try {
    return NextResponse.json(await handleDimtsSend(req));
  } catch (e) {
    console.error('[dimts/send] failed:', e.message);
    return NextResponse.json({ error: 'send_failed' }, { status: 500 });
  }
}
