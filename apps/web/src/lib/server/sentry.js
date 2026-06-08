/**
 * Sentry helpers for server-side API routes.
 *
 * Usage:
 *   import { captureApiError } from '../../../lib/server/sentry';
 *   captureApiError(e, { business_id: business.id, route: '/api/orders' });
 */

/**
 * Capture an error with business context tags.
 * Falls back to console.error if Sentry is not configured.
 */
export async function captureApiError(error, context = {}) {
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.withScope(scope => {
      if (context.business_id) scope.setTag('business_id', context.business_id);
      if (context.route)       scope.setTag('route', context.route);
      if (context.action)      scope.setTag('action', context.action);
      // Never set customer PII as tags
      scope.setLevel('error');
      Sentry.captureException(error);
    });
  } catch {
    // Sentry not installed or DSN not set — fall back to stderr
    console.error('[API Error]', context.route || '', error?.message || error);
  }
}

/**
 * Wrap a route handler to auto-capture any unhandled errors.
 * Usage:
 *   export const POST = withErrorCapture(async (req, ctx) => { ... }, '/api/orders');
 */
export function withErrorCapture(handler, route) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (e) {
      await captureApiError(e, { route });
      const { NextResponse } = await import('next/server');
      return NextResponse.json({ error: 'internal_server_error' }, { status: 500 });
    }
  };
}
