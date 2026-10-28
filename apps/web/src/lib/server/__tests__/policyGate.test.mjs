import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPolicyTopic, isTopicCovered, ownerAuthoredTexts } from '../policyGate.mjs';
import { rankChunks, cleanChunkContent, chunkPromptLine, isOwnerAuthoredSource } from '../knowledgeTrust.mjs';

// Questions the live bot answered by inventing a policy (26–28 Oct 2026).
test('live invented-policy questions are detected', () => {
  assert.equal(detectPolicyTopic("what's the warranty on the metal card, and can I return it if the NFC chip stops working after 2 months?"), 'warranty');
  assert.equal(detectPolicyTopic("what's your refund policy if the card arrives damaged?"), 'returns');
  assert.equal(detectPolicyTopic('ሰላም፣ ካርዱን እንዴት ማዘዝ እችላለሁ? ቦሌ ታደርሳላችሁ?'), 'delivery');
});

test('other policy topics', () => {
  assert.equal(detectPolicyTopic('how many days until it is ready?'), 'timeline');
  assert.equal(detectPolicyTopic('any discount if I order 50?'), 'discount');
  assert.equal(detectPolicyTopic('can I pay in installments?'), 'installments');
  assert.equal(detectPolicyTopic('ዋስትና አለው?'), 'warranty');
});

test('ordinary chat and orders in progress are not gated', () => {
  assert.equal(detectPolicyTopic('How u doin'), null);
  assert.equal(detectPolicyTopic('What is minime agent??'), null);
  assert.equal(detectPolicyTopic('do you have NFC business cards? how much is one?'), null);
  assert.equal(detectPolicyTopic('I want 2 metal cards, deliver to Bole, my phone is 0911000000. how do I pay?'), null);
  assert.equal(detectPolicyTopic('ok thanks, delivered fine'), null);
});

test('a topic the owner never mentioned is uncovered', () => {
  const iconnect = {
    description: 'we sell nfc products and minime that is your agent in your telegram',
    business_hours: '24/7',
    owner_instructions: [{ rule: "don't confuse iConnect with MiniMe." }, { source: 'faq', question: 'What is minime?', answer: '@minimeagentbot' }],
  };
  const texts = ownerAuthoredTexts(iconnect, { products: [{ description: 'Metal NFC card' }] });
  assert.equal(isTopicCovered('warranty', texts), false);
  assert.equal(isTopicCovered('returns', texts), false);
  assert.equal(isTopicCovered('delivery', texts), false);
});

test('once the owner answers, the saved FAQ covers the topic', () => {
  const biz = { owner_instructions: [{ source: 'faq', question: "what's your refund policy if the card arrives damaged?", answer: 'We replace damaged cards free within 7 days.' }] };
  assert.equal(isTopicCovered('returns', ownerAuthoredTexts(biz)), true);
});

test('owner-taught knowledge chunks count as coverage', () => {
  const texts = ownerAuthoredTexts({}, { chunks: [{ content: 'Delivery in Addis is 150 ETB, 1–2 days.' }] });
  assert.equal(isTopicCovered('delivery', texts), true);
  assert.equal(isTopicCovered('timeline', texts), true);
});

test('owner-taught knowledge ranks above auto-learned, regardless of similarity', () => {
  const chunks = [
    { document_id: 'a', content: 'Q: How can I check out your agents?\nA: You can visit https://jami.bio/\n(why: Provides official link for exploring agents and miniapps)', similarity: 0.9 },
    { document_id: 'b', content: 'MiniMe is a separate product from iConnect.', similarity: 0.5 },
  ];
  const ranked = rankChunks(chunks, { a: 'auto-learn', b: 'teaching' }, 2);
  assert.equal(ranked[0].document_id, 'b');
  assert.equal(ranked[0].ownerAuthored, true);
  assert.equal(ranked[1].ownerAuthored, false);
  assert.ok(!ranked[1].content.includes('why:'), 'the "(why: … official …)" rationale is stripped');
  assert.match(chunkPromptLine(ranked[1], 1), /not confirmed by the owner/);
});

test('uploads (no source) are owner-authored; unknown provenance is not', () => {
  assert.equal(isOwnerAuthoredSource(null), true);
  assert.equal(isOwnerAuthoredSource('owner-correction'), true);
  assert.equal(isOwnerAuthoredSource('auto-learn'), false);
  assert.equal(isOwnerAuthoredSource('unknown'), false);
  assert.equal(cleanChunkContent('A: yes\n(why: useful)'), 'A: yes');
});
