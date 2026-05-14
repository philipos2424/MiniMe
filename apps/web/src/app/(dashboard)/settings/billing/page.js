'use client';
import { useState, useEffect } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const STATUS_STYLE = {
  trial:     { bg: 'rgba(176,138,74,.12)',  text: '#7A5C1E' },
  active:    { bg: 'rgba(79,163,138,.12)',  text: '#1E6B58' },
  expired:   { bg: 'rgba(184,84,80,.1)',    text: '#7A2E2B' },
  cancelled: { bg: 'rgba(138,149,144,.1)',  text: MUTED },
};

export default function BillingPage() {
  const { business, setBusiness, initData } = useTelegram();

  // Handle ?paid=1 return from Chapa — refresh business to pick up new status
  useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (sp?.get('paid') === '1' && initData) {
      fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      }).then(r => r.json()).then(d => {
        if (d.business) setBusiness(d.business);
        // Remove ?paid=1 from URL without reload
        const url = new URL(window.location.href);
        url.searchParams.delete('paid');
        window.history.replaceState({}, '', url.toString());
      }).catch(() => {});
    }
  }, [initData, setBusiness]);

  if (!business) return null;

  const status = business.subscription_status || 'trial';
  const planName = (business.plan_tier || business.subscription_plan || 'free') === 'free' ? 'Free' : 'Pro';
  const trialDaysLeft = business.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(business.trial_ends_at) - Date.now()) / 86400000))
    : 0;
  const expiresAt = business.subscription_expires_at
    ? new Date(business.subscription_expires_at)
    : null;
  const isActive = status === 'active' && (!expiresAt || expiresAt > new Date());
  const statusStyle = STATUS_STYLE[status] || STATUS_STYLE.trial;

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', fontFamily: BODY, color: INK, padding: '0 0 80px' }}>
      <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, letterSpacing: '-0.015em', marginBottom: 20 }}>
        Billing
      </div>

      {/* Current plan card */}
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>MiniMe {planName}</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
              {planName === 'Pro' ? '2,500 ETB / month' : 'Free tier'}
            </div>
          </div>
          <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: statusStyle.bg, color: statusStyle.text, textTransform: 'capitalize' }}>
            {status}
          </span>
        </div>

        {/* Trial notice */}
        {status === 'trial' && (
          <div style={{ background: 'rgba(176,138,74,.1)', border: `1px solid rgba(176,138,74,.25)`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#7A5C1E', fontWeight: 500 }}>
              ⏳ Trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</strong>
            </div>
            <div style={{ fontSize: 12, color: '#A07840', marginTop: 3 }}>
              After trial ends, MiniMe will pause until you upgrade.
            </div>
          </div>
        )}

        {/* Expired notice */}
        {(status === 'expired' || status === 'cancelled') && (
          <div style={{ background: 'rgba(184,84,80,.08)', border: `1px solid rgba(184,84,80,.2)`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: ERROR, fontWeight: 500 }}>
              ⚠️ MiniMe is paused — your customers see an offline message.
            </div>
          </div>
        )}

        {/* Active: show renewal date */}
        {isActive && expiresAt && (
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 14 }}>
            Renews on {expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        )}
      </div>

      {/* Upgrade / renew — only when not active */}
      {!isActive && <UpgradeCard initData={initData} businessName={business.name} />}

      {/* Already active — manage note */}
      {isActive && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px', fontSize: 13, color: MUTED, textAlign: 'center' }}>
          Your subscription is active. To cancel or change plan, contact support via <strong>@MiniMeSupport</strong>.
        </div>
      )}
    </div>
  );
}

// ─── Upgrade card ─────────────────────────────────────────────────────────────
function UpgradeCard({ initData, businessName }) {
  const [plan, setPlan]   = useState('pro_monthly');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  const plans = [
    { id: 'pro_monthly', label: 'Monthly', price: '2,500 ETB', period: '/month', badge: null },
    { id: 'pro_annual',  label: 'Annual',  price: '25,000 ETB', period: '/year', badge: '2 months free' },
  ];

  async function startPayment() {
    if (!initData) { setErr('Auth not ready — close and reopen the app.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/payment/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Payment init failed');
      if (!j.checkout_url) throw new Error('No checkout URL returned');
      // Open Chapa checkout: prefer Telegram's openLink for in-app browser
      const twa = window.Telegram?.WebApp;
      if (twa?.openLink) {
        twa.openLink(j.checkout_url);
      } else {
        window.open(j.checkout_url, '_blank');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20 }}>
      <div style={{ fontFamily: SERIF, fontSize: 18, marginBottom: 6 }}>Upgrade to Pro</div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 18, lineHeight: 1.5 }}>
        Unlimited AI replies, full bot features, priority support.
      </div>

      {/* Plan toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {plans.map(p => (
          <button key={p.id} onClick={() => setPlan(p.id)} style={{
            flex: 1, padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
            border: `2px solid ${plan === p.id ? INK : LINE}`,
            background: plan === p.id ? INK : '#fff',
            color: plan === p.id ? PAPER : INK,
            fontFamily: BODY, transition: 'all .15s',
            position: 'relative', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{p.price}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{p.period}</div>
            {p.badge && (
              <div style={{
                position: 'absolute', top: -10, right: 8,
                background: MINT, color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '2px 7px', borderRadius: 999,
              }}>
                {p.badge}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Feature list */}
      <div style={{ marginBottom: 18 }}>
        {[
          'Unlimited AI customer replies',
          'Auto-send trusted replies',
          'Voice profile + knowledge base',
          'Orders, stock & job tracking',
          'Sub-admin team access',
          'Weekly digest + analytics',
        ].map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, color: INK }}>
            <span style={{ color: MINT, fontWeight: 700, fontSize: 15 }}>✓</span> {f}
          </div>
        ))}
      </div>

      {err && (
        <div style={{ background: 'rgba(184,84,80,.1)', border: `1px solid rgba(184,84,80,.25)`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: ERROR, marginBottom: 12 }}>
          {err}
        </div>
      )}

      <button
        onClick={startPayment}
        disabled={busy}
        style={{
          width: '100%', padding: '15px', borderRadius: 999, border: 'none', cursor: busy ? 'default' : 'pointer',
          background: busy ? MUTED : INK, color: PAPER,
          fontSize: 15, fontWeight: 600, fontFamily: BODY, letterSpacing: '-0.01em',
        }}
      >
        {busy ? 'Opening payment…' : `Pay with Chapa →`}
      </button>

      <div style={{ fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 10 }}>
        Telebirr · CBE Birr · Amhara Bank · HelloCash · Bank transfer
      </div>
    </div>
  );
}
