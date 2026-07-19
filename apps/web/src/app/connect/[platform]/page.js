'use client';
/**
 * /connect/[platform]?initData=...  — standalone connect page.
 *
 * Runs in the system browser (opened via Telegram.WebApp.openLink) because
 * Meta's OAuth dialog does not reliably complete inside Telegram's in-app
 * WebView. It fetches a Nango Connect session token and opens the Connect UI.
 * On success it tells the user to return to MiniMe.
 */
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const INK = '#0E2823';
const PAPER = '#FFFFFF';
const MUTED = '#8A9590';
const MINT = '#4FA38A';
const ERROR = '#B85450';
const BODY = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const SERIF = "'Newsreader', Georgia, serif";

const LABELS = {
  facebook: 'Facebook Page',
  instagram: 'Instagram DMs',
};

export default function ConnectPage() {
  const params = useParams();
  const search = useSearchParams();
  const platform = String(params?.platform || '').toLowerCase();
  const initData = search?.get('initData') || '';

  const [status, setStatus] = useState('loading'); // loading | ready | connecting | done | error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!['facebook', 'instagram'].includes(platform)) {
      setStatus('error'); setError('Unknown channel.'); return;
    }
    if (!initData) { setStatus('error'); setError('Session missing. Reopen from MiniMe.'); return; }

    let cancelled = false;
    (async () => {
      try {
        const { default: Nango } = await import('@nangohq/frontend');
        const res = await fetch('/api/nango/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ platforms: [platform] }),
        });
        const j = await res.json();
        if (!res.ok || !j.sessionToken) throw new Error(j.error || 'Could not start connection.');
        if (cancelled) return;

        setStatus('connecting');
        const nango = new Nango();
        const connect = nango.openConnectUI({
          onEvent: (event) => {
            if (event.type === 'connect') setStatus('done');
            else if (event.type === 'close') {
              setStatus((s) => (s === 'done' ? 'done' : 'ready'));
            }
          },
        });
        connect.setSessionToken(j.sessionToken);
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { setStatus('error'); setError(e.message); }
      }
    })();
    return () => { cancelled = true; };
  }, [platform, initData]);

  return (
    <div style={{ minHeight: '100vh', background: PAPER, color: INK, fontFamily: BODY,
      display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 10px' }}>
          Connect {LABELS[platform] || 'your channel'}
        </h1>

        {status === 'loading' && <p style={{ color: MUTED }}>Starting secure connection…</p>}
        {status === 'connecting' && <p style={{ color: MUTED }}>Opening the authorization window…</p>}
        {status === 'ready' && (
          <p style={{ color: MUTED, lineHeight: 1.6 }}>
            Follow the prompts to authorize {LABELS[platform]}. If the window closed,
            you can refresh this page to try again.
          </p>
        )}
        {status === 'done' && (
          <div>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
            <p style={{ color: MINT, fontWeight: 600, fontSize: 17, margin: '0 0 6px' }}>
              {LABELS[platform]} connected!
            </p>
            <p style={{ color: MUTED, lineHeight: 1.6 }}>
              We&apos;re importing your recent messages now. You can close this tab
              and return to MiniMe — your inbox will be ready.
            </p>
          </div>
        )}
        {status === 'error' && (
          <div>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
            <p style={{ color: ERROR, lineHeight: 1.6 }}>{error || 'Something went wrong.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
