const path = require('path');
// Only import Sentry if it's installed — fail gracefully if not
let withSentryConfig;
try { withSentryConfig = require('@sentry/nextjs').withSentryConfig; } catch { withSentryConfig = null; }

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @napi-rs/canvas ships native .node binaries — keep it out of the webpack bundle
  experimental: {
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
  },

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
          // Prevent clickjacking — allow framing only from Telegram (Mini App)
          { key: 'X-Frame-Options', value: 'ALLOWALL' }, // Telegram Mini Apps need this
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // CSP: allow Telegram and trusted origins
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https: http:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.telegram.org https://graph.facebook.com",
              "frame-ancestors *", // Required for Telegram Mini App
            ].join('; '),
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
