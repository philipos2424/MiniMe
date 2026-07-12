/**
 * GET /api/admin/files — all file attachments sent across all businesses.
 * Admin-only (ADMIN_TELEGRAM_IDS).
 */
import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { requireAdminRequest } from '../../../../lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const tg = await requireAdminRequest(request);
  if (!tg) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // This surfaces customer names + media across EVERY tenant in one call —
  // log the access (GDPR Art. 5(2) accountability). Fire-and-forget.
  audit({
    business_id: null,
    actor_type: 'platform_admin',
    actor_id: String(tg.id),
    action: 'admin.files_viewed',
    resource_type: 'messages',
    request,
  }).catch(() => {});

  const sb = supabase();

  // Get all messages with file attachments
  const { data: msgs } = await sb.from('messages')
    .select(`
      id, created_at, file_url, file_type, file_name, media_url, media_type, media_filename,
      business_id, conversation_id, direction,
      businesses(name),
      conversations(customer_id, customers(name, telegram_username))
    `)
    .or('file_url.neq.null,media_url.neq.null')
    .order('created_at', { ascending: false })
    .limit(200);

  const files = (msgs || []).map(m => ({
    id: m.id,
    created_at: m.created_at,
    file_url:   m.file_url  || m.media_url  || null,
    file_type:  m.file_type || m.media_type || null,
    file_name:  m.file_name || m.media_filename || null,
    direction:  m.direction,
    business_id: m.business_id,
    business_name: m.businesses?.name || null,
    conversation_id: m.conversation_id,
    customer_name: m.conversations?.customers?.name
      || (m.conversations?.customers?.telegram_username ? `@${m.conversations.customers.telegram_username}` : null),
  }));

  return NextResponse.json({ files });
}
