/**
 * GET/POST /api/settings/secretary
 *
 * The personal-account (secretary) settings that used to exist only in the
 * database, reachable from Telegram buttons or not at all:
 *   - secretary_mode      'ask_first' | 'auto' | 'ghost' — what happens when a
 *                         NEW person messages the owner's personal account
 *   - ai_identity_mode    { customers, personal } — whether replies say it's an AI
 *   - owner_facts         string[] — what MiniMe believes about the owner's life,
 *                         extracted nightly; owners need to see and fix it
 *
 * Merged into a FRESH read of notification_prefs, never the client's copy: the
 * webhook writes pending_contacts / personal_contacts into the same object all
 * day, and a stale whole-object save from the settings page would erase them.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId, update as updateBusiness } from '../../../../lib/server/businesses';
import { prunePending } from '../../../../lib/server/contactRules.mjs';
import { modeExplainer, waitingCount } from '../../../../lib/server/secretaryCopy.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODES = ['ask_first', 'smart', 'auto', 'ghost'];
const RULES = ['auto', 'ask', 'never'];
const ALERTS = ['all', 'first', 'off'];
const IDENTITY = ['always_disclose', 'honest_when_asked', 'mimic_owner'];
// Defaults must match secretaryIdentityRule() in replyEngine.js.
const IDENTITY_DEFAULTS = { customers: 'honest_when_asked', personal: 'mimic_owner' };

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findByOwnerTelegramId(tg.id) : null;
}

function view(prefs = {}, business = null) {
  const idm = prefs.ai_identity_mode || {};
  const mode = MODES.includes(prefs.secretary_mode) ? prefs.secretary_mode : 'ask_first';
  return {
    // Status, so the page can say "connected" and what that means, instead of
    // showing "Not connected yet?" to everyone.
    connected: !!business?.telegram_biz_conn_id,
    explainer: modeExplainer(mode),
    waiting: waitingCount(prefs.pending_contacts, prunePending),
    secretary_mode: mode,
    ai_identity_mode: {
      customers: IDENTITY.includes(idm.customers) ? idm.customers : IDENTITY_DEFAULTS.customers,
      personal: IDENTITY.includes(idm.personal) ? idm.personal : IDENTITY_DEFAULTS.personal,
    },
    owner_facts: Array.isArray(prefs.owner_facts) ? prefs.owner_facts.filter(f => typeof f === 'string') : [],
    secretary_alerts: ALERTS.includes(prefs.secretary_alerts) ? prefs.secretary_alerts : 'all',
    alerts_personal: prefs.alerts_personal !== false,
    contact_rules: Object.entries(prefs.contact_rules || {})
      .filter(([, v]) => RULES.includes(v?.rule))
      .map(([id, v]) => ({ id, rule: v.rule, name: String(v.name || 'Contact').slice(0, 80) })),
  };
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(view(business.notification_prefs, business));
}

export async function POST(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}

  const prefs = { ...(business.notification_prefs || {}) };
  if (MODES.includes(body.secretary_mode)) prefs.secretary_mode = body.secretary_mode;
  if (body.ai_identity_mode && typeof body.ai_identity_mode === 'object') {
    const cur = prefs.ai_identity_mode || {};
    prefs.ai_identity_mode = {
      ...cur,
      ...(IDENTITY.includes(body.ai_identity_mode.customers) ? { customers: body.ai_identity_mode.customers } : {}),
      ...(IDENTITY.includes(body.ai_identity_mode.personal) ? { personal: body.ai_identity_mode.personal } : {}),
    };
  }
  if (ALERTS.includes(body.secretary_alerts)) prefs.secretary_alerts = body.secretary_alerts;
  if (typeof body.alerts_personal === 'boolean') prefs.alerts_personal = body.alerts_personal;
  // { id, rule } sets one person's rule; rule null/'reset' removes it.
  if (body.contact_rule && /^\d{1,20}$/.test(String(body.contact_rule.id))) {
    const id = String(body.contact_rule.id);
    const rules = { ...(prefs.contact_rules || {}) };
    if (RULES.includes(body.contact_rule.rule)) {
      rules[id] = { ...(rules[id] || {}), rule: body.contact_rule.rule, at: new Date().toISOString() };
    } else {
      delete rules[id];
    }
    prefs.contact_rules = rules;
  }
  if (Array.isArray(body.owner_facts)) {
    prefs.owner_facts = [...new Set(body.owner_facts
      .filter(f => typeof f === 'string')
      .map(f => f.trim().slice(0, 200))
      .filter(Boolean))].slice(0, 60);
  }

  const updated = await updateBusiness(business.id, { notification_prefs: prefs });
  return NextResponse.json({ ok: true, ...view(updated?.notification_prefs || prefs, updated || business) });
}
