/**
 * Audit logging — tamper-evident record of all security-sensitive operations.
 *
 * Every destructive or privileged API call should call audit() before returning.
 * Failures are silent (never block the main operation) but are logged to stderr
 * so Vercel/Sentry can surface them.
 *
 * SOC 2 Trust Service Criteria addressed:
 *  CC6.1  Logical access controls
 *  CC6.3  Registration and removal of authorized users
 *  CC6.6  Logical access security measures on infrastructure
 *  CC7.2  Monitor system components for anomalies
 */
import { supabase } from './db';

/**
 * Write an audit event.
 *
 * @param {object} opts
 * @param {string|null}  opts.business_id    — UUID of the affected business (null for platform-level events)
 * @param {'owner'|'staff'|'platform_admin'|'system'|'customer'} opts.actor_type
 * @param {string}       opts.actor_id       — Telegram ID, 'system', 'cron', etc.
 * @param {string}       opts.action         — Dot-notation event, e.g. 'refund.issued'
 * @param {string}       [opts.resource_type]— 'order', 'customer', 'discount', 'staff', etc.
 * @param {string}       [opts.resource_id]  — UUID of the affected resource
 * @param {object}       [opts.metadata]     — Arbitrary context (amounts, reasons, counts)
 * @param {Request}      [opts.request]      — If provided, extracts IP + User-Agent
 */
export async function audit({
  business_id = null,
  actor_type,
  actor_id,
  action,
  resource_type = null,
  resource_id = null,
  metadata = null,
  request = null,
}) {
  try {
    const ip = request
      ? (request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('x-real-ip') ||
         null)
      : null;
    const user_agent = request ? (request.headers.get('user-agent') || null) : null;

    await supabase().from('audit_logs').insert({
      business_id: business_id || null,
      actor_type,
      actor_id: String(actor_id),
      action,
      resource_type: resource_type || null,
      resource_id: resource_id ? String(resource_id) : null,
      metadata: metadata || null,
      ip,
      user_agent,
    });
  } catch (e) {
    // Never block the main operation — log to stderr only.
    console.error('[audit] Failed to write audit log:', e.message, { action, actor_id, resource_id });
  }
}

/**
 * Convenience builder for owner-initiated actions from API routes.
 * Reads actor info from the Telegram user + business objects.
 */
export function ownerAudit({ business, tgUser, request }) {
  return (action, resource_type, resource_id, metadata) =>
    audit({
      business_id: business?.id,
      actor_type: 'owner',
      actor_id: String(tgUser?.id || 'unknown'),
      action,
      resource_type,
      resource_id,
      metadata,
      request,
    });
}

/**
 * System-initiated audit (cron jobs, payment callbacks, etc.)
 */
export function systemAudit(business_id) {
  return (action, resource_type, resource_id, metadata) =>
    audit({
      business_id,
      actor_type: 'system',
      actor_id: 'system',
      action,
      resource_type,
      resource_id,
      metadata,
    });
}
