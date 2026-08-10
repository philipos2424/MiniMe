import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTagsResponse } from '../parseImageTags.mjs';

test('parseTagsResponse extracts, lowercases, and caps tags from a well-formed response', () => {
  const raw = JSON.stringify({ tags: ['Red', ' Dress ', 'Cotton', 'Casual'] });
  assert.equal(parseTagsResponse(raw), 'red, dress, cotton, casual');
});

test('parseTagsResponse caps at 8 tags', () => {
  const raw = JSON.stringify({ tags: Array.from({ length: 12 }, (_, i) => `tag${i}`) });
  assert.equal(parseTagsResponse(raw).split(', ').length, 8);
});

test('parseTagsResponse drops empty/blank entries', () => {
  const raw = JSON.stringify({ tags: ['red', '', '  ', 'dress'] });
  assert.equal(parseTagsResponse(raw), 'red, dress');
});

test('parseTagsResponse returns null for an empty tags array (photo has no sellable product)', () => {
  assert.equal(parseTagsResponse(JSON.stringify({ tags: [] })), null);
});

test('parseTagsResponse returns null for malformed JSON, missing tags, or empty input', () => {
  assert.equal(parseTagsResponse('not json'), null);
  assert.equal(parseTagsResponse(JSON.stringify({ notTags: ['red'] })), null);
  assert.equal(parseTagsResponse(JSON.stringify({ tags: 'red, dress' })), null); // not an array
  assert.equal(parseTagsResponse(null), null);
  assert.equal(parseTagsResponse(''), null);
});
