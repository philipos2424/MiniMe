/**
 * Next.js instrumentation hook — the only place that actually loads
 * sentry.server.config.js / sentry.edge.config.js. Without this file
 * (and experimental.instrumentationHook in next.config.js on Next 14),
 * those configs are never imported and Sentry.init() never runs server-side.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    const { validateEnv } = await import('./src/lib/server/validateEnv');
    validateEnv();
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
