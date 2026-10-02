import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTelegramWebhookSecretConfigured, verifyTelegramWebhookSecret } from '../telegramWebhookAuth.mjs';

const secret = 'test_webhook-secret_123456789';
const request = value => ({ headers: new Headers(value === undefined ? {} : { 'x-telegram-bot-api-secret-token': value }) });

test('missing, malformed or excessive configured secrets fail closed', () => {
  for (const value of [undefined, null, '', ' ', 'bad secret', 'x'.repeat(257)]) {
    assert.equal(isTelegramWebhookSecretConfigured(value), false);
    assert.equal(verifyTelegramWebhookSecret(request(value == null ? undefined : value), value), false);
  }
});

test('webhook requires the exact configured secret', () => {
  assert.equal(verifyTelegramWebhookSecret(request(secret), secret), true);
  for (const value of [undefined, '', 'wrong', secret.slice(0, -1) + '0', secret + 'x']) {
    assert.equal(verifyTelegramWebhookSecret(request(value), secret), false);
  }
});

// Execute the route's real admission code with a sentinel where payload handling
// begins. Rejected requests must never reach JSON parsing or business operations.
const webhookSource = readFileSync(new URL('../../../app/api/agent-bot/webhook/route.js', import.meta.url), 'utf8');
const admission = webhookSource.split('export async function POST(request) {')[1]
  .split('const update = await request.json();')[0];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runAdmission = new AsyncFunction('request', 'WEBHOOK_SECRET', 'AGENT_TOKEN', 'isTelegramWebhookSecretConfigured', 'verifyTelegramWebhookSecret', 'NextResponse', 'console',
  `${admission} return { admitted: true }; } catch (error) { throw error; }`);
const response = { json: (body, options) => ({ body, status: options?.status || 200 }) };
const quiet = { error() {}, warn() {} };

test('agent webhook refuses missing config and forged owner updates before parsing', async () => {
  for (const [configured, header, status] of [['', undefined, 503], ['', secret, 503], ['bad secret', secret, 503], [secret, undefined, 403], [secret, 'wrong', 403]]) {
    const req = { ...request(header), json() { assert.fail('unauthorized payload was parsed'); } };
    const result = await runAdmission(req, configured, 'bot-token', isTelegramWebhookSecretConfigured, verifyTelegramWebhookSecret, response, quiet);
    assert.equal(result.status, status);
  }
  const result = await runAdmission(request(secret), secret, 'bot-token', isTelegramWebhookSecretConfigured, verifyTelegramWebhookSecret, response, quiet);
  assert.equal(result.admitted, true);
});

test('setup refuses missing or malformed secrets before webhook registration', async () => {
  const source = readFileSync(new URL('../../../app/api/agent-bot/setup/route.js', import.meta.url), 'utf8');
  const prefix = source.split('export async function GET(request) {')[1].split('const webhookUrl =')[0];
  const runSetup = new AsyncFunction('request', 'process', 'isCronAuthorized', 'isTelegramWebhookSecretConfigured', 'NextResponse', `${prefix} return { admitted: true };`);
  for (const configured of [undefined, '', ' ', 'bad secret']) {
    const result = await runSetup(request(), { env: { TELEGRAM_BOT_TOKEN: 'test', AGENT_BOT_WEBHOOK_SECRET: configured } }, () => true, isTelegramWebhookSecretConfigured, response);
    assert.equal(result.status, 503);
  }
  const result = await runSetup(request(), { env: { TELEGRAM_BOT_TOKEN: 'test', AGENT_BOT_WEBHOOK_SECRET: secret } }, () => true, isTelegramWebhookSecretConfigured, response);
  assert.equal(result.admitted, true);
});

test('automatic webhook repair refuses missing secrets without contacting Telegram', async () => {
  const source = readFileSync(new URL('../sharedWebhookGuard.js', import.meta.url), 'utf8');
  const body = source.replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  let calls = 0;
  const load = new Function('process', 'isTelegramWebhookSecretConfigured', 'allowedUpdates', 'fetch', `${body}; return ensureSharedWebhook;`);
  for (const configured of [undefined, '', 'bad secret']) {
    const repair = load({ env: { TELEGRAM_BOT_TOKEN: 'test', WEB_URL: 'https://example.test', AGENT_BOT_WEBHOOK_SECRET: configured } }, isTelegramWebhookSecretConfigured, () => [], async () => { calls++; assert.fail('contacted Telegram with invalid config'); });
    assert.match((await repair({ force: true })).error, /SECRET missing or invalid/);
  }
  assert.equal(calls, 0);
});
