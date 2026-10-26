/**
 * Which bottom tab a page belongs to, and where Back goes when there's no
 * history (a page opened straight from a Telegram button).
 *
 * Settings opens pages that live outside /settings (Knowledge Base, Team,
 * Partners, the assistant). The Settings tab lost its highlight on those, and
 * the Team page's own Back handler sent owners to Home.
 */
export const SETTINGS_PAGES_OUTSIDE = ['/teach', '/agent/team', '/b2b', '/assistant'];

const under = (pathname, root) => pathname === root || pathname.startsWith(root + '/');

/** True when the tab at `href` should be highlighted on `pathname`. */
export function isTabActive(href, pathname) {
  if (href === '/') return pathname === '/';
  if (under(pathname, href)) return true;
  return href === '/settings' && SETTINGS_PAGES_OUTSIDE.some(r => under(pathname, r));
}

/** Where Back goes without history: Settings for its pages, else one level up, else Home. */
export function parentPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  if (SETTINGS_PAGES_OUTSIDE.some(r => under(pathname, r))) return '/settings';
  const up = pathname.replace(/\/[^/]+\/?$/, '');
  return up || '/';
}
