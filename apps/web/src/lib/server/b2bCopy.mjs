/**
 * Partner (B2B) message copy and guards. Pure, so it can be tested.
 *
 * Found live on 28 Oct 2026:
 *  - A "Let MiniMe answer" draft to a luxury brand promised "Instagram mini
 *    app development tailored for luxury e-commerce", which iConnect doesn't
 *    sell. The draft prompt only saw the shop's NAME: no description, no
 *    catalog, no rules.
 *  - A warm intro went out with the fallback context "your inquiry": the
 *    target was told "I found you through MiniMe while searching for 'your
 *    inquiry'", and the owner was told the target "found you" (backwards).
 */

/** System prompt for a "Let MiniMe answer" draft, grounded in what the shop actually sells. */
export function b2bDraftSystemPrompt({ name, description, products = [], rules = [], faq = [] }) {
  const catalog = products.length
    ? products.slice(0, 30).map(p => `- ${p.name}${p.price != null ? `: ${p.price} ${p.currency || 'ETB'}` : ''}${p.description ? ` (${String(p.description).slice(0, 120)})` : ''}`).join('\n')
    : '(no products listed)';
  const rulesText = rules.length ? rules.slice(0, 10).map(r => `- ${r}`).join('\n') : '';
  const faqText = faq.length ? faq.slice(0, 8).map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n') : '';
  return [
    `You are drafting a reply for ${name || 'this business'} to another business that contacted them through MiniMe. The owner reviews the draft before it is sent.`,
    `WHAT ${String(name || 'this business').toUpperCase()} DOES: ${description || '(no description given)'}`,
    `WHAT IT SELLS:\n${catalog}`,
    rulesText && `OWNER'S RULES (always follow):\n${rulesText}`,
    faqText && `OWNER'S ANSWERS:\n${faqText}`,
    'RULES FOR THIS DRAFT:',
    '1. Only offer products or services listed above. If they ask for something not listed, say politely that it is not something we offer, and mention what we do offer if it is relevant.',
    '2. Never invent prices, timelines, capabilities or terms. Use only the numbers above; if one is missing, say the owner will confirm it.',
    '3. Never propose a call, meeting or deadline.',
    '4. 1–3 short, friendly, professional sentences. No placeholders.',
  ].filter(Boolean).join('\n\n');
}

/** Warm intro texts. `context` is what the requester was looking for, if known. */
export function warmIntroCopy({ context, note, targetName }) {
  const what = cleanContext(context);
  const toTarget = note
    ? (what ? `Hi! Following up on my search for "${what}". ${note}` : `Hi! ${note}`)
    : (what ? `Hi! I found you through MiniMe while looking for "${what}" and I'd like to connect.` : `Hi! I found you through MiniMe and I'd like to connect.`);
  const toOwner = what
    ? `You found them through your MiniMe search for "${what}".`
    : `You found them through MiniMe.`;
  return { toTarget, toOwner, targetName };
}

function cleanContext(context) {
  const c = String(context || '').trim();
  if (!c || /^your (inquiry|request|search)$/i.test(c)) return '';
  return c.slice(0, 120);
}

// Template text that must never reach another business.
const PLACEHOLDER = /(\$\{[^}]*\}|\{\{[^}]*\}\}|\[object Object\]|\bundefined\b|\bnull\b(?!\s*(and|or)\s*void)|<[A-Z_]{3,}>|\[(name|business|product|price|date)\])/i;

export function hasUnfilledPlaceholder(text) {
  return PLACEHOLDER.test(String(text || ''));
}
