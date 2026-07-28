/**
 * Custom _error.js — overrides Next.js's built-in pages-router error page.
 *
 * The default Next.js internal _error page fails to prerender in this project
 * because it tries to traverse the App Router's client component tree (including
 * LanguageProvider) and React throws "Objects are not valid as a React child".
 *
 * This minimal replacement keeps the same functionality but is safe to prerender.
 */
function Error({ statusCode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--paper, #0F1612)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif",
      color: 'var(--ink, #FFFFFF)',
    }}>
      <div style={{
        textAlign: 'center', maxWidth: 360, background: 'var(--card, #16211B)',
        padding: '32px 24px', borderRadius: 20, border: '1px solid var(--line, rgba(255,255,255,0.08))',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
      }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>
          {statusCode === 404 ? '🗺️' : '🌐'}
        </div>
        <h1 style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontWeight: 500,
          fontSize: 24,
          color: 'var(--ink, #FFFFFF)',
          margin: '0 0 10px',
          letterSpacing: '-0.015em',
        }}>
          {statusCode === 404 ? 'Page not found' : 'We couldn\'t connect'}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted, #9AA39C)', lineHeight: 1.5, margin: '0 0 24px' }}>
          {statusCode === 404
            ? 'This page doesn\'t exist. You may have followed a broken link.'
            : 'Please check your connection or try again in a moment.'}
        </p>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--mint, #7FD9B3)',
            color: '#0F1612',
            borderRadius: 999,
            padding: '10px 22px',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          ← Back to Home
        </a>
      </div>
    </div>
  );
}

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
