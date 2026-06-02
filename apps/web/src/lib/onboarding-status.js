// Single source of truth for whether a business still needs the onboarding wizard.
//
// A business is considered "onboarded" once it has EITHER:
//   - a linked Telegram bot username (custom-bot mode), OR
//   - the onboarding_completed flag set (e.g. shared-mode activation sets this).
//
// Keep this logic in exactly one place — it gates redirects in DashboardShell
// and the wizard's own bounce-away effect, and those must never disagree.
export function needsOnboarding(business) {
  if (!business) return true;
  return !business.telegram_bot_username && !business.onboarding_completed;
}

export function isOnboarded(business) {
  return !needsOnboarding(business);
}
