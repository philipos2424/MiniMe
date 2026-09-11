/**
 * Per-message conversation context blocks — language, and what has already been
 * said. Both are pure functions of the message plus the history in front of
 * them, and both are appended to whichever prompt is about to run.
 *
 * They live in their own .mjs module for the same reason amharicScript.mjs does:
 * replyEngine.js uses extensionless imports that only the Next bundler resolves,
 * so nothing inside it can be imported by a node:test file. Everything here is
 * dependency-free apart from script detection, so it can be tested directly —
 * see __tests__/conversationContext.test.mjs.
 */
import { detectScript, hasEthiopic } from './amharicScript.mjs';

/**
 * Per-message language rules, for whichever prompt is about to run.
 *
 * This has to be built per message rather than baked into the system prompt:
 * a customer switches script mid-conversation ("selam" → "how much?" → "እሺ")
 * and the reply must follow the message in front of it. It also has to be
 * appended LAST (see volatileBlock) so it lands nearest the question and
 * doesn't invalidate the cached prompt prefix.
 *
 * English used to return '' here, on the reasoning that English traffic should
 * pay nothing for a language rule. That silence is what produced Amharic
 * answers to English questions: the surrounding prompt carries a CHAT AMHARIC
 * section, the owner's style samples are usually Amharic, and with nothing
 * saying otherwise the model follows them. Two lines is the right price.
 *
 * `lastScript` is the conversation's remembered script, for messages that have
 * none of their own — "218897", "ok", a lone emoji. Without it a bare code
 * mid-thread resets an Amharic conversation to English.
 */
export function buildLanguageBlock(text, { lastScript = null } = {}) {
  let script = detectScript(text);
  // Script-neutral: no Ethiopic, no Amharic tokens, and nothing much to go on
  // (a number, an emoji, "ok"). detectScript calls that 'en' — correct as a
  // default, wrong as a switch mid-conversation.
  if (script === 'en' && lastScript && lastScript !== 'en' && !hasLanguageSignal(text)) {
    script = lastScript;
  }

  const head = '\n\n## LANGUAGE — THIS MESSAGE\n';
  if (script === 'ethiopic') {
    return head + '- They wrote in ፊደል. Reply in Amharic, in ፊደል. Keep prices and product names as they appear in your catalog.\n';
  }
  if (script === 'latin-am') {
    return head +
      '- They wrote Amharic in LATIN letters ("nege emetalehu", "eshi tiru"). Reply in Amharic using LATIN letters too.\n' +
      '- Do NOT answer in ፊደል and do NOT answer in English. Mirror exactly the script they chose — switching it reads as not understanding them.\n';
  }
  if (script === 'mixed') {
    return head +
      '- They mixed Amharic and English. Mirror that mix, in the same scripts they used — do not normalize the whole reply into one language.\n';
  }
  return head +
    '- They wrote in ENGLISH. Reply in English only.\n' +
    '- Do NOT switch to Amharic or ፊደል, whatever language the examples, rules, or earlier messages above are written in. Answering an English question in Amharic reads as not having understood it.\n';
}

/**
 * Does this message carry any signal about what language the person is using?
 * A bare code, price, emoji or "ok" does not — those inherit the conversation's
 * language instead of resetting it to the English default.
 */
export function hasLanguageSignal(text) {
  const t = String(text || '').trim();
  if (hasEthiopic(t)) return true;
  // Strip digits, punctuation and emoji, then ask whether real words remain.
  const words = t.replace(/[\d\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(w => w.length > 2);
  return words.length >= 2;
}

/**
 * Everything the assistant has already done in this conversation and must not
 * do again. Deterministic — no model call — and computed from the same history
 * the prompt is about to show, so it cannot contradict it.
 *
 * The prompts have said "do not re-greet, do not re-ask" in prose for a long
 * time. In practice a small model reading 40 turns still opens every reply with
 * "ሰላም! 👋" and re-asks the question it asked two messages ago. Naming the
 * specific greeting, opener and question it is about to repeat is what actually
 * stops it.
 */
export function buildContinuityBlock(recentMessages) {
  const msgs = (recentMessages || []).filter(m => m && m.content);
  const outbound = msgs.filter(m => m.direction === 'outbound');
  if (!outbound.length) return '';

  const lines = [];
  lines.push('- You have ALREADY greeted this person in this conversation. Do not greet again — no "ሰላም", no "selam", no "hey", no "👋". Continue where you left off.');

  const opener = s => String(s).trim().replace(/\s+/g, ' ').split(' ').slice(0, 6).join(' ');
  const recentOpeners = [...new Set(outbound.slice(-3).map(m => opener(m.content)).filter(Boolean))];
  if (recentOpeners.length) {
    lines.push(`- Your recent replies opened with: ${recentOpeners.map(o => `"${o}…"`).join(', ')}. Open differently this time.`);
  }

  // Anything you asked. Amharic uses ፧ and often just ends the sentence, so a
  // trailing '?' is not the only marker worth catching.
  const asked = outbound
    .slice(-6)
    .map(m => String(m.content).trim())
    .filter(c => /[?？፧]/.test(c))
    .map(c => {
      const q = c.split(/\n/).find(l => /[?？፧]/.test(l)) || c;
      return q.trim().slice(0, 90);
    });
  const uniqueAsked = [...new Set(asked)].slice(-3);
  if (uniqueAsked.length) {
    lines.push(`- You already asked: ${uniqueAsked.map(q => `"${q}"`).join(' / ')}. Do not ask any of these again. If they didn't answer, they don't want to — answer with what you have or move on.`);
  }

  // Two near-identical replies in a row is the "the bot is stuck on a loop"
  // failure customers actually complain about.
  const norm = s => String(s).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 60);
  const lastTwo = outbound.slice(-2).map(m => norm(m.content));
  if (lastTwo.length === 2 && lastTwo[0] && lastTwo[0] === lastTwo[1]) {
    lines.push('- You have now sent nearly the same reply twice. Do NOT send it a third time. Say something genuinely new, or answer directly with what you already know.');
  }

  return `\n\n## WHAT YOU HAVE ALREADY SAID (do not repeat)\n${lines.join('\n')}\n`;
}

