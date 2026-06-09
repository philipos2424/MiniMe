/**
 * GET  /api/team/staff  — list current sub-admins (staff)
 * POST /api/team/staff  — add a staff member by Telegram ID or username
 * DELETE /api/team/staff?telegram_id=xxx — remove a staff member
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { decrypt } from '../../../../lib/server/crypto';
import { requireOwner } from '../../../../lib/server/auth';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function auth(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  return business ? { business, tg } : null;
}

export async function GET(request) {
  const session = await auth(request);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { business } = session;
  const ids = business.sub_admin_telegram_ids || [];
  const staff = ids.map(id => ({ telegram_id: id }));

  // Enrich with cached names if we have them stored in meta
  const nameMeta = business.meta?.staff_names || {};
  const enriched = staff.map(s => ({ ...s, name: nameMeta[s.telegram_id] || null }));

  return NextResponse.json({ staff: enriched });
}

export async function POST(request) {
  const session = await auth(request);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { business, tg } = session;
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can add staff.' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const raw = (body.telegram_id || body.username || '').toString().trim().replace(/^@/, '');
  if (!raw) return NextResponse.json({ error: 'telegram_id_or_username_required' }, { status: 400 });

  // Resolve the Telegram ID if a username was given
  let telegramId = null;
  let resolvedName = null;

  if (/^\d+$/.test(raw)) {
    telegramId = parseInt(raw, 10);
  } else {
    // Try to resolve username via getChat using the business bot token
    let token;
    if (business.telegram_bot_token_enc) {
      try { token = decrypt(business.telegram_bot_token_enc); } catch {}
    }
    token = token || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: `@${raw}` }),
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json();
        if (j?.ok && j.result?.id) {
          telegramId = j.result.id;
          resolvedName = [j.result.first_name, j.result.last_name].filter(Boolean).join(' ') || j.result.username || null;
        }
      } catch {}
    }
    if (!telegramId) return NextResponse.json({ error: 'could_not_resolve_username', detail: `Could not find @${raw} on Telegram. Make sure the username is correct.` }, { status: 400 });
  }

  if (telegramId === business.owner_telegram_id) {
    return NextResponse.json({ error: 'cannot_add_owner', detail: 'You are already the owner.' }, { status: 400 });
  }

  const current = business.sub_admin_telegram_ids || [];
  if (current.includes(telegramId)) {
    return NextResponse.json({ error: 'already_staff', detail: 'This person is already on your staff.' }, { status: 400 });
  }

  const updated = [...current, telegramId];
  const nameMeta = business.meta?.staff_names || {};
  if (resolvedName) nameMeta[telegramId] = resolvedName;

  const { error } = await supabase()
    .from('businesses')
    .update({
      sub_admin_telegram_ids: updated,
      meta: { ...(business.meta || {}), staff_names: nameMeta },
    })
    .eq('id', business.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'staff.added', resource_type: 'staff', resource_id: String(telegramId),
    metadata: { name: resolvedName }, request,
  });

  return NextResponse.json({ ok: true, staff_member: { telegram_id: telegramId, name: resolvedName } });
}

export async function DELETE(request) {
  const session = await auth(request);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { business, tg } = session;
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can remove staff.' }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('telegram_id');
  if (!idParam) return NextResponse.json({ error: 'telegram_id_required' }, { status: 400 });

  const removeId = parseInt(idParam, 10);
  const updated = (business.sub_admin_telegram_ids || []).filter(id => id !== removeId);

  const nameMeta = { ...(business.meta?.staff_names || {}) };
  delete nameMeta[removeId];

  await supabase()
    .from('businesses')
    .update({
      sub_admin_telegram_ids: updated,
      meta: { ...(business.meta || {}), staff_names: nameMeta },
    })
    .eq('id', business.id);

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'staff.removed', resource_type: 'staff', resource_id: String(removeId),
    metadata: { removed_name: (business.meta?.staff_names || {})[removeId] || null }, request,
  });

  return NextResponse.json({ ok: true });
}
