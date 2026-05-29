'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase-browser';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

const INPUT_BASE = {
  width: '100%', background: COLORS.bg, border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md, padding: '12px 16px', fontSize: 14, color: COLORS.textPrimary,
  fontFamily: FONT.body, outline: 'none', boxSizing: 'border-box',
};

// Detect Telegram WebApp environment robustly. The script can load slightly
// after our React mount, so we re-check a few times.
function getTelegramInitData() {
  if (typeof window === 'undefined') return null;
  const twa = window.Telegram?.WebApp;
  return twa?.initData || null;
}

export default function LoginPage() {
  const [phase, setPhase] = useState('detecting'); // detecting | telegram | browser
  const [authing, setAuthing] = useState(false);
  const [error, setError] = useState('');

  // browser fallback state
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [loading, setLoading] = useState(false);

  const supabase = createClient();
  const router = useRouter();

  const authWithTelegram = useCallback(async () => {
    const initData = getTelegramInitData();
    if (!initData) {
      setError('Could not reach Telegram. Reopen this from the bot.');
      return;
    }
    setAuthing(true);
    setError('');
    try {
      const r = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      const data = await r.json();
      if (data.success) {
        router.replace('/');
      } else {
        setError(data.error || 'Telegram sign-in failed');
        setAuthing(false);
      }
    } catch {
      setError('Network error — check your connection');
      setAuthing(false);
    }
  }, [router]);

  // On mount: figure out if we're inside Telegram. Retry a few times because
  // the Telegram WebApp script can finish loading after React mounts.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    function tick() {
      if (cancelled) return;
      const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
      const initData = twa?.initData;
      if (initData) {
        try { twa.ready(); twa.expand(); } catch {}
        setPhase('telegram');
        // Auto-attempt sign-in immediately
        authWithTelegram();
        return;
      }
      if (twa && !initData && attempts > 2) {
        // Telegram is present but didn't give us initData (rare — usually means
        // the mini-app was opened without going through the bot link).
        setPhase('telegram');
        setError('Telegram session is empty. Reopen this from your bot.');
        return;
      }
      attempts++;
      if (attempts > 5) {
        // Real browser, no Telegram → show phone fallback
        setPhase('browser');
        return;
      }
      setTimeout(tick, 250);
    }
    tick();
    return () => { cancelled = true; };
  }, [authWithTelegram]);

  async function sendOTP() {
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) setError(error.message);
    else setStep('otp');
    setLoading(false);
  }

  async function verifyOTP() {
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) setError(error.message);
    else router.push('/');
    setLoading(false);
  }

  // ── Detecting / authing inside Telegram ───────────────────────────────────
  if (phase === 'detecting' || (phase === 'telegram' && authing)) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT.body, padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🪞</div>
          <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 32, color: COLORS.teal, margin: 0 }}>MiniMe</h1>
          <p className="animate-pulse" style={{ color: COLORS.textHint, fontSize: 14, marginTop: 12 }}>
            Signing you in with Telegram…
          </p>
        </div>
      </div>
    );
  }

  // ── Inside Telegram, auto-auth needs a manual retry (rare error path) ─────
  if (phase === 'telegram') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom)',
        fontFamily: FONT.body,
      }}>
        <div style={{ width: '100%', maxWidth: 384, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🪞</div>
          <h1 style={{ fontFamily: "'Newsreader', Georgia, serif", fontSize: 32, color: COLORS.teal, margin: 0 }}>MiniMe</h1>
          <p style={{ color: COLORS.textHint, marginTop: 4, fontSize: 14 }}>Your AI Business Assistant</p>

          {error && (
            <p style={{ color: COLORS.red, fontSize: 13, marginTop: 20, marginBottom: 0 }}>{error}</p>
          )}

          <button
            onClick={authWithTelegram}
            disabled={authing}
            style={{
              marginTop: 24,
              width: '100%', background: COLORS.teal, color: '#FFF', fontWeight: 600,
              padding: '14px 0', borderRadius: 999, border: 'none', fontSize: 15,
              cursor: authing ? 'wait' : 'pointer',
              opacity: authing ? 0.6 : 1, fontFamily: FONT.body,
              boxShadow: '0 4px 16px rgba(79,163,138,0.25)',
            }}
          >
            {authing ? 'Signing in…' : 'Continue with Telegram'}
          </button>

          <p style={{ color: COLORS.textHint, fontSize: 12, marginTop: 20, lineHeight: 1.6 }}>
            You're inside the MiniMe mini-app. No password needed —<br />
            tap above to continue as your Telegram account.
          </p>
        </div>
      </div>
    );
  }

  // ── Browser fallback (phone OTP — rare path, not for Telegram users) ──────
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px', fontFamily: FONT.body,
    }}>
      <div style={{ width: '100%', maxWidth: 384 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🪞</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.teal, margin: 0 }}>MiniMe</h1>
          <p style={{ color: COLORS.textHint, marginTop: 4, fontSize: 14 }}>Your AI Business Assistant</p>
          <p style={{ color: COLORS.textHint, marginTop: 12, fontSize: 12, opacity: 0.8 }}>
            For the best experience, open MiniMe from inside your Telegram bot.
          </p>
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.xl, padding: 24 }}>
          {step === 'phone' ? (
            <>
              <h2 style={{ color: COLORS.textPrimary, fontWeight: 600, fontSize: 16, marginBottom: 16, marginTop: 0 }}>Sign In</h2>
              <input
                type="tel"
                placeholder="+251912345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={{ ...INPUT_BASE, marginBottom: 16 }}
              />
              {error && <p style={{ color: COLORS.red, fontSize: 13, marginBottom: 12 }}>{error}</p>}
              <button
                onClick={sendOTP}
                disabled={loading || !phone}
                style={{
                  width: '100%', background: COLORS.teal, color: '#FFF', fontWeight: 600,
                  padding: '12px 0', borderRadius: RADII.md, border: 'none', fontSize: 14,
                  cursor: loading || !phone ? 'default' : 'pointer',
                  opacity: loading || !phone ? 0.5 : 1, fontFamily: FONT.body,
                }}
              >
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ color: COLORS.textPrimary, fontWeight: 600, fontSize: 16, marginBottom: 4, marginTop: 0 }}>Enter OTP</h2>
              <p style={{ color: COLORS.textHint, fontSize: 13, marginBottom: 16 }}>Sent to {phone}</p>
              <input
                type="text"
                placeholder="123456"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                style={{ ...INPUT_BASE, marginBottom: 16 }}
              />
              {error && <p style={{ color: COLORS.red, fontSize: 13, marginBottom: 12 }}>{error}</p>}
              <button
                onClick={verifyOTP}
                disabled={loading || !otp}
                style={{
                  width: '100%', background: COLORS.teal, color: '#FFF', fontWeight: 600,
                  padding: '12px 0', borderRadius: RADII.md, border: 'none', fontSize: 14,
                  cursor: loading || !otp ? 'default' : 'pointer',
                  opacity: loading || !otp ? 0.5 : 1, fontFamily: FONT.body,
                }}
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button
                onClick={() => setStep('phone')}
                style={{ width: '100%', background: 'none', border: 'none', color: COLORS.textHint, fontSize: 13, marginTop: 12, cursor: 'pointer', fontFamily: FONT.body }}
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
