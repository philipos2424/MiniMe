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
      background: '#FBF8F1',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
    }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>
          {statusCode === 404 ? '🗺️' : '⚡'}
        </div>
        <h1 style={{
          fontFamily: "'Newsreader', Georgia, serif",
          fontWeight: 400,
          fontSize: 28,
          color: '#0E2823',
          margin: '0 0 8px',
          letterSpacing: '-0.02em',
        }}>
          {statusCode === 404 ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p style={{ fontSize: 14, color: '#8A9590', lineHeight: 1.5, margin: '0 0 24px' }}>
          {statusCode === 404
            ? 'This page doesn\'t exist. You may have followed a broken link.'
            : `An error ${statusCode} occurred. Please try again.`}
        </p>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: '#0E2823',
            color: '#FBF8F1',
            borderRadius: 999,
            padding: '11px 20px',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ← Back to home
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
