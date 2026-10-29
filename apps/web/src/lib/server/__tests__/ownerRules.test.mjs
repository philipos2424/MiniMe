import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ownerRulesForPrompt, faqPairsForPrompt } from '../ownerRules.mjs';

// iconnect's real owner_instructions order (first 20 entries, 28 Oct 2026).
const ICONNECT = [
  { source: 'category_template', rule: 'Always collect project requirements before giving a quote — never price blind' },
  { source: 'category_template', rule: "Always ask about the customer's deadline before committing to a timeline" },
  { source: 'category_template', rule: 'Offer a free consultation call for complex or high-value projects' },
  { rule: 'when people want to order a card let them sign up on this link https://iconnect.plus' },
  { rule: 'be honest.' },
  { rule: 'make the conversations very simple and dont overdo it. make it short.' },
  { rule: 'while talking to a friend match thier vibes. but make it very simple and easy convos.' },
  { rule: 'Use emojis often' },
  { rule: 'dont over do texts, keep it simple.' },
  { rule: 'Make it small' },
  { source: 'faq', question: 'I needed a card how can I get it', answer: 'Sign up at https://iconnect.plus' },
  { source: 'faq', question: 'Hey im doing good', answer: 'Great!' },
  { rule: 'talk in English.' },
  { rule: 'don’t confuse iConnect with MiniMe.' },
  { source: 'faq', question: 'Tru adrgek setup', answer: 'ok' },
  { source: 'faq', question: 'phili endete nehe', answer: 'fine' },
  { rule: 'i dont sell perfumes. remove it' },
  { source: 'faq', question: 'How do I contact you', answer: '@philipos' },
  { rule: 'make the conversations short and clear' },
  { source: 'faq', question: 'What is minime?', answer: '@minimeagentbot' },
];

test('the fast-path cutoff that dropped "don\'t confuse iConnect with MiniMe" is gone', () => {
  // The old fast path: first 5 non-FAQ entries.
  const old = ICONNECT.filter(r => r.source !== 'faq').slice(0, 5).map(r => r.rule);
  assert.ok(!old.includes('don’t confuse iConnect with MiniMe.'), 'reproduces the original bug');
  // The new one, at the fast path's budget.
  const rules = ownerRulesForPrompt(ICONNECT, { maxChars: 900 });
  assert.ok(rules.includes('don’t confuse iConnect with MiniMe.'));
  assert.ok(rules.includes('i dont sell perfumes. remove it'));
});

test("owner rules come before category templates, newest first", () => {
  const rules = ownerRulesForPrompt(ICONNECT);
  assert.equal(rules[0], 'make the conversations short and clear');
  const lastOwn = rules.indexOf('when people want to order a card let them sign up on this link https://iconnect.plus');
  const firstTemplate = rules.findIndex(r => r.startsWith('Always collect'));
  assert.ok(firstTemplate === -1 || firstTemplate > lastOwn);
});

test('FAQ entries are never listed as rules (no "undefined" lines)', () => {
  const rules = ownerRulesForPrompt(ICONNECT);
  assert.ok(rules.every(r => typeof r === 'string' && r && r !== 'undefined'));
  assert.ok(!rules.some(r => r.includes('@minimeagentbot')));
});

test('the newest FAQ answers are kept, including the owner\'s latest correction', () => {
  const faq = faqPairsForPrompt(ICONNECT, { max: 3 });
  assert.equal(faq.length, 3);
  assert.ok(faq.at(-1).includes('What is minime?'));
});

test('rules are deduped and capped by length', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ rule: `rule number ${i} ${'x'.repeat(30)}` }));
  const out = ownerRulesForPrompt([...many, { rule: 'Make it small' }, { rule: 'make it small!' }], { maxChars: 500 });
  assert.ok(out.join(' - ').length <= 520);
  assert.equal(out.filter(r => /make it small/i.test(r)).length, 1);
});

test('no reply prompt slices owner_instructions by count any more', () => {
  for (const f of ['../replyEngine.js', '../agentBrain.js']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    assert.ok(!/owner_instructions[^;]*\.slice\(0,\s*5\)/s.test(src.replace(/\n\s*\/\/.*$/gm, '')), `${f} still takes the first 5 rules`);
    assert.ok(!src.includes('ownerRules.map(r => `- ${r.rule}`)'), `${f} still maps raw entries (prints "- undefined" for FAQs)`);
  }
});
