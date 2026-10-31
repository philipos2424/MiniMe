import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publicBusiness } from '../../publicBusiness.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

test('secrets never reach the browser; everything else does', () => {
  const row = {
    id: 'b1', name: 'Shop', notification_prefs: { a: 1 }, telegram_bot_username: 'shop_bot',
    telegram_bot_token_enc: 'enc', webhook_secret: 's', meta_access_token_enc: 'm',
    onboarding_token: 'o', secretary_connection_id: 'c', some_api_key: 'k',
  };
  const out = publicBusiness(row);
  for (const k of ['telegram_bot_token_enc', 'webhook_secret', 'meta_access_token_enc', 'onboarding_token', 'secretary_connection_id', 'some_api_key']) {
    assert.equal(k in out, false, k);
  }
  assert.equal(out.name, 'Shop');
  assert.equal(out.telegram_bot_username, 'shop_bot');
  assert.equal(out.has_custom_bot, true);
  assert.equal(publicBusiness(null), null);
});

test('every Mini App route that returns the business row filters it', () => {
  for (const f of ['auth/telegram', 'settings/profile', 'onboarding/signup', 'businesses/restore']) {
    const src = readFileSync(`${here}../../../app/api/${f}/route.js`, 'utf8');
    assert.match(src, /publicBusiness\(/, f);
    assert.doesNotMatch(src, /NextResponse\.json\(\{ (ok: true, )?business(: (business|updated|restored))? \}\)/, f);
  }
});

test('dashboard tells owners when the bot cannot reach them', () => {
  const shell = readFileSync(`${here}../../../components/layout/DashboardShell.jsx`, 'utf8');
  assert.match(shell, /<OwnerUnreachableBanner business=\{business\} \/>/);
  assert.match(shell, /owner_dm_blocked/);
});
