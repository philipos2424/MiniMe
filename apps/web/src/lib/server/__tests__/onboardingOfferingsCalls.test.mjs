import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// 525 of 781 onboarding_offerings calls in one week came less than a minute
// after the same shop's previous call: one model call per chip tap.
test('the offering picker waits for the owner to stop tapping before asking the model', () => {
  const src = read('../../../components/onboarding/GuidedOnboarding.jsx');
  assert.match(src, /const timer = setTimeout\(\(\) => \{\s*suggestionsKey\.current = currentKey;\s*loadSuggestions\(/,
    'the suggestions effect must debounce, and only mark the key loaded when it actually loads');
  assert.match(src, /return \(\) => clearTimeout\(timer\);/, 'a newer tap must cancel the pending load');
});

test('the offerings API reuses identical requests, except when the owner asks for new ones', () => {
  const src = read('../../../app/api/onboarding/offerings/route.js');
  assert.match(src, /const cached = body\.refresh \? null : cacheGet\(cacheKey\);/);
  assert.match(src, /if \(fromModel\) cacheSet\(cacheKey/, 'only real model output may be cached');
  const ui = read('../../../components/onboarding/GuidedOnboarding.jsx');
  assert.match(ui, /Show different choices/);
  assert.ok((ui.match(/refresh:true/g) || []).length >= 3, 'every retry button must bypass the cache');
});
