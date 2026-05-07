'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase-browser';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

const INPUT_BASE = {
  width: '100%', background: COLORS.bg, border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md, padding: '12px 16px', fontSize: 14, color: COLORS.textPrimary,
  fontFamily: FONT.body, outline: 'none', boxSizing: 'border-box',
};

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const twa = window.Telegram?.WebApp;
    if (!twa?.initData) return;

    twa.ready();
    twa.expand();
    setLoading(true);

    fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: twa.initData }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) router.replace('/home');
        else setError(data.error || 'Telegram auth failed');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

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
    else router.push('/home');
    setLoading(false);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.body }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🪞</div>
          <p className="animate-pulse" style={{ color: COLORS.teal, fontSize: 14 }}>Connecting to MiniMe…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', fontFamily: FONT.body }}>
      <div style={{ width: '100%', maxWidth: 384 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🪞</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.teal, margin: 0 }}>MiniMe</h1>
          <p style={{ color: COLORS.textHint, marginTop: 4, fontSize: 14 }}>Your AI Business Assistant</p>
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
