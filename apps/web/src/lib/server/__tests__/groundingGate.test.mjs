import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  policyTopics, policyGapDecision, knowledgeTextFor, ownerRulesForPrompt, faqPairsForPrompt,
} from '../groundingGate.mjs';

// Real questions from the 26–28 Oct bot tests.
test('the warranty and refund questions MiniMe invented answers for are policy questions', () => {
  assert.deepEqual(
    policyTopics("what's the warranty on the metal card, and can I return it if the NFC chip stops working after 2 months?").sort(),
    ['refund_return', 'warranty'],
  );
  assert.deepEqual(policyTopics("what's your refund policy if the card arrives damaged?"), ['refund_return']);
});

test('Amharic policy questions are detected', () => {
  assert.ok(policyTopics('ዋስትና አለው?').includes('warranty'));
  assert.ok(policyTopics('ቦሌ ታደርሳላችሁ?').includes('delivery'));
  assert.ok(policyTopics('ስንት ቀን ይወስዳል?').includes('turnaround'));
});

test('everyday uses of "return" and "when can I" are not policy questions', () => {
  assert.deepEqual(policyTopics('I will return tomorrow with the money'), []);
  assert.deepEqual(policyTopics('when can I come to your shop?'), []);
  assert.deepEqual(policyTopics('can you exchange numbers with my friend?'), []);
  assert.ok(policyTopics('when will my order be ready?').includes('turnaround'));
  assert.ok(policyTopics('when can I get my cards?').includes('turnaround'));
  assert.ok(policyTopics('can I exchange it for a different color?').includes('refund_return'));
});

test('orders and small talk are not policy questions', () => {
  assert.deepEqual(policyTopics('I want 2 metal cards, deliver to Bole, my phone is 0911000000. how do I pay?'), []);
  assert.deepEqual(policyTopics('Heyyy'), []);
  assert.deepEqual(policyTopics('How u doin'), []);
  assert.deepEqual(policyTopics('What is minime agent??'), []);
  assert.deepEqual(policyTopics('do you have NFC business cards? how much is one?'), []);
});

test('an uncovered policy question asks the owner', () => {
  const biz = { description: 'we sell nfc products', owner_instructions: [{ rule: 'be honest.' }] };
  const d = policyGapDecision("what's your refund policy if the card arrives damaged?", knowledgeTextFor(biz));
  assert.equal(d.ask, true);
  assert.deepEqual(d.uncovered, ['refund_return']);
});

test('a covered policy question is answered normally', () => {
  const biz = { owner_instructions: [{ source: 'faq', question: 'Can I return a card?', answer: 'Yes, within 7 days if unused.' }] };
  assert.equal(policyGapDecision('can I return it if it breaks?', knowledgeTextFor(biz)).ask, false);
  const chunks = [{ content: 'Delivery: free in Bole, 100 ETB elsewhere in Addis.' }];
  assert.equal(policyGapDecision('do you deliver to CMC?', knowledgeTextFor({}, { chunks })).ask, false);
});

test('owner facts, products and description count as knowledge', () => {
  const t = knowledgeTextFor({
    description: 'Cards ready in 2 days',
    notification_prefs: { owner_facts: ['We offer a 1 year warranty on metal cards'] },
  }, { products: [{ name: 'Metal card', description: 'Lifetime replacement if the chip fails' }] });
  assert.equal(policyGapDecision('is there a warranty?', t).ask, false);
  assert.equal(policyGapDecision('how long until it is ready?', t).ask, false);
  assert.equal(policyGapDecision('can I get a replacement?', t).ask, false);
});

// iconnect's real owner_instructions order (first 15 entries, 28 Oct).
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
  { source: 'faq', question: 'What is minime?', answer: '@minimeagentbot' },
];

test("the owner's own rules are never cut off by templates", () => {
  const rules = ownerRulesForPrompt(ICONNECT);
  assert.ok(rules.includes('don’t confuse iConnect with MiniMe.'));
  assert.equal(rules[0], 'don’t confuse iConnect with MiniMe.', 'newest owner rule first');
  const firstTemplate = rules.findIndex(r => r.startsWith('Always collect'));
  assert.ok(firstTemplate > rules.indexOf('be honest.'), 'templates after owner rules');
});

test('FAQ entries are never listed as rules (no "undefined" lines)', () => {
  const rules = ownerRulesForPrompt(ICONNECT);
  assert.ok(rules.every(r => typeof r === 'string' && r !== 'undefined'));
  assert.ok(!rules.some(r => r.includes('@minimeagentbot')));
  assert.equal(faqPairsForPrompt(ICONNECT).length, 3);
});

test('rules are deduped and capped by length', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ rule: `rule number ${i} ${'x'.repeat(30)}` }));
  const out = ownerRulesForPrompt([...many, { rule: 'Make it small' }, { rule: 'make it small!' }], { maxChars: 500 });
  assert.ok(out.join(' - ').length <= 520);
  assert.equal(out.filter(r => /make it small/i.test(r)).length, 1);
});
