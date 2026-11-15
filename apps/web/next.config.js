const path = require('path');
// Only import Sentry if it's installed — fail gracefully if not
let withSentryConfig;
try { withSentryConfig = require('@sentry/nextjs').withSentryConfig; } catch { withSentryConfig = null; }

// Which platform this build is for. Read at runtime as process.env.MINIME_HOST
// (src/lib/server/hostLimits.mjs): Netlify stops every request at 60 seconds,
// so the app keeps its LLM calls and webhook handlers inside that there.
const HOST = process.env.VERCEL ? 'vercel' : process.env.NETLIFY ? 'netlify' : 'node';

// On Netlify the site's own address is known at build time (URL). Use it when
// WEB_URL / NEXT_PUBLIC_APP_URL aren't set, so a missed variable can never
// send webhooks, receipts or Mini App links to a host that no longer exists.
const netlifyUrl = HOST === 'netlify' ? (process.env.URL || '').trim().replace(/^http:\/\//, 'https://').replace(/\/$/, '') : '';
const baseUrlDefaults = netlifyUrl ? {
  WEB_URL: (process.env.WEB_URL || netlifyUrl).trim(),
  NEXT_PUBLIC_APP_URL: (process.env.NEXT_PUBLIC_APP_URL || netlifyUrl).trim(),
} : {};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { MINIME_HOST: HOST, ...baseUrlDefaults },

  // Monorepo: force-include shared packages in serverless function bundles.
  // Top-level since Next 15 (they were under `experimental` on 14, where they
  // would now be ignored and packages/db would silently drop out of bundles).
  // instrumentation.js (Sentry.init) loads by default on 15, so the old
  // experimental.instrumentationHook flag is gone.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    './apps/web/src/app/api/**': [
      './packages/db/**/*',
      './packages/shared/**/*',
    ],
  },


  async headers() {
    return [
      {
        // HTML pages must NEVER be cached by Telegram's mini-app webview, or
        // owners get stuck on stale UI for hours after a deploy. Static assets
        // (under /_next/static) keep their hashed-filename long-cache below.
        source: '/((?!_next/static|favicon|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2|ttf|eot)).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // CSP: allow Telegram and trusted origins
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *",
          },
          // HSTS — only enable on HTTPS (VPS with SSL)
          ...(process.env.NODE_ENV === 'production' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          ] : []),
        ],
      },
    ];
  },
};

// Only wrap with Sentry when DSN is set AND the plugin is available
// Without SENTRY_DSN, Sentry is a no-op — no performance impact
const hasSentry = withSentryConfig && process.env.SENTRY_DSN;

// Production is built from `main` only. On 2026-10-13..16 CLI deploys of a
// local feature-branch folder replaced main in production and broke the
// agent brain; Vercel records no git ref for those. Vercel exposes VERCEL_ENV
// and VERCEL_GIT_COMMIT_REF together, so when this can't see the ref it can't
// see VERCEL_ENV either and does nothing — it can't lock out a normal deploy,
// and a refused build leaves the previous production deployment serving.
//
// Same rule on Netlify, which reports the deploy as CONTEXT and BRANCH.
function assertProductionFromMain() {
  const onNetlify = HOST === 'netlify';
  const production = onNetlify ? process.env.CONTEXT === 'production' : process.env.VERCEL_ENV === 'production';
  if (!production) return;
  if (process.env.ALLOW_NON_MAIN_PRODUCTION === '1') return;
  const ref = (onNetlify ? process.env.BRANCH : process.env.VERCEL_GIT_COMMIT_REF) || '';
  if (ref === 'main') return;
  throw new Error(
    `Refusing to build production from ${ref ? `branch "${ref}"` : 'a local folder (no git ref)'}. ` +
    'Production deploys come from main via git push. For a deliberate emergency deploy, ' +
    'set ALLOW_NON_MAIN_PRODUCTION=1 for that one deploy.'
  );
}

const finalConfig = hasSentry
  ? withSentryConfig(nextConfig, {
      silent: true,
      disableLogger: true,
      hideSourceMaps: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Disable Sentry's automatic tree shaking of unused code
      disableServerWebpackPlugin: false,
      disableClientWebpackPlugin: false,
    })
  : nextConfig;

const { PHASE_PRODUCTION_BUILD } = require('next/constants');
module.exports = (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD) assertProductionFromMain();
  return finalConfig;
};
