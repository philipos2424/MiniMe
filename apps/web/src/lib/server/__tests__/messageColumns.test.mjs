/**
 * Every saveMessage({...}) row in replyEngine.js must only use real columns of
 * public.messages. PostgREST rejects an insert that names an unknown column
 * (PGRST204), supabase-js returns that as { error } rather than throwing, and
 * saveMessage returned the null data — so the row silently vanished.
 *
 * That is how drafts were lost: the draft insert sent `confidence` (the column
 * is `ai_confidence`), saved came back null, notifyOwnerDraft is gated on
 * saved?.id, and the customer got no reply while the owner was never asked.
 * Production had 64 conversations marked last_ai_action='drafted' and one
 * drafted message row ever (2026-04-19, from pre-repo code).
 *
 * Source-text test for the same reason as replyEngine.test.mjs: the module
 * can't be imported outside the Next bundler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = readFileSync(`${root}apps/web/src/lib/server/replyEngine.js`, 'utf8');

// Live columns of public.messages (information_schema, 2026-10-17).
const MESSAGE_COLUMNS = new Set([
  'id', 'conversation_id', 'business_id', 'topic', 'customer_id', 'extension',
  'payload', 'direction', 'content', 'event', 'content_type', 'private',
  'updated_at', 'media_url', 'is_ai_generated', 'inserted_at', 'ai_draft',
  'binary_payload', 'owner_edited', 'skip_broadcast', 'edit_distance',
  'ai_confidence', 'ai_model', 'detected_intent', 'detected_sentiment',
  'detected_language', 'detected_topics', 'status', 'approved_at', 'sent_at',
  'telegram_message_id', 'telegram_chat_id', 'notification_message_id',
  'created_at', 'telegram_file_id', 'telegram_file_type', 'telegram_file_name',
  'platform', 'external_id', 'channel',
]);
// messages_content_type_check
const CONTENT_TYPES = new Set(['text', 'image', 'document', 'voice', 'sticker', 'location']);

// Files that write public.messages directly (plus replyEngine's saveMessage).
const INSERT_FILES = ['replyEngine.js', 'agentBrain.js', 'metaReplyEngine.js'];

/** Top-level keys of each object literal opened at `marker`, with its line. */
function rowsAfter(text, marker, file) {
  const rows = [];
  let i = 0;
  while ((i = text.indexOf(marker, i)) !== -1) {
    const open = text.indexOf('{', i + marker.length - 1);
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    const body = text.slice(open + 1, j).replace(/\/\/.*$/gm, '');
    const parts = [];
    let level = 0;
    let tok = '';
    for (const ch of body) {
      if ('{[('.includes(ch)) level++;
      else if ('}])'.includes(ch)) level--;
      if (level === 0 && ch === ',') { parts.push(tok); tok = ''; } else tok += ch;
    }
    parts.push(tok);
    rows.push({ line: `${file}:${text.slice(0, i).split('\n').length}`, parts: parts.map(p => p.trim()).filter(Boolean) });
    i = j;
  }
  return rows;
}

function saveMessageRows() {
  const rows = [];
  for (const file of INSERT_FILES) {
    const text = readFileSync(`${root}apps/web/src/lib/server/${file}`, 'utf8');
    rows.push(...rowsAfter(text, 'saveMessage({', file));
    rows.push(...rowsAfter(text, ".from('messages').insert({", file));
  }
  return rows;
}

test('replyEngine has saveMessage rows to check', () => {
  assert.ok(saveMessageRows().length > 20);
});

test('every saveMessage row names only real messages columns', () => {
  const bad = [];
  for (const { line, parts } of saveMessageRows()) {
    for (const p of parts) {
      if (p.startsWith('...')) continue;
      const key = p.match(/^([A-Za-z_]\w*)/)?.[1];
      if (key && !MESSAGE_COLUMNS.has(key)) bad.push(`line ${line}: ${key}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every literal content_type passes messages_content_type_check', () => {
  const bad = [];
  for (const { line, parts } of saveMessageRows()) {
    for (const p of parts.filter(x => x.startsWith('content_type'))) {
      for (const lit of p.matchAll(/'([^']+)'/g)) {
        if (!CONTENT_TYPES.has(lit[1])) bad.push(`line ${line}: ${lit[1]}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('saveMessage surfaces insert errors instead of returning null silently', () => {
  const fn = src.slice(src.indexOf('async function saveMessage('), src.indexOf('async function touchConversation('));
  assert.match(fn, /\berror\b/);
  assert.match(fn, /console\.(warn|error)\([^)]*error/);
});

test('owner draft notifications stay gated on a saved row', () => {
  const at = src.indexOf("status: delivered ? 'sent' : 'failed'");
  const block = src.slice(at, at + 3500);
  const calls = block.match(/notifyOwnerDraft\(/g) || [];
  const guarded = block.match(/if \(saved\?\.id\) \{?\s*\n?\s*await notifyOwnerDraft\(/g) || [];
  assert.equal(calls.length, 2);
  assert.equal(guarded.length, calls.length);
});
