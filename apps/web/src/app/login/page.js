'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase-browser';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();
  const router = useRouter();

  // Auto-auth when opened inside Telegram
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🪞</div>
          <p className="text-gold animate-pulse">Connecting to MiniMe…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🪞</div>
          <h1 className="font-display text-3xl text-gold-light">MiniMe</h1>
          <p className="text-muted mt-1">Your AI Business Assistant</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          {step === 'phone' ? (
            <>
              <h2 className="text-gold-light font-semibold mb-4">Sign In</h2>
              <input
                type="tel"
                placeholder="+251912345678"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-body placeholder-muted mb-4 focus:outline-none focus:border-gold"
              />
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button
                onClick={sendOTP}
                disabled={loading || !phone}
                className="w-full bg-gold text-bg font-semibold py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
              >
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-gold-light font-semibold mb-1">Enter OTP</h2>
              <p className="text-muted text-sm mb-4">Sent to {phone}</p>
              <input
                type="text"
                placeholder="123456"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-body placeholder-muted mb-4 focus:outline-none focus:border-gold"
              />
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              <button
                onClick={verifyOTP}
                disabled={loading || !otp}
                className="w-full bg-gold text-bg font-semibold py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button onClick={() => setStep('phone')} className="w-full text-muted text-sm mt-3 hover:text-body">← Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
