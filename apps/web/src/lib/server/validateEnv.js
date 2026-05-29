/**
 * Environment variable validation.
 * Called once at startup / in critical API routes.
 * Returns { ok, missing } — never throws.
 */

const REQUIRED = [
  'OPENAI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_KEY',
  'WEB_URL',
  'CRON_SECRET',
];

const PAYMENT_REQUIRED = ['CHAPA_SECRET_KEY'];

let _checked = false;
let _result = null;

export function validateEnv() {
  if (_checked) return _result;
  _checked = true;

  const missing = REQUIRED.filter(k => !process.env[k]);
  const missingPayment = PAYMENT_REQUIRED.filter(k => !process.env[k]);

  if (missing.length) {
    console.error('[startup] CRITICAL — missing env vars:', missing.join(', '));
  }
  if (missingPayment.length) {
    console.warn('[startup] WARNING — payment env vars missing:', missingPayment.join(', '), '(payments will silently fail)');
  }

  _result = { ok: missing.length === 0, missing, missingPayment };
  return _result;
}

export function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Required env var "${key}" is not set. Check Vercel dashboard → Settings → Environment Variables.`);
  return val;
}
