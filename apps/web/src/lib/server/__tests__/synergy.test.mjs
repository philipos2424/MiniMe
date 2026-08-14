import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synergyCategoriesFor, isSynergyQuery, SYNERGY_MAP } from '../synergy.mjs';
import { CANONICAL_CATEGORIES } from '../categoryMap.mjs';

test('a mapped category returns its synergy targets plus the floor, excluding itself', () => {
  const targets = synergyCategoriesFor('it_tech');
  assert.ok(targets.includes('wholesale_supply'));
  assert.ok(targets.includes('training_consulting')); // floor
  assert.ok(!targets.includes('it_tech')); // never recommend selling to yourself
});

test('an unmapped or unknown category still returns the floor, never an empty result', () => {
  assert.deepEqual(new Set(synergyCategoriesFor('completely made up category')),
    new Set(['training_consulting', 'wholesale_supply', 'it_tech']));
});

test('every SYNERGY_MAP entry only references real canonical categories', () => {
  const canonical = new Set(CANONICAL_CATEGORIES);
  for (const [source, targets] of Object.entries(SYNERGY_MAP)) {
    assert.ok(canonical.has(source), `SYNERGY_MAP key "${source}" is not a canonical category`);
    for (const t of targets) {
      assert.ok(canonical.has(t), `SYNERGY_MAP["${source}"] includes non-canonical "${t}"`);
    }
  }
});

test('isSynergyQuery recognizes real "who would benefit" campaign queries', () => {
  const realQueries = [
    'potential B2B partners in Addis Ababa that would benefit from iConnect Telegram small business platform and MiniMe AI automation services',
    'potential B2B partners in Addis Ababa who would benefit from AI automation services',
    'Addis Ababa businesses that could benefit from iConnect Telegram small business platform and MiniMe AI automation services',
  ];
  for (const q of realQueries) assert.equal(isSynergyQuery(q), true, q);
});

test('isSynergyQuery does not fire on ordinary forward-search queries', () => {
  for (const q of ['laptop suppliers for business laptops under 50k ETB', 'coffee beans supplier', 'branding agency under 50k ETB']) {
    assert.equal(isSynergyQuery(q), false, q);
  }
});
