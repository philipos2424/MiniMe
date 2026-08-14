/**
 * PATCH  /api/admin/outreach/rules/:id — edit / enable / disable a rule
 * DELETE /api/admin/outreach/rules/:id — remove a rule
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../../lib/server/admin';
import { supabase } from '../../../../../../lib/server/db';
import { audit } from '../../../../../../lib/server/audit';
import { str, oneOf, num, ValidationError, validationResponse } from '../../../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEEDBACK_KINDS = ['nps', 'category', 'free_text'];

export async function PATCH(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch = {};
  try {
    if (body.name !== undefined) patch.name = str(body.name, { field: 'name', min: 1, max: 120, required: true, stripHtml: true });
    if (body.description !== undefined) patch.description = str(body.description || '', { field: 'description', max: 500 }) || null;
    if (body.trigger_config !== undefined) {
      if (typeof body.trigger_config !== 'object' || body.trigger_config === null) throw new ValidationError('trigger_config', 'must be an object');
      patch.trigger_config = body.trigger_config;
    }
    if (body.message_template !== undefined) patch.message_template = str(body.message_template, { field: 'message_template', min: 1, max: 3800, required: true, stripHtml: false });
    if (body.feedback_prompt_kind !== undefined) patch.feedback_prompt_kind = body.feedback_prompt_kind ? oneOf(body.feedback_prompt_kind, FEEDBACK_KINDS, { field: 'feedback_prompt_kind' }) : null;
    if (body.cooldown_days !== undefined) patch.cooldown_days = num(body.cooldown_days, { field: 'cooldown_days', min: 0, max: 365, integer: true, required: true });
    if (body.max_sends !== undefined) patch.max_sends = num(body.max_sends, { field: 'max_sends', min: 1, max: 100, integer: true, required: true });
    if (body.priority !== undefined) patch.priority = num(body.priority, { field: 'priority', min: 0, max: 10000, integer: true, required: true });
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: 'no_changes' }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const sb = supabase();
  const { data, error } = await sb.from('outreach_rules').update(patch).eq('id', params.id).select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await audit({
    business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: 'outreach_rule.updated', resource_type: 'outreach_rule', resource_id: params.id,
    metadata: { changed: Object.keys(patch) }, request,
  });

  return NextResponse.json({ rule: data });
}

export async function DELETE(request, { params }) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { error } = await sb.from('outreach_rules').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: 'outreach_rule.deleted', resource_type: 'outreach_rule', resource_id: params.id,
    request,
  });

  return NextResponse.json({ ok: true });
}
