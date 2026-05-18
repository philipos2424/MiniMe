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
import { findBusinessForUser } from '../../../lib/server/businesses';
import { teachFromText } from '../../../lib/server/teaching';
import { ingestUrl } from '../../../lib/server/webIngest';
import { rateLimit, getIP } from '../../../lib/server/rateLimit';
import { str, arr, url as urlVal, ValidationError } from '../../../lib/server/sanitize';

// Private IP ranges to block SSRF in URL ingestion
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0)/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  // Rate limit: 10 teach requests per minute per IP (embedding calls are expensive)
  const { ok: rl, retryAfter } = rateLimit(getIP(request), 'teach', 10, 60);
  if (!rl) return NextResponse.json({ error: 'too_many_requests', retryAfter }, { status: 429 });

  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  // ── Input validation & bounds checking ────────────────────────────────────
  let description = '';
  let urls = [];
  let snippets = [];
  try {
    description = str(body.description, { field: 'description', max: 10000, required: false }) || '';
    const rawUrls = arr(body.urls, { field: 'urls', maxLen: 10, required: false });
    const rawSnippets = arr(body.forwardedSnippets, { field: 'forwardedSnippets', maxLen: 50, required: false });

    // Validate each URL — SSRF prevention via urlVal (blocks private IPs)
    for (const u of rawUrls) {
      try {
        const safe = urlVal(u, { field: 'url' });
        if (safe) urls.push(safe);
      } catch {} // skip invalid URLs silently
    }

    // Cap each snippet to prevent context window attacks
    snippets = rawSnippets.map((s, i) => str(s, { field: `snippet[${i}]`, max: 2000, required: false })).filter(Boolean);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

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
