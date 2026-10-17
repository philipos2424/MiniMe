/**
 * Gemini answers ~98% of calls and rejects any request whose messages have no
 * user turn ("contents is not specified", ~100ms). OpenAI and Groq accept a
 * system-only prompt, so these calls silently ran on the fallback, or failed
 * outright on the background lane, where fallbacks are off: the followups
 * cron's brain went 0 for 120 on 2026-10-17. Every message array that starts
 * with a system prompt must also carry a user turn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (f === 'node_modules' || f === '__tests__') return [];
  return statSync(p).isDirectory() ? walk(p) : /\.m?js$/.test(f) ? [p] : [];
});

// A literal array that names a system role but never a user role and has no
// spread or later push of a user turn.
function systemOnlyArrays(file) {
  const s = readFileSync(file, 'utf8');
  const hits = [];
  for (const pat of ['messages: [', 'messages = [']) {
    let i = 0;
    while ((i = s.indexOf(pat, i)) !== -1) {
      let depth = 0, j = s.indexOf('[', i);
      for (; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']' && --depth === 0) break;
      }
      const body = s.slice(i, j + 1);
      const after = s.slice(j, j + 1500);
      if (/role:\s*'system'/.test(body) && !/role:\s*['"]user['"]/.test(body) && !/\.\.\./.test(body)
        && !/messages\.push\(\{\s*role:\s*'user'/.test(after)) {
        hits.push(`${file.replace(SRC, '')}:${s.slice(0, i).split('\n').length}`);
      }
      i = j;
    }
  }
  return hits;
}

test('no LLM call sends a system prompt without a user turn', () => {
  const hits = walk(SRC).flatMap(systemOnlyArrays);
  assert.deepEqual(hits, []);
});

test('the agent brain sends the customer message as a user turn', () => {
  const brain = readFileSync(join(SRC, 'lib/server/agentBrain.js'), 'utf8');
  assert.match(brain, /\{ role: 'user', content: `Customer: """\$\{inboundText\}"""/);
});
