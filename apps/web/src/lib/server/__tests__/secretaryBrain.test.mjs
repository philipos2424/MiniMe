import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  audienceOf, normalizeAudience, rulesForContact, ruleApplies, personaFor, PERSONAS,
  isPromise, openPromises, secretaryLayer,
} from '../../secretaryBrain.mjs';
import { ownerRulesForPrompt } from '../ownerRules.mjs';
import { secretaryModeOf, DEFAULT_SECRETARY_MODE } from '../contactRules.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const rules = [
  { rule: 'Always collect requirements before quoting', source: 'category_template' },
  { rule: "Don't share my home address" },
  { rule: 'Never talk about prices or work', audience: 'family' },
  { rule: 'Use lots of jokes', audience: 'friends' },
  { rule: 'Always confirm delivery address', audience: 'customers' },
  { rule: 'Reply to Sara in Amharic', person_name: 'Sara', person_tg: '555' },
  { source: 'faq', question: 'hours?', answer: '9-5' },
];

test('who someone is → which audience', () => {
  assert.equal(audienceOf('family'), 'family');
  assert.equal(audienceOf('mom'), 'family');
  assert.equal(audienceOf('girlfriend'), 'family');
  assert.equal(audienceOf('friend'), 'friends');
  assert.equal(audienceOf('customer'), 'customers');
  assert.equal(audienceOf(undefined), 'customers');
  assert.equal(normalizeAudience('clients'), 'customers');
  assert.equal(normalizeAudience(''), 'everyone');
});

test('rules are scoped: person first, then their group, then everyone; no shop templates for family', () => {
  const sara = rulesForContact(rules, { audience: 'family', personTgId: '555', personNames: ['Sara'] }).map(r => r.text);
  assert.deepEqual(sara, ['Reply to Sara in Amharic', 'Never talk about prices or work', "Don't share my home address"]);
  const cust = rulesForContact(rules, { audience: 'customers', personTgId: '1', personNames: ['Abebe'] }).map(r => r.text);
  assert.deepEqual(cust, ['Always confirm delivery address', "Don't share my home address", 'Always collect requirements before quoting']);
  assert.equal(ruleApplies(rules[5], { audience: 'customers', personTgId: null, personNames: ['sara k'] }), true);
  assert.equal(ruleApplies(rules[5], { audience: 'customers', personTgId: '9', personNames: ['Abel'] }), false);
});

test('the shop bot never sees family, friends or one-person rules', () => {
  const shop = ownerRulesForPrompt(rules);
  assert.ok(shop.includes('Always confirm delivery address'));
  assert.ok(!shop.some(r => /prices or work|jokes|Sara/.test(r)));
});

test('personality: per person beats per group beats "like me"', () => {
  const prefs = { secretary_personas: { customers: 'professional', friends: 'playful', people: { '555': 'warm' } } };
  assert.equal(personaFor(prefs, { audience: 'customers', personTgId: '1' }), 'professional');
  assert.equal(personaFor(prefs, { audience: 'friends', personTgId: '2' }), 'playful');
  assert.equal(personaFor(prefs, { audience: 'family', personTgId: '555' }), 'warm');
  assert.equal(personaFor({}, { audience: 'family' }), 'like_me');
  assert.equal(Object.keys(PERSONAS).length, 6);
});

test('promises are spotted in English and Amharic', () => {
  assert.ok(isPromise("let me check and get back to you"));
  assert.ok(isPromise("I'll confirm tomorrow"));
  assert.ok(isPromise('አጣርቼ እመለስልሃለሁ'));
  assert.ok(!isPromise('Yes, 1,500 birr. Want it?'));
});

test('open promises: AI said it would check and the owner has not answered since', () => {
  const now = Date.parse('2026-10-31T10:00:00Z');
  const h = [
    { direction: 'inbound', content: 'Is the blue one in stock?', created_at: '2026-10-31T08:00:00Z' },
    { direction: 'outbound', content: 'let me check and get back to you', is_ai_generated: true, created_at: '2026-10-31T08:01:00Z' },
    { direction: 'inbound', content: 'ok', created_at: '2026-10-31T08:02:00Z' },
  ];
  const loops = openPromises(h, { now });
  assert.equal(loops.length, 1);
  assert.equal(loops[0].asked, 'Is the blue one in stock?');
  assert.equal(openPromises([...h, { direction: 'outbound', content: 'yes we have it', is_ai_generated: false }], { now }).length, 0);
  assert.equal(openPromises(h, { now: now + 9 * 86400000 }).length, 0);
});

test('layer: rules on top, personality + open promises + rule check at the end', () => {
  const l = secretaryLayer({
    ownerInstructions: rules, prefs: { secretary_personas: { family: 'warm' } },
    relationship: 'family', personTgId: '555', personNames: ['Sara'], ownerName: 'Phili',
    history: [{ direction: 'inbound', content: 'can you send it?' }, { direction: 'outbound', content: "I'll check", is_ai_generated: true }],
  });
  assert.match(l.top, /PHILI'S RULES — FOLLOW THESE BEFORE ANYTHING ELSE/);
  assert.match(l.top, /Reply to Sara in Amharic \(only Sara\)/);
  assert.match(l.bottom, /Warm & caring/);
  assert.match(l.bottom, /STILL OPEN WITH THIS PERSON/);
  assert.match(l.bottom, /Before you send: check the reply/);
  assert.equal(secretaryLayer({ ownerInstructions: [], prefs: {}, relationship: 'customer' }).top, '');
});

test('Smart is the default Secretary mode', () => {
  assert.equal(DEFAULT_SECRETARY_MODE, 'smart');
  assert.equal(secretaryModeOf({}), 'smart');
  assert.equal(secretaryModeOf({ secretary_mode: 'ask_first' }), 'ask_first');
});

test('wired into both Secretary prompts, the owner tools and the waiting alert', () => {
  const e = readFileSync(`${here}../replyEngine.js`, 'utf8');
  assert.equal((e.match(/secretaryLayer\(\{/g) || []).length, 2);
  assert.equal((e.match(/\$\{secLayer\.top\}/g) || []).length, 3);
  assert.equal((e.match(/\$\{secLayer\.bottom\}/g) || []).length, 3);
  assert.match(e, /\/\(personality\|persona\|style\)/);
  assert.match(e, /data\.startsWith\('sp_'\)/);
  const oc = readFileSync(`${here}../ownerCommands.js`, 'utf8');
  assert.match(oc, /name: 'set_personality'/);
  assert.match(oc, /audience: \{ type: 'string', enum: \['everyone', 'customers', 'family', 'friends'\]/);
  assert.match(readFileSync(`${here}../notification.js`, 'utf8'), /is waiting for your answer/);
  assert.match(readFileSync(`${here}../../../app/api/agent-bot/webhook/route.js`, 'utf8'), /secretaryModeOf\(nPrefs\)/);
});
