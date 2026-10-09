/**
 * Link guard — the brain may only send links it was actually given.
 *
 * Asked to "share a relevant link or sample", the model invents one when the
 * business has none: example.com/flared-jeans, bebanya.com/portfolio for a
 * business with no website, jackdigitals.com/phones on a real domain with a
 * made-up path. 30 days of follow-ups carried dozens of these to real
 * customers. Prompting alone didn't stop it, so this runs on every outbound
 * brain message: a URL survives only if it appears verbatim in something we
 * know is real (the business profile, its products, this chat), or is on a
 * host we generate links for ourselves (payments, the platform).
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Trailing punctuation is almost always sentence punctuation, not URL.
const TRAILING = /[.,;:!?)\]}»"']+$/;

/** Canonical form for comparison: no scheme, no www, no trailing slash/punct, lowercased host. */
export function normalizeUrl(raw) {
  let u = String(raw || '').trim().replace(TRAILING, '');
  u = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const slash = u.indexOf('/');
  const host = (slash === -1 ? u : u.slice(0, slash)).toLowerCase();
  const rest = slash === -1 ? '' : u.slice(slash);
  return (host + rest).replace(/\/+$/, '');
}

function hostOf(norm) {
  return norm.split(/[/?#]/)[0];
}

/** Every URL mentioned anywhere in the given texts, normalized. */
export function extractUrls(...texts) {
  const out = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).match(URL_RE) || []) out.add(normalizeUrl(m));
  }
  return out;
}

/**
 * Profile fields become the exact links share_links would send, so the guard
 * and the tool agree on what "the business's Instagram" is.
 */
export function profileUrls(business = {}) {
  // Same rule as share_links: a full URL is used as-is, anything else is a
  // handle on that network ("iconnect.plus" on Instagram is a handle, not a site).
  const handle = (v, base) => {
    if (!v) return null;
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return `${base}${s.replace(/^@/, '').replace(/\s+/g, '')}`;
  };
  const site = (v) => (v ? (/^https?:\/\//i.test(String(v).trim()) ? String(v).trim() : `https://${String(v).trim()}`) : null);
  const links = [
    site(business.website),
    site(business.portfolio_url),
    handle(business.instagram, 'https://instagram.com/'),
    handle(business.facebook, 'https://facebook.com/'),
    handle(business.tiktok, 'https://tiktok.com/@'),
    handle(business.telegram_channel, 'https://t.me/'),
    business.telegram_bot_username ? `https://t.me/${String(business.telegram_bot_username).replace(/^@/, '')}` : null,
  ].filter(Boolean);
  return extractUrls(links.join(' '));
}

// Hosts whose links we mint ourselves (payment checkouts, receipts, shop pages).
const TRUSTED_HOSTS = ['chapa.co', 'checkout.chapa.co'];

export function trustedHosts(extra = []) {
  const hosts = new Set(TRUSTED_HOSTS);
  // Every env var the codebase builds its own links from (receipts, shop
  // pages, mini app) — missing one here strips our own links.
  const env = process.env;
  for (const v of [env.NEXT_PUBLIC_APP_URL, env.APP_URL, env.WEB_URL, env.NEXT_PUBLIC_WEB_URL, env.MINIAPP_URL, ...extra]) {
    if (v) hosts.add(hostOf(normalizeUrl(v)));
  }
  return hosts;
}

/**
 * Remove every URL from `text` that isn't in `known` and isn't on a trusted
 * host. Returns { text, removed } — `removed` lists the original URLs dropped.
 * A link is matched exactly (after normalization); a real domain with an
 * invented path is still invented.
 */
export function scrubUnknownLinks(text, known, hosts = trustedHosts()) {
  const removed = [];
  if (!text) return { text, removed };
  let out = String(text).replace(URL_RE, (match) => {
    const trail = (match.match(TRAILING) || [''])[0];
    const norm = normalizeUrl(match);
    const host = hostOf(norm);
    // Placeholder domains are never real, even when an earlier hallucination
    // put one in the chat history (which would otherwise make it "known").
    const placeholder = /(^|\.)example\.(com|org|net)$|(^|\.)(example|test|invalid|localhost)$/.test(host);
    const ok = !placeholder && (known.has(norm) || [...hosts].some(h => host === h || host.endsWith(`.${h}`)));
    if (ok) return match;
    removed.push(match.replace(TRAILING, ''));
    // Keep a closing bracket that belonged to the sentence; drop the rest.
    return /[)\]]/.test(trail) ? trail.replace(/[^)\]]/g, '') : '';
  });
  if (!removed.length) return { text, removed };
  out = out
    .replace(/[ \t]*[:：\-–—][ \t]*(?=[.!?]?[ \t]*(\n|$))/g, '') // "here it is: " with nothing after
    .replace(/[ \t]+([.,!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]*[.,]?[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, removed };
}
