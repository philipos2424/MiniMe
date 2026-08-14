/**
 * replyEngine.js's B2B callback handlers. Can't be imported directly here
 * (extensionless specifiers only the Next bundler resolves — same reason
 * b2b.js and research.js get source-text tests, see b2b.test.mjs), so this
 * asserts against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

// Regression: tapping "negotiate with the winner" on a research report used
// to silently set b2b_auto_negotiate = true — the owner never asked for
// autonomy, they tapped a button to start a conversation. Autonomy now comes
// only from the b2b_autonomy setting the owner explicitly picked in /b2b.
test('campaign_negotiate no longer silently flips b2b_auto_negotiate to true', () => {
  const fn = src.match(/if \(action === 'campaign_negotiate'\) \{[\s\S]*?\n {6}\}\n\n {6}if \(action ===/)?.[0]
    || src.slice(src.indexOf("action === 'campaign_negotiate'"));
  assert.doesNotMatch(fn, /b2b_auto_negotiate: true/);
  assert.match(fn, /getB2BAutonomy/);
  assert.match(fn, /describeB2BAutonomy/);
});

// Two "not a fit"/"deal approval" callbacks need no free-typing at all —
// the genuinely one-tap actions this session added.
test('notfit and deal-approval callbacks resolve without requiring the owner to type anything', () => {
  assert.match(src, /if \(action === 'notfit'\) \{/);
  assert.match(src, /if \(action === 'dealok' \|\| action === 'dealno'\) \{/);
  // The cached offer is cleared on tap so a replayed callback can't re-fire it.
  assert.match(src, /delete remaining\[id\];/);
});
