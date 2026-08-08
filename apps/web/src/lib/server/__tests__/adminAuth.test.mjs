/**
 * Every /api/admin/* route must gate on requireAdminRequest.
 *
 * /api/admin/billing shipped without it. Unauthenticated GET returned every
 * subscription joined to businesses(name, owner_name, email) — the PII of all
 * 855 shops — to anyone on the internet, and POST could grant credits or
 * suspend any account. It was the only admin route missing the gate, which is
 * exactly how this kind of hole survives review: the pattern is everywhere, so
 * the one omission looks like the others.
 *
 * This walks the route files rather than trusting anyone to remember.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const adminApi = `${root}apps/web/src/app/api/admin`;

function routeFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routeFiles(p, acc);
    else if (entry === 'route.js') acc.push(p);
  }
  return acc;
}

const HANDLERS = /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g;

// Legitimate gates: an admin identity, the CRON_SECRET bearer token used by
// the ops routes Vercel Cron calls unattended, or the local `gate(request)`
// wrapper several routes define around requireAdminRequest.
const GATE = /requireAdminRequest\(|requireAdmin\(|isAdmin\(|isCronAuthorized\(|\bgate\w*\(request\)/;

// Handlers that are deliberately open, with the reason. Anything not on this
// list must be gated.
const PUBLIC_BY_DESIGN = new Set([
  // Ending your own session must work even once the session is invalid.
  'auth/logout/route.js:POST',
  // Mints the session; it authenticates the Telegram login payload itself.
  'auth/login/route.js:POST',
]);

// Windows paths use backslashes; normalise before slicing or the labels come
// out as single characters and the failure message is useless.
const rel = f => f.replace(/\\/g, '/').split('api/admin/')[1] || f;

test('every admin route file carries some auth gate', () => {
  const missing = routeFiles(adminApi)
    .filter(f => !GATE.test(readFileSync(f, 'utf8')))
    .map(rel)
    .filter(r => ![...PUBLIC_BY_DESIGN].some(p => p.startsWith(r)));
  assert.deepEqual(missing, [], `admin routes with no auth: ${missing.join(', ')}`);
});

test('every exported handler in an admin route calls the gate in its own body', () => {
  // Per-handler, not a file-wide count: a single gate call in one handler must
  // not vouch for a sibling handler that has none. That is precisely the shape
  // the billing route was in.
  const offenders = [];
  for (const f of routeFiles(adminApi)) {
    const src = readFileSync(f, 'utf8');
    const starts = [...src.matchAll(HANDLERS)];
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i].index;
      const to = i + 1 < starts.length ? starts[i + 1].index : src.length;
      const id = `${rel(f)}:${starts[i][1]}`;
      if (PUBLIC_BY_DESIGN.has(id)) continue;
      if (!GATE.test(src.slice(from, to))) offenders.push(id);
    }
  }
  assert.deepEqual(offenders, [], `ungated admin handlers: ${offenders.join(', ')}`);
});

test('the billing route specifically is gated on both verbs', () => {
  // The one that was live and open. Named explicitly so a refactor that drops
  // it fails loudly rather than blending into the sweep above.
  const src = readFileSync(`${adminApi}/billing/route.js`, 'utf8');
  for (const verb of ['GET', 'POST']) {
    const at = src.indexOf(`export async function ${verb}`);
    assert.ok(at > 0, `${verb} handler missing`);
    const body = src.slice(at, at + 400);
    assert.match(body, /requireAdminRequest\(request\)/, `${verb} is not gated`);
    assert.match(body, /403/, `${verb} does not return 403`);
  }
});
