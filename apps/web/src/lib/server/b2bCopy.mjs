/**
 * Partner (B2B) message copy and guards. Pure, so it can be tested.
 *
 * Found live on 28 Oct 2026 in iconnect's bot chat:
 *  - "Let MiniMe answer" drafted, and the owner sent, a reply telling a luxury
 *    brand "we can certainly help with Instagram mini app development tailored
 *    for luxury e-commerce", which iConnect doesn't sell, and proposing a call.
 *    The draft prompt only saw the shop's name (it fetched the description and
 *    never used it) and told the model to "be concrete about availability,
 *    price, or next step".
 *  - A warm intro went out with the fallback context "your inquiry": the other
 *    business was told "I found you through MiniMe while searching for 'your
 *    inquiry'", and the owner was told "They found you through your MiniMe
 *    research", which is backwards (the owner found them).
 */

/** System prompt for a "Let MiniMe answer" draft, grounded in what the shop sells. */
export function b2bDraftSystemPrompt({ name, description, products = [], rules = [], faq = [] }) {
  const shop = name || 'this business';
  const catalog = products.length
    ? products.slice(0, 30).map(p => {
      const price = p.price != null ? `: ${p.price} ${p.currency || 'ETB'}` : '';
      const desc = p.description ? ` (${String(p.description).slice(0, 120)})` : '';
      return `- ${p.name}${price}${desc}`;
    }).join('\n')
    : '(no products listed)';
  return [
    `You draft a reply for ${shop} to another business that contacted it through MiniMe. The owner reads the draft before anything is sent.`,
    `WHAT ${shop.toUpperCase()} DOES: ${description || '(no description given)'}`,
    `WHAT IT SELLS:\n${catalog}`,
    rules.length ? `OWNER'S RULES (always follow):\n${rules.slice(0, 12).map(r => `- ${r}`).join('\n')}` : '',
    faq.length ? `OWNER'S ANSWERS:\n${faq.slice(0, 8).join('\n')}` : '',
    [
      'RULES FOR THIS DRAFT:',
      '1. Only offer products or services listed above. If they ask for something that is not listed, say politely that it is not something we offer, and mention what we do offer only if it is relevant.',
      '2. Never invent prices, timelines, capabilities or terms. Use only the facts above. If a number is missing, say the owner will confirm it.',
      '3. Do not propose a call, a meeting or a deadline.',
      '4. 1–3 short, friendly, professional sentences, ready to send. No placeholders or brackets.',
    ].join('\n'),
  ].filter(Boolean).join('\n\n');
}

/** What the requester was looking for, or '' when it's the old generic fallback. */
export function cleanContext(context) {
  const c = String(context || '').trim();
  if (!c || /^(your|my|an?) (inquiry|enquiry|request|search|research)$/i.test(c)) return '';
  return c.slice(0, 120);
}

/** Warm intro texts: what the other business receives, and the owner's confirmation. */
export function warmIntroCopy({ context, note }) {
  const what = cleanContext(context);
  const extra = String(note || '').trim();
  const toTarget = extra
    ? (what ? `Hi! Following up on my search for "${what}". ${extra}` : `Hi! ${extra}`)
    : (what ? `Hi! I found you through MiniMe while looking for "${what}" and I'd like to connect.` : `Hi! I found you through MiniMe and I'd like to connect.`);
  const toOwner = what
    ? `You found them through your MiniMe search for "${what}".`
    : 'You found them through MiniMe.';
  return { toTarget, toOwner };
}

// Template or programming leftovers that must never reach another business.
const PLACEHOLDERS = [
  /\$\{[^}]*\}/,                 // ${var}
  /\{\{[^}]*\}\}/,               // {{var}}
  /\[object Object\]/,
  /(^|[\s"'(:])(undefined|NaN)([\s"'.,)!?:]|$)/,
  /<[A-Z][A-Z_]{2,}>/,           // <NAME>, <PRODUCT_NAME>
  /\[(name|business|company|product|price|date|your [a-z ]+)\]/i,
  /["“']your (inquiry|enquiry|request)["”']/i,
];

export function hasUnfilledPlaceholder(text) {
  const s = String(text || '');
  return PLACEHOLDERS.some(re => re.test(s));
}
