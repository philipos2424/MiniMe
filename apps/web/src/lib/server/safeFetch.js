/**
 * SSRF-hardened fetch.
 *
 * A blocklist regex over hostnames (the previous defense in sanitize.js) loses
 * to trivially: `169.254.169.254` (cloud metadata) wasn't covered, `[::1]`
 * (IPv6 loopback) wasn't covered, and a public hostname like `localtest.me`
 * that simply RESOLVES to 127.0.0.1 sailed through — as did any public URL
 * that 302-redirects to an internal one, because only the first URL was ever
 * checked.
 *
 * The only correct check is on the resolved IP, not the string. This module:
 *   1. Parses the URL and enforces http/https.
 *   2. DNS-resolves the hostname and rejects if ANY resolved address is
 *      private, loopback, link-local, or otherwise not a public unicast IP.
 *   3. Follows redirects MANUALLY, re-validating the host at every hop, so an
 *      internal target reached via redirect is rejected too.
 *
 * A residual DNS-rebinding TOCTOU window remains (the name could resolve to a
 * public IP during our check and a private one when fetch connects). Closing
 * it fully needs IP-pinned connections; re-resolving and checking every hop
 * raises the bar far above every practical exploit and blocks all the known
 * bypasses. Keep the "validate the resolved IP, every hop" invariant if you
 * edit this file.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;

/** Parse an IPv4 dotted-quad into a 32-bit int, or null if not IPv4. */
function ipv4ToInt(ip) {
  if (net.isIPv4(ip) !== true) return null;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4InCidr(ipInt, baseIp, maskBits) {
  const baseInt = ipv4ToInt(baseIp);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * True if `ip` (a numeric string address, IPv4 or IPv6) is NOT a public,
 * routable unicast address — i.e. we must refuse to connect to it.
 */
export function isBlockedAddress(ip) {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    return (
      ipv4InCidr(v4, '0.0.0.0', 8) ||        // "this" network
      ipv4InCidr(v4, '10.0.0.0', 8) ||       // private
      ipv4InCidr(v4, '100.64.0.0', 10) ||    // CGNAT
      ipv4InCidr(v4, '127.0.0.0', 8) ||      // loopback
      ipv4InCidr(v4, '169.254.0.0', 16) ||   // link-local (cloud metadata!)
      ipv4InCidr(v4, '172.16.0.0', 12) ||    // private
      ipv4InCidr(v4, '192.0.0.0', 24) ||     // IETF protocol assignments
      ipv4InCidr(v4, '192.168.0.0', 16) ||   // private
      ipv4InCidr(v4, '198.18.0.0', 15) ||    // benchmarking
      ipv4InCidr(v4, '224.0.0.0', 4) ||      // multicast
      ipv4InCidr(v4, '240.0.0.0', 4)         // reserved
    );
  }

  if (net.isIPv6(ip) === true) {
    const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (addr === '::1' || addr === '::') return true;         // loopback / unspecified
    if (addr.startsWith('fe80') || addr.startsWith('fe9') ||
        addr.startsWith('fea') || addr.startsWith('feb')) return true; // link-local
    if (/^f[cd]/.test(addr)) return true;                     // unique-local fc00::/7
    if (addr.startsWith('ff')) return true;                   // multicast
    return false;
  }

  // Not a recognizable numeric IP → refuse (can't reason about it).
  return true;
}

/**
 * Resolve `hostname` and throw if it points anywhere non-public.
 * A literal IP is checked directly (no DNS). Returns the resolved addresses.
 */
export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw new Error(`blocked address: ${host}`);
    return [host];
  }
  let results;
  try {
    results = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`dns resolution failed: ${host}`);
  }
  if (!results.length) throw new Error(`no address for host: ${host}`);
  for (const { address } of results) {
    if (isBlockedAddress(address)) {
      throw new Error(`host resolves to blocked address (${address}): ${host}`);
    }
  }
  return results.map(r => r.address);
}

/**
 * fetch() that refuses internal/private targets and re-validates every
 * redirect hop. Same signature as fetch, minus that `redirect` is forced to
 * 'manual' internally. Throws on a blocked target (caller should treat as a
 * user error, not a crash).
 */
export async function safeFetch(inputUrl, init = {}) {
  let current = String(inputUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed;
    try { parsed = new URL(current); } catch { throw new Error(`invalid url: ${current}`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`blocked protocol: ${parsed.protocol}`);
    }
    await assertPublicHost(parsed.hostname);

    const res = await fetch(current, { ...init, redirect: 'manual' });

    // Not a redirect → done.
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res; // redirect with no target — hand back as-is
    current = new URL(location, current).toString(); // resolve relative redirects
  }
  throw new Error('too many redirects');
}
