// "What's new" card on the owner home. One entry at a time: the current release
// note, the same five updates sent to owners on Telegram on 2026-10-24.
//
// To announce the next release, replace RELEASE (new id, items, dates). The card
// stays hidden for owners who dismissed that id, who signed up after it shipped
// (nothing changed for them), and once it is older than SHOW_DAYS.

export const SHOW_DAYS = 14;

export const RELEASE = {
  id: 'whats-new-2026-10',
  date: '2026-10-24',
  items: [
    {
      title: 'Free plan is stronger',
      text: 'MiniMe replies to your customers on its own, at the trust level you set, for your first 100 AI replies each month. After that it writes every reply for you to send.',
    },
    {
      title: 'Your drafts now reach you',
      text: 'We fixed a bug that stopped drafts and customer photos from being saved. Both now arrive properly.',
    },
    {
      title: 'Corrections stick',
      text: 'When you fix a reply, MiniMe learns from it again.',
    },
    {
      title: 'Smarter Secretary',
      text: "New Smart mode for your personal Telegram: MiniMe replies on its own when someone is clearly a customer, friend or family, and asks you once when it isn't. Set a rule per person (always reply / ask me / never) too.",
      href: '/settings/modes',
      cta: 'Open Secretary Mode',
    },
    {
      title: 'Payments',
      text: "Telebirr and bank payments now confirm end to end, and you'll hear back in Telegram once your proof is reviewed.",
    },
  ],
};

export function isWhatsNewVisible({ release = RELEASE, dismissedId = null, businessCreatedAt = null, now = Date.now() } = {}) {
  if (!release?.id || !release.items?.length) return false;
  if (dismissedId === release.id) return false;
  const shipped = Date.parse(`${release.date}T00:00:00Z`);
  if (!Number.isFinite(shipped)) return false;
  if (now > shipped + SHOW_DAYS * 24 * 60 * 60 * 1000) return false;
  const created = businessCreatedAt ? Date.parse(businessCreatedAt) : NaN;
  if (Number.isFinite(created) && created >= shipped) return false;
  return true;
}
