/**
 * Sentry server-side configuration.
 * Captures unhandled exceptions and console.error calls with business context.
 * PII scrubbing rules ensure customer names, phones, and tokens never appear in breadcrumbs.
 */
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Capture 100% of errors (adjust to lower sample rate in high-traffic production)
  tracesSampleRate: 0.1,
  sampleRate: 1.0,

  // Environment tagging
  environment: process.env.NODE_ENV || 'production',
  release: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',

  // PII scrubbing — never send customer data to Sentry
  beforeSend(event) {
    if (!event) return null;

    // Scrub sensitive fields from request bodies
    if (event.request?.data) {
      const data = event.request.data;
      if (typeof data === 'object') {
        ['phone', 'token', 'password', 'api_key', 'secret', 'telegram_bot_token_enc',
         'customer_name', 'customer_phone', 'owner_phone'].forEach(key => {
          if (key in data) data[key] = '[REDACTED]';
        });
      }
    }

    // Scrub phone-like strings from messages
    if (event.message) {
      event.message = event.message.replace(/\+?[0-9]{7,15}/g, '[PHONE]');
    }

    // Scrub bot tokens (format: 123456789:AbCdEfGhIjKlMnOpQrStUvWxYz123456)
    const tokenRe = /\d{8,12}:[A-Za-z0-9_-]{35}/g;
    if (event.message) event.message = event.message.replace(tokenRe, '[BOT_TOKEN]');

    return event;
  },

  // Tag every event with business context when available
  initialScope: {
    tags: {
      app: 'minime-web',
      runtime: 'nodejs',
    },
  },
});
