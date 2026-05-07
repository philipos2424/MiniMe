/**
 * POST /api/teach
 * Body: { description?, urls?: string[], forwardedSnippets?: string[] }
 *
 * Pushes raw owner knowledge through the teaching pipeline:
 *   - description → extract structured facts → save as business brief (embedded)
 *   - urls        → ingestUrl for each
 *   - snippets    → extract client facts → save (orphaned if no client match)
 *
 * Returns a per-input result so the UI can show what was learned.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../lib/server/businesses';
import { teachFromText } from '../../../lib/server/teaching';
import { ingestUrl } from '../../../lib/server/webIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const description = (body.description || '').trim();
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const snippets = Array.isArray(body.forwardedSnippets) ? body.forwardedSnippets.filter(Boolean) : [];

  const out = { description: null, urls: [], snippets: [] };

  if (description) {
    out.description = await teachFromText(business.id, description);
  }
  for (const u of urls) {
    try {
      const r = await ingestUrl({ businessId: business.id, url: u, tag: 'taught-url' });
      out.urls.push({ url: u, ...r });
    } catch (e) {
      out.urls.push({ url: u, ok: false, error: e.message });
    }
  }
  for (const s of snippets) {
    try {
      const r = await teachFromText(business.id, s, { forwardedFrom: 'pasted-snippet' });
      out.snippets.push({ ok: r.ok, summary: r.extracted?.summary });
    } catch (e) {
      out.snippets.push({ ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: true, result: out });
}
