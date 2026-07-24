/**
 * Contact-info redaction — turns an owner's natural-language rule like
 * "don't share my phone number" into an actual removal of that field from
 * the prompt, instead of relying on the LLM to out-argue a hardcoded
 * "share freely" instruction sitting next to the real value.
 *
 * Scans rule text directly (not a separate stored flag) so it applies
 * retroactively to rules the owner already typed before this existed.
 */

const FIELD_KEYWORDS = {
  phone: /\b(phone|number|cell|mobile)\b/i,
  whatsapp: /\bwhats ?app\b/i,
  email: /\be[- ]?mail\b/i,
  address: /\baddress|location\b/i,
  website: /\bwebsite\b/i,
  instagram: /\binstagram\b/i,
  tiktok: /\btik ?tok\b/i,
  facebook: /\bfacebook\b/i,
  telegram_channel: /\btelegram\b/i,
  payment: /\b(bank|account number|telebirr|payment)\b/i,
};

// Owner expresses a restriction: negated sharing verb, or "keep ... private/confidential/secret".
const RESTRICTIVE_RE = /\b(don'?t|do not|never|stop|no longer|avoid)\b[^.!?]{0,40}\b(share|give|tell|send|hand out|disclose|reveal|post|display|show|give out)\b|\bkeep\b[^.!?]{0,40}\b(private|confidential|secret|to (myself|yourself))\b/i;

export function detectRedactedFields(ruleText) {
  const t = String(ruleText || '');
  if (!RESTRICTIVE_RE.test(t)) return [];
  const fields = [];
  for (const [field, re] of Object.entries(FIELD_KEYWORDS)) {
    if (re.test(t)) fields.push(field);
  }
  return fields;
}

// Owner reverses an earlier restriction: "you can share my phone now",
// "it's fine to share my email again", "feel free to give out my address".
const GRANT_RE = /\b(you can|it'?s (ok|okay|fine)|feel free to|go ahead and)\b[^.!?]{0,40}\bshare\b|\bshare\b[^.!?]{0,40}\b(again|now|from now on)\b/i;

/**
 * Fields the owner just gave permission to share again. Used to auto-cancel
 * a prior restriction instead of leaving two contradictory rules stacked —
 * see saveOwnerInstruction in advisor.js.
 */
export function detectGrantedFields(ruleText) {
  const t = String(ruleText || '');
  if (RESTRICTIVE_RE.test(t)) return []; // still a restriction, not a grant
  if (!GRANT_RE.test(t)) return [];
  const fields = [];
  for (const [field, re] of Object.entries(FIELD_KEYWORDS)) {
    if (re.test(t)) fields.push(field);
  }
  return fields;
}

/** Union of redacted fields across all of a business's saved owner_instructions. */
export function getRedactedContactFields(ownerInstructions) {
  const set = new Set();
  for (const r of ownerInstructions || []) {
    for (const f of detectRedactedFields(r?.rule)) set.add(f);
  }
  return set;
}
