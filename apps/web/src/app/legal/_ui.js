// Shared presentational primitives for the /legal documents.
// Server components — pure, no state. Keeps every legal page visually consistent.

const INK = '#0E2823';
const MUTED = '#5B6B66';
const FAINT = '#8A9590';
const PAPER = '#FBF8F1';
const LINE = '#E7E1D6';

export const SUPPORT_EMAIL = 'philiposw1@gmail.com';
export const LAST_UPDATED = 'July 3, 2026';

export function DocTitle({ children, updated = LAST_UPDATED }) {
  return (
    <header style={{ marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${LINE}` }}>
      <h1 style={{
        fontFamily: "'Newsreader', Georgia, serif", fontWeight: 400, fontSize: 34,
        color: INK, margin: '0 0 8px', letterSpacing: '-0.02em', lineHeight: 1.15,
      }}>
        {children}
      </h1>
      <p style={{ fontSize: 13, color: FAINT, margin: 0 }}>Last updated: {updated}</p>
    </header>
  );
}

export function Lead({ children }) {
  return (
    <p style={{ fontSize: 16, lineHeight: 1.65, color: INK, margin: '0 0 24px' }}>{children}</p>
  );
}

export function Section({ n, title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{
        fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600, fontSize: 18,
        color: INK, margin: '0 0 10px', letterSpacing: '-0.01em',
      }}>
        {n != null ? <span style={{ color: FAINT, fontWeight: 500 }}>{n}.&nbsp;</span> : null}{title}
      </h2>
      {children}
    </section>
  );
}

export function P({ children }) {
  return <p style={{ fontSize: 14.5, lineHeight: 1.7, color: MUTED, margin: '0 0 12px' }}>{children}</p>;
}

export function UL({ children }) {
  return <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>{children}</ul>;
}

export function LI({ children }) {
  return <li style={{ fontSize: 14.5, lineHeight: 1.7, color: MUTED, marginBottom: 6 }}>{children}</li>;
}

export function Strong({ children }) {
  return <strong style={{ color: INK, fontWeight: 600 }}>{children}</strong>;
}

export function A({ href, children }) {
  return <a href={href} style={{ color: '#0E2823', textDecoration: 'underline', textUnderlineOffset: 2 }}>{children}</a>;
}

export function Callout({ children }) {
  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 12,
      padding: '14px 16px', margin: '0 0 16px',
      fontSize: 13.5, lineHeight: 1.65, color: MUTED,
    }}>
      {children}
    </div>
  );
}

export const palette = { INK, MUTED, FAINT, PAPER, LINE };
