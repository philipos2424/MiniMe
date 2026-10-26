/**
 * Native confirm/alert/prompt are silently blocked inside Telegram's webview,
 * so every admin action guarded by confirm() (delete business, erase customer,
 * impersonate, bulk-activate, notify owners, revoke) was a no-op there, and
 * "Message owner" (prompt) could never send. Bulk actions also sat first on Pulse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../../', import.meta.url));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (/\.(js|jsx)$/.test(n) ? [p] : []);
});
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no native dialogs anywhere in the admin', () => {
  const files = [...walk(join(src, 'app/admin')), ...walk(join(src, 'components/admin'))];
  const offenders = files.filter(f => /(^|[^\w.])(confirm|alert|prompt)\(|window\.(confirm|alert|prompt)\(/.test(strip(readFileSync(f, 'utf8'))));
  assert.deepEqual(offenders.map(f => f.slice(src.length)), []);
});

test('tgConfirm never treats an oversize or failed popup as yes', async () => {
  globalThis.window = { Telegram: { WebApp: { showConfirm: (msg, cb) => { if (msg.length > 256) throw new Error('WebAppPopupParamInvalid'); cb(true); } } } };
  const { tgConfirm } = await import('../../utils.js');
  assert.equal(await tgConfirm('x'.repeat(300)), true, 'long text is truncated, not rejected');
  window.Telegram.WebApp.showConfirm = () => { throw new Error('WebAppPopupOpened'); };
  assert.equal(await tgConfirm('Delete?'), false);
  delete globalThis.window;
});

test('bulk actions are last on Pulse and closed by default', () => {
  const page = readFileSync(join(src, 'app/admin/page.js'), 'utf8').replace(/\r\n/g, '\n');
  const pulse = page.slice(page.indexOf('function PulseTab('), page.indexOf('function BulkActionsSection('));
  assert.doesNotMatch(pulse, /<BulkActivateTrials|<BulkChannelImport/);
  assert.match(pulse, /<BulkActionsSection initData=\{initData\} \/>\n    <\/div>\n  \);\n\}/);
  assert.match(page, /function BulkActionsSection\(\{ initData \}\) \{\n  const \[open, setOpen\] = useState\(false\);/);
});

test('deleting a business still needs the typed confirmation, now inline', () => {
  const page = readFileSync(join(src, 'app/admin/page.js'), 'utf8');
  assert.match(page, /if \(deleteTyped !== `DELETE \$\{name\}`\) return;/);
  assert.match(page, /disabled=\{busy \|\| deleteTyped !== `DELETE \$\{data\?\.business\?\.name \|\| businessId\}`\}/);
});
