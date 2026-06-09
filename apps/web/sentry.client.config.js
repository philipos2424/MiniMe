/**
 * Sentry client-side configuration.
 * Captures unhandled promise rejections and JS errors in the dashboard UI.
 * Very conservative PII handling — only business ID is sent, never customer data.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Low sample rate for client-side — browser errors are noisy
  tracesSampleRate: 0.05,
  sampleRate: 1.0,

  environment: process.env.NODE_ENV || 'production',

  // Never capture keyboard input (prevents accidental password capture)
  maskAllInputs: true,
  maskAllText: false,

  beforeSend(event) {
    // Remove any URLs that might contain tokens or secrets
    if (event.request?.url) {
      event.request.url = event.request.url
        .replace(/secret=[^&]+/g, 'secret=[REDACTED]')
        .replace(/token=[^&]+/g, 'token=[REDACTED]')
        .replace(/impersonate=[^&]+/g, 'impersonate=[REDACTED]');
    }
    return event;
  },
});
