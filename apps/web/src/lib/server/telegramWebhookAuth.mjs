import { timingSafeEqual } from 'node:crypto';

// Telegram's secret_token accepts 1–256 ASCII letters, digits, underscores and hyphens.
export function isTelegramWebhookSecretConfigured(secret) {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(secret);
}

export function verifyTelegramWebhookSecret(request, secret) {
  if (!isTelegramWebhookSecretConfigured(secret)) return false;
  const received = request.headers.get('x-telegram-bot-api-secret-token') || '';
  const actual = Buffer.from(received);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
