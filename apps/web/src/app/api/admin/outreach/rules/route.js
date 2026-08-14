/**
 * GET  /api/admin/outreach/rules — list all outreach rules (auto-trigger config)
 * POST /api/admin/outreach/rules — create a rule
 */
import { NextResponse } from 'next/server';
import { requireAdminRequest } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { audit } from '../../../../../lib/server/audit';
import { str, oneOf, num, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['nudge', 'feedback_prompt'];
const TRIGGER_TYPES = ['days_since_signup', 'days_since_active', 'trial_stage', 'usage_milestone', 'plan_tier', 'inactivity'];
const FEEDBACK_KINDS = ['nps', 'category', 'free_text'];

export async function GET(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabase();
  const { data, error } = await sb.from('outreach_rules').select('*').order('priority', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

export async function POST(request) {
  const admin = await requireAdminRequest(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  let key, name, description, kind, triggerType, triggerConfig, messageTemplate, feedbackPromptKind, cooldownDays, maxSends, priority, enabled;
  try {
    key = str(body.key, { field: 'key', min: 1, max: 60, required: true, stripHtml: true }).replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    name = str(body.name, { field: 'name', min: 1, max: 120, required: true, stripHtml: true });
    description = str(body.description || '', { field: 'description', max: 500, required: false });
    kind = oneOf(body.kind, KINDS, { field: 'kind', required: true });
    triggerType = oneOf(body.trigger_type, TRIGGER_TYPES, { field: 'trigger_type', required: true });
    if (body.trigger_config != null && typeof body.trigger_config !== 'object') {
      throw new ValidationError('trigger_config', 'must be an object');
    }
    triggerConfig = body.trigger_config || {};
    messageTemplate = str(body.message_template, { field: 'message_template', min: 1, max: 3800, required: true, stripHtml: false });
    feedbackPromptKind = body.feedback_prompt_kind ? oneOf(body.feedback_prompt_kind, FEEDBACK_KINDS, { field: 'feedback_prompt_kind' }) : null;
    cooldownDays = num(body.cooldown_days ?? 21, { field: 'cooldown_days', min: 0, max: 365, integer: true });
    maxSends = num(body.max_sends ?? 2, { field: 'max_sends', min: 1, max: 100, integer: true });
    priority = num(body.priority ?? 100, { field: 'priority', min: 0, max: 10000, integer: true });
    enabled = body.enabled !== false;
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const sb = supabase();
  const { data, error } = await sb.from('outreach_rules').insert({
    key, name, description: description || null, kind, trigger_type: triggerType, trigger_config: triggerConfig,
    message_template: messageTemplate, feedback_prompt_kind: feedbackPromptKind,
    cooldown_days: cooldownDays, max_sends: maxSends, priority, enabled,
    created_by: String(admin.id),
  }).select('*').single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A rule with that key already exists' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await audit({
    business_id: null, actor_type: 'platform_admin', actor_id: String(admin.id),
    action: 'outreach_rule.created', resource_type: 'outreach_rule', resource_id: data.id,
    metadata: { key, kind, trigger_type: triggerType }, request,
  });

  return NextResponse.json({ rule: data });
}
