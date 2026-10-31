/**
 * The business row as the browser may see it (pure).
 *
 * Mini App endpoints returned businesses.* straight to the client — including
 * the encrypted bot token, the Telegram webhook secret, the encrypted Meta
 * access token and the onboarding token. Only the owner's own row, behind
 * verified initData, but none of it is used client-side and none of it should
 * ever leave the server.
 */
export const SERVER_ONLY_BUSINESS_FIELDS = [
  'telegram_bot_token_enc',
  'webhook_secret',
  'meta_access_token_enc',
  'onboarding_token',
  'secretary_connection_id',
];

const looksSecret = (k) => /(_enc|_secret|_token|_api_key|_password|_hash)$/.test(k);

export function publicBusiness(row) {
  if (!row || typeof row !== 'object') return row ?? null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SERVER_ONLY_BUSINESS_FIELDS.includes(k) || looksSecret(k)) continue;
    out[k] = v;
  }
  // Callers check "is a custom bot connected?" — keep that answer without the token.
  if ('telegram_bot_token_enc' in row) out.has_custom_bot = !!row.telegram_bot_token_enc;
  return out;
}
