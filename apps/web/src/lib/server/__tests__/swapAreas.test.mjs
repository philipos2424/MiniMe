/**
 * Areas are buttons, but the button list is Addis-centric and always will be
 * on day one. What must not happen is a lister in Hawassa hitting a wall at
 * step four — hence normalizeArea's free-text branch, which is the reason
 * this module exists instead of a hardcoded array in the wizard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, areaLabel, normalizeArea, areaKeyboard } from '../swap/swapAreas.mjs';

test('known areas normalize to their id regardless of case or script', () => {
  assert.deepEqual(normalizeArea('Bole'),  { area: 'bole', isFreetext: false });
  assert.deepEqual(normalizeArea('  bole '), { area: 'bole', isFreetext: false });
  assert.deepEqual(normalizeArea('ቦሌ'),   { area: 'bole', isFreetext: false });
});

test('an unknown place is kept as free text rather than rejected', () => {
  const r = normalizeArea('Hawassa Piazza');
  assert.equal(r.isFreetext, true);
  assert.equal(r.area, 'Hawassa Piazza');
});

test('free text is trimmed and length-capped so it cannot bloat a card', () => {
  const r = normalizeArea('  ' + 'x'.repeat(200) + '  ');
  assert.equal(r.area.length, 60);
});

test('areaLabel renders Amharic when asked and falls back to free text', () => {
  assert.equal(areaLabel('bole', 'en'), 'Bole');
  assert.equal(areaLabel('bole', 'am'), 'ቦሌ');
  assert.equal(areaLabel('Hawassa Piazza', 'en'), 'Hawassa Piazza');
});

test('the keyboard offers every area plus an escape hatch', () => {
  const kb = areaKeyboard('en');
  const flat = kb.flat();
  assert.equal(flat.length, AREAS.length + 1);
  assert.ok(flat.every(b => b.callback_data.startsWith('sw:area:')));
  assert.equal(flat.at(-1).callback_data, 'sw:area:other');
  assert.ok(kb.every(row => row.length <= 2));
});
