const path = require('path');
// Only import Sentry if it's installed — fail gracefully if not
let withSentryConfig;
try { withSentryConfig = require('@sentry/nextjs').withSentryConfig; } catch { withSentryConfig = null; }

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Monorepo: force-include shared packages in serverless function bundles
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
module.exports = hasSentry
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
