/**
 * In-app Assistant chat — same brain as the Telegram owner chat (runOwnerAgent),
 * sharing the owner_chat history so the thread is continuous across both.
 *
 * GET  → { history }            recent owner_chat turns for the screen
 * POST { message } → { replies } run the agent, persist the turn
 */
import { NextResponse } from 'next/server';
import { authenticate } from '../../../../lib/server/auth';
import { decrypt } from '../../../../lib/server/crypto';
import { runOwnerAgent, loadOwnerHistory, saveOwnerHistory } from '../../../../lib/server/ownerCommands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AGENT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

function resolveToken(business) {
  if (business?.telegram_bot_token_enc) {
    try { return decrypt(business.telegram_bot_token_enc); } catch {}
  }
  return AGENT_TOKEN;
}

export async function GET(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const history = await loadOwnerHistory(auth.business.id);
    return NextResponse.json({ history });
  } catch (e) {
    console.error('[agent/assistant GET]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const auth = await authenticate(request);
    if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { message } = await request.json().catch(() => ({}));
    const text = (message || '').trim();
    if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });

    const business = auth.business;
    const token = resolveToken(business);
    const history = await loadOwnerHistory(business.id);

    const { outputs } = await runOwnerAgent({ token, business, ownerText: text, history });
    // Normalize to { text, taskId? }. taskId means a draft awaiting approval —
    // the UI shows Send / Cancel.
    const replies = (outputs || [])
      .filter(Boolean)
      .map(o => (typeof o === 'string' ? { text: o } : { text: o.text || '', taskId: o.taskId || null }))
      .filter(r => r.text);

    await saveOwnerHistory(business.id, [
      ...history,
      { role: 'user', content: text.slice(0, 800) },
      { role: 'assistant', content: replies.map(r => r.text).join('\n\n').slice(0, 800) },
    ]);

    return NextResponse.json({ replies });
  } catch (e) {
    console.error('[agent/assistant POST]', e.message);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
