import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMessage, escapeMd } from '../reengage/copy.mjs';
import { STAGES } from '../reengage/stages.mjs';

const facts = {
  first: 'Abebe', shop: 'Selam Shop', waiting: 12, unanswered: 40,
  products: 14, factCount: 6, question: 'Do you deliver?', draft: 'Yes, we deliver across Addis.',
};

test('every stage renders in both variants with text and at least one button', () => {
  for (const stage of STAGES) {
    for (const variant of ['demand', 'payoff']) {
      const m = renderMessage({ stage, variant, isFinal: false, facts });
      assert.ok(m.text.length > 40, `${stage}/${variant} text too short`);
      assert.ok(m.buttons.flat().length >= 1, `${stage}/${variant} has no button`);
    }
  }
});

test('every message is bilingual — Amharic script is always present', () => {
  for (const stage of STAGES) {
    const m = renderMessage({ stage, variant: 'demand', isFinal: false, facts });
    assert.match(m.text, /[ሀ-፿]/, `${stage} has no Amharic`);
  }
});

test('we never quote a zero — the demand line is dropped, not rendered as 0', () => {
  const m = renderMessage({ stage: 'A1', variant: 'demand', isFinal: false, facts: { first: 'Abebe', waiting: 0, unanswered: 0 } });
  assert.ok(!/\b0 people\b/.test(m.text), 'rendered "0 people"');
  assert.ok(!/\b0 searches\b/.test(m.text), 'rendered "0 searches"');
  assert.ok(m.text.length > 40, 'dropping the number must not leave an empty message');
});

test('a real waiting count is quoted', () => {
  const m = renderMessage({ stage: 'A1', variant: 'demand', isFinal: false, facts });
  assert.match(m.text, /12/);
});

test('the final send is the exit question with four reason chips', () => {
  const m = renderMessage({ stage: 'B4', variant: 'payoff', isFinal: true, facts });
  const actions = m.buttons.flat().map(b => b.action);
  assert.equal(actions.length, 4);
  for (const a of actions) assert.match(a, /^exit:/);
});

test('B5 offers the shared-mode escape hatch, which is its whole point', () => {
  const m = renderMessage({ stage: 'B5', variant: 'payoff', isFinal: false, facts });
  const actions = m.buttons.flat().map(b => b.action);
  assert.ok(actions.includes('go_shared'));
  assert.ok(actions.includes('help_token'));
});

test('B2 shows the generated reply it promises', () => {
  const m = renderMessage({ stage: 'B2', variant: 'payoff', isFinal: false, facts });
  assert.ok(m.text.includes('Do you deliver?'));
  assert.ok(m.text.includes('Yes, we deliver across Addis.'));
});

test('no message claims we fixed a bug', () => {
  for (const stage of STAGES) {
    for (const variant of ['demand', 'payoff']) {
      const m = renderMessage({ stage, variant, isFinal: false, facts });
      assert.ok(!/\bbug\b/i.test(m.text), `${stage}/${variant} claims a bug fix`);
    }
  }
});

test('Markdown emphasis is balanced so Telegram does not reject the send', () => {
  for (const stage of STAGES) {
    const m = renderMessage({ stage, variant: 'demand', isFinal: false, facts });
    assert.equal((m.text.match(/\*/g) || []).length % 2, 0, `${stage} has unbalanced *`);
    assert.equal((m.text.match(/_/g) || []).length % 2, 0, `${stage} has unbalanced _`);
  }
});

test('names with Markdown characters are escaped, not left to corrupt the message', () => {
  assert.equal(escapeMd('Selam_Shop *Addis*'), 'Selam\\_Shop \\*Addis\\*');
  const m = renderMessage({ stage: 'B4', variant: 'payoff', isFinal: false, facts: { ...facts, shop: 'A_B' } });
  assert.ok(m.text.includes('A\\_B'));
});

test('a missing first name degrades to a greeting, never to "undefined"', () => {
  const m = renderMessage({ stage: 'A1', variant: 'payoff', isFinal: false, facts: { waiting: 3 } });
  assert.ok(!/undefined|null/.test(m.text));
});
