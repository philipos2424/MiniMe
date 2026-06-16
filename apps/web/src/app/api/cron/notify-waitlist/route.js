/**
 * POST /api/cron/notify-waitlist
 *
 * Runs daily. Finds unnotified waitlist entries whose category or keywords
 * now match at least one visible business, and sends a Telegram message
 * via @minimesearchbot to let the user know.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function tg(method, body) {
  const token = process.env.SEARCH_BOT_TOKEN;
  if (!token) return null;
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) } },
  );

  // Get all pending waitlist entries (not yet notified)
  const { data: waitlist } = await sb
    .from('search_waitlist')
    .select('*')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(200);

  if (!waitlist?.length) {
    return NextResponse.json({ ok: true, notified: 0, message: 'No pending waitlist entries' });
  }

  let notified = 0;

  for (const entry of waitlist) {
    try {
      // Check if any business now matches this entry's category + keywords
      let q = sb
        .from('businesses')
        .select('id, name, telegram_bot_username, category, tags, description')
        .eq('b2b_discoverable', true)
        .not('telegram_bot_username', 'is', null);

      if (entry.parsed_category) q = q.eq('category', entry.parsed_category);
      q = q.limit(3);

      const { data: matches } = await q;

      // Check keyword overlap
      const kws = Array.isArray(entry.keywords) ? entry.keywords.map(k => k.toLowerCase()) : [];
      const goodMatches = (matches || []).filter(b => {
        if (!kws.length) return true; // category match alone is sufficient
        const hay = [b.name, b.description, ...(b.tags || [])].join(' ').toLowerCase();
        return kws.some(k => hay.includes(k));
      });

      // Also check products table for keyword matches
      let productMatchBizIds = new Set();
      if (kws.length) {
        try {
          const orFilter = kws.map(k => `name.ilike.%${k}%,description.ilike.%${k}%`).join(',');
          const { data: productHits } = await sb
            .from('products')
            .select('business_id')
            .eq('is_active', true)
            .or(orFilter)
            .limit(10);
          (productHits || []).forEach(p => productMatchBizIds.add(p.business_id));
        } catch {}
      }

      // Fetch full info for product-matched businesses not already in goodMatches
      const alreadyIds = new Set(goodMatches.map(b => b.id));
      const extraIds = [...productMatchBizIds].filter(id => !alreadyIds.has(id));
      if (extraIds.length) {
        const { data: extras } = await sb
          .from('businesses')
          .select('id, name, telegram_bot_username, category')
          .eq('b2b_discoverable', true)
          .not('telegram_bot_username', 'is', null)
          .in('id', extraIds);
        if (extras?.length) goodMatches.push(...extras);
      }

      if (!goodMatches.length) continue; // still no match, skip

      // Send notification
      const bizLines = goodMatches.slice(0, 3).map(b =>
        `• *${b.name}* → @${b.telegram_bot_username}`
      ).join('\n');

      await tg('sendMessage', {
        chat_id: entry.searcher_telegram_id,
        parse_mode: 'Markdown',
        text: `🔔 *Good news!* A business matching your search _"${entry.raw_query.slice(0, 60)}"_ just joined MiniMe:\n\n${bizLines}\n\nTap to chat with them instantly!`,
        disable_web_page_preview: true,
      });

      // Mark as notified
      await sb
        .from('search_waitlist')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', entry.id);

      notified++;
    } catch (e) {
      console.warn('[notify-waitlist] entry', entry.id, e.message);
    }
  }

  return NextResponse.json({ ok: true, notified, total: waitlist.length });
}
