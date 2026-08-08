/**
 * Editable platform config (payment accounts, receipt issuer, gateway keys).
 *
 * Reads DB first, then falls back to the original env vars so nothing breaks
 * for a setup that still uses them. The DB wins because it's the thing an admin
 * can actually change.
 *
 * NO PLACEHOLDER DEFAULTS anywhere in here. An unset payment account must make
 * its rail unavailable, never produce a plausible-looking wrong number on a
 * payment screen — that's the bug this whole area came from.
 */
import { supabase } from './db.js';
import { encrypt, decrypt } from './crypto.js';

// Short TTL: settings change rarely but must take effect promptly after an
// admin saves, without a redeploy.
const TTL_MS = 30 * 1000;
let cache = null; // { at, map }

/** Setting keys, their env fallback, and whether the value is a secret. */
export const SETTING_DEFS = [
  { key: 'payment.telebirr.phone',  env: 'PLATFORM_TELEBIRR_PHONE',  label: 'Telebirr phone',      group: 'Telebirr' },
  { key: 'payment.telebirr.name',   env: 'PLATFORM_TELEBIRR_NAME',   label: 'Telebirr account name', group: 'Telebirr' },
  { key: 'payment.bank.name',       env: 'PLATFORM_BANK_NAME',       label: 'Bank name',           group: 'Bank transfer' },
  { key: 'payment.bank.account',    env: 'PLATFORM_BANK_ACCOUNT',    label: 'Account number',      group: 'Bank transfer' },
  { key: 'payment.bank.holder',     env: 'PLATFORM_BANK_HOLDER',     label: 'Account holder',      group: 'Bank transfer' },
  { key: 'receipt.issuer.name',     env: 'RECEIPT_ISSUER_NAME',      label: 'Business name',       group: 'Receipt' },
  { key: 'receipt.issuer.tin',      env: 'RECEIPT_ISSUER_TIN',       label: 'TIN',                 group: 'Receipt' },
  { key: 'receipt.issuer.contact',  env: 'RECEIPT_ISSUER_CONTACT',   label: 'Contact',             group: 'Receipt' },
  { key: 'gateway.chapa.secret',    env: 'CHAPA_SECRET_KEY',         label: 'Chapa secret key',    group: 'Card gateways', secret: true },
  { key: 'gateway.stripe.secret',   env: 'STRIPE_SECRET_KEY',        label: 'Stripe secret key',   group: 'Card gateways', secret: true },
  { key: 'gateway.paypal.id',       env: 'PAYPAL_CLIENT_ID',         label: 'PayPal client ID',    group: 'Card gateways', secret: true },
  { key: 'gateway.paypal.secret',   env: 'PAYPAL_CLIENT_SECRET',     label: 'PayPal secret',       group: 'Card gateways', secret: true },
];

const DEF_BY_KEY = new Map(SETTING_DEFS.map(d => [d.key, d]));

async function loadMap() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map();
  try {
    const sb = supabase();
    if (sb) {
      const { data } = await sb.from('platform_settings').select('key, value, encrypted');
      for (const row of data || []) {
        let v = row.value;
        if (v && row.encrypted) {
          try { v = decrypt(v); } catch { v = null; } // unreadable == unset
        }
        if (v) map.set(row.key, v);
      }
    }
  } catch (e) {
    console.warn('[platformSettings] load failed, using env only:', e.message);
  }
  cache = { at: Date.now(), map };
  return map;
}

export function invalidateSettingsCache() { cache = null; }

/** One setting: DB value, else env fallback, else null. Never a placeholder. */
export async function getSetting(key) {
  const map = await loadMap();
  if (map.has(key)) return map.get(key);
  const def = DEF_BY_KEY.get(key);
  const envVal = def?.env ? process.env[def.env] : null;
  if (!envVal) return null;
  // A leftover 'sk-placeholder' style value is not configuration.
  return /placeholder/i.test(envVal) ? null : envVal;
}

/** Resolve many at once. */
export async function getSettings(keys) {
  const out = {};
  for (const k of keys) out[k] = await getSetting(k);
  return out;
}

/**
 * Write settings. Secrets are encrypted at rest with the same AES-256-GCM
 * helper used for bot tokens. An empty string CLEARS a setting (and so turns
 * its payment rail off) rather than storing '' as a value.
 */
export async function saveSettings(entries, updatedBy = null) {
  const sb = supabase();
  if (!sb) throw new Error('database unavailable');

  const rows = [];
  const clears = [];
  for (const [key, raw] of Object.entries(entries)) {
    const def = DEF_BY_KEY.get(key);
    if (!def) continue; // ignore unknown keys rather than storing junk
    const val = typeof raw === 'string' ? raw.trim() : raw;
    if (!val) { clears.push(key); continue; }
    rows.push({
      key,
      value: def.secret ? encrypt(val) : val,
      encrypted: !!def.secret,
      updated_by: updatedBy ? String(updatedBy) : null,
    });
  }

  if (rows.length) {
    const { error } = await sb.from('platform_settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }
  if (clears.length) {
    const { error } = await sb.from('platform_settings').delete().in('key', clears);
    if (error) throw error;
  }

  invalidateSettingsCache();
  return { saved: rows.length, cleared: clears.length };
}

/** Admin-facing view. Secrets are never returned — only whether they're set. */
export async function describeSettings() {
  const map = await loadMap();
  return SETTING_DEFS.map(d => {
    const fromDb = map.get(d.key) || null;
    const fromEnv = d.env ? process.env[d.env] : null;
    const effective = fromDb || (fromEnv && !/placeholder/i.test(fromEnv) ? fromEnv : null);
    return {
      key: d.key,
      label: d.label,
      group: d.group,
      secret: !!d.secret,
      // Secrets: existence only, never the value — an admin screen is still a
      // place a shoulder-surfer or a screenshot can leak a live API key.
      value: d.secret ? null : (effective || ''),
      isSet: !!effective,
      source: fromDb ? 'admin' : (effective ? 'env' : null),
    };
  });
}
