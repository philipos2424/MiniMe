# Mini App UI release — 22 September 2026

Release built from commit `c00507cd22d628a84619ad455df65bdc7054bb0e` in an isolated staging directory, with the Home, Chats, responsive workspace shell, first-run guidance, client tracking and home-feed fixes overlaid from the working tree.

The build also declares the existing Axios 1.15.0 dependency explicitly for the web workspace. A clean Vercel build found that the WhatsApp integration imported it without declaring it.

Unfinished payment, webhook-security and reply-engine edits, new database migrations, and development-only previews were excluded. The existing deleted demo routes remain removed. No database migration was applied for this release.

Deployment: `dpl_4xhBgUXGrS6Rb4QrUviniPkgqcab`

Deployment URL: https://web-kacypa7om-philiposw11-9068s-projects.vercel.app

Telegram bot: `MiniMeAgentBot`. Its existing menu button is **Open MiniMe**, configured for https://web-theta-one-68.vercel.app/.

Previous stable-URL deployment, recorded before alias promotion: `dpl_7cdTGLhCMKj16sbds9PLeDVRo3je` / https://web-3oc12tmvq-philiposw11-9068s-projects.vercel.app.

Validation before release: 814 local tests passed; local production build passed; fixture UI checked at mobile and desktop widths. These checks do not replace an authenticated Telegram test on the deployed release.

Confirmed live: Vercel reports **Ready** and both production aliases point to this deployment, including the existing Telegram menu URL. Home and Chats return HTTP 200 and serve the new UI and workspace bundles. An unauthenticated request to `/api/home/feed` correctly returns HTTP 401. No bot-menu change was necessary.
