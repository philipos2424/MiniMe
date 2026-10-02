// Executes the actual runBrain implementation with isolated provider/database
// dependencies. No credentials, network requests, or runtime services are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { observeDelivery } from '../../deliveryOutcome.mjs';

const [tool, scenario] = process.argv.slice(2);
const unknownDelivery = scenario.startsWith('unknown');
let audit, modelCalls = 0, customerSends = 0;
const messageRows = [], conversationUpdates = [], ownerMessages = [];
const sb = { from(table) {
  let insertion, patch;
  const q = {
    select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, single() { return q; },
    insert(row) { insertion = row; return q; }, update(row) { patch = row; return q; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (table === 'agent_thoughts' && insertion) {
          audit = insertion;
          if (scenario === 'unknown-audit-error') throw new Error('audit database unreachable');
          return { data: { id: 'thought-1' } };
        }
        if (table === 'messages' && insertion) messageRows.push(insertion);
        if (table === 'conversations' && patch) conversationUpdates.push(patch);
        return { data: [], error: null };
      }).then(resolve, reject);
    },
  };
  return q;
} };
const unexpected = () => { throw new Error('Unexpected dependency call'); };
const call = (name, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify({ text: 'Hello Phili', summary: 'Finished' }) } });
const mocks = {
  './openaiClient': { makeOpenAI: () => ({ chat: { completions: { create: async () => {
    modelCalls++;
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: modelCalls === 1
      ? [call(tool, '1'), ...(scenario === 'partial' || unknownDelivery ? [call(tool, '2')] : [])]
      : [call('finish', '3')] } }] };
  } } } }) },
  './db': { supabase: () => sb },
  './telegramApi': { tg: async (_token, _method, body) => {
    if (body.chat_id === 999) { ownerMessages.push(body); return { ok: true }; }
    customerSends++;
    if (unknownDelivery) throw new Error('connection lost after request');
    if (scenario === 'rejected' || (scenario === 'partial' && customerSends > 1)) return { ok: false, description: 'Forbidden' };
    return { ok: true, result: { message_id: customerSends } };
  }, tgSendDocument: unexpected },
  './jobs': { createJob: unexpected, logEvent: unexpected, appendThread: unexpected },
  './jobFanout': { pickSupplier: unexpected, generateBrief: unexpected },
  './knowledge': { matchDocumentByIntent: unexpected, downloadDocument: unexpected, retrieveRelevantChunks: async () => [] },
  './webIngest': { ingestUrl: unexpected },
  './conversationMemory': { ensureRollingSummary: unexpected, fetchPastConversationDigests: unexpected },
  './threadState': { renderThreadState: () => '' },
  './availability': { withAvailability: async rows => rows, invalidateHoldCache: unexpected, formatStock: unexpected, holdsPromptBlock: () => '' },
  './constants': { MODEL: 'mock-model', MODEL_MINI: 'mock-mini', EFFORT_BRAIN: 'none' },
  './deliveryOutcome.mjs': { observeDelivery },
};
const context = vm.createContext({
  console, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout,
});
const module = new vm.SourceTextModule(readFileSync(new URL('../../agentBrain.js', import.meta.url), 'utf8'), { context });
await module.link(specifier => {
  assert.ok(mocks[specifier], `Unmocked import: ${specifier}`);
  const values = mocks[specifier];
  return new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const result = await module.namespace.runBrain({
  token: 'fixture-token', business: { id: 'business-1', name: 'Fixture shop', owner_private_chat_id: 999 },
  customer: { id: 'customer-1', name: 'Phili' }, conversation: { id: 'conversation-1' },
  chatId: 100, messageId: 1, inboundText: 'Hello',
});
const observed = audit.tool_calls.filter(t => t.name === tool);
if (scenario === 'sent') {
  assert.equal(result.replied, true);
  assert.equal(observed[0].result.ok, true);
  assert.equal(messageRows[0].status, 'sent');
} else if (scenario === 'partial') {
  assert.equal(result.replied, true, 'later failure must not erase the already-delivered reply');
  assert.equal(observed[1].result.ok, false);
  assert.equal(observed[1].result.outcome, 'rejected');
} else {
  assert.equal(result.replied, false);
  assert.equal(observed[0].result.ok, false);
  assert.equal(observed[0].result.outcome, unknownDelivery ? 'unknown' : scenario);
  assert.equal(messageRows[0].status, 'failed');
  assert.equal(conversationUpdates[0].requires_owner, true);
  if (unknownDelivery) {
    assert.equal(result.delivery_uncertain, true);
    assert.equal(customerSends, 1, 'do not execute subsequent send tools after an ambiguous outcome');
    assert.equal(modelCalls, 1, 'do not prompt a fallback reply after an ambiguous outcome');
    assert.equal(ownerMessages.length, 1);
  } else assert.equal(result.delivery_uncertain, false);
}
