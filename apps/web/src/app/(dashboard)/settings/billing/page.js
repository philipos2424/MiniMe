'use client';
import { useState, useEffect, useRef } from 'react';
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
  trial:           { bg: 'rgba(176,138,74,.12)', text: '#7A5C1E', label: 'Trial' },
  active:          { bg: 'rgba(79,163,138,.12)', text: '#1E6B58', label: 'Active' },
  expired:         { bg: 'rgba(184,84,80,.1)',   text: '#7A2E2B', label: 'Expired' },
  cancelled:       { bg: 'rgba(138,149,144,.1)', text: MUTED,     label: 'Cancelled' },
  pending_review:  { bg: 'rgba(176,138,74,.18)', text: '#7A5C1E', label: 'Pending review' },
};

export default function BillingPage() {
  const { business, setBusiness, initData } = useTelegram();

  useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    if (sp?.get('paid') === '1' && initData) {
      fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      }).then(r => r.json()).then(d => {
        if (d.business) setBusiness(d.business);
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
  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at) : null;
  const isActive = status === 'active' && (!expiresAt || expiresAt > new Date());
  const isPending = status === 'pending_review';
  const statusStyle = STATUS_STYLE[status] || STATUS_STYLE.trial;

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', fontFamily: BODY, color: INK, padding: '0 0 80px' }}>
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
          <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: statusStyle.bg, color: statusStyle.text }}>
            {statusStyle.label}
          </span>
        </div>

        {status === 'trial' && (
          <div style={{ background: 'rgba(176,138,74,.1)', border: `1px solid rgba(176,138,74,.25)`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#7A5C1E', fontWeight: 500 }}>
              ⏳ Trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</strong>
            </div>
          </div>
        )}

        {isPending && (
          <div style={{ background: 'rgba(176,138,74,.1)', border: `1px solid rgba(176,138,74,.25)`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: '#7A5C1E' }}>
              📨 Your payment is being reviewed. We'll confirm within 24 hours.
            </div>
          </div>
        )}

        {(status === 'expired' || status === 'cancelled') && (
          <div style={{ background: 'rgba(184,84,80,.08)', border: `1px solid rgba(184,84,80,.2)`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: ERROR }}>
              ⚠️ MiniMe is paused — your customers see an offline message.
            </div>
          </div>
        )}

        {isActive && expiresAt && (
          <div style={{ fontSize: 13, color: MUTED }}>
            Renews on {expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        )}
      </div>

      {!isActive && !isPending && <UpgradeFlow initData={initData} />}

      {(isActive || isPending) && (
        <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px', fontSize: 13, color: MUTED, textAlign: 'center' }}>
          {isPending ? 'Payment under review.' : 'Your subscription is active.'} To make changes, contact <strong>@MiniMeSupport</strong>.
        </div>
      )}
    </div>
  );
}

// ─── Upgrade flow (3 methods) ─────────────────────────────────────────────────
function UpgradeFlow({ initData }) {
  const [plan, setPlan] = useState('pro_monthly');
  const [method, setMethod] = useState(null); // null = picker, 'chapa' | 'telebirr_manual' | 'cbe_manual'
  const [manualState, setManualState] = useState(null); // { instructions, tx_ref, plan, amount }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const planAmount = plan === 'pro_annual' ? '25,000' : '2,500';
  const planSubtitle = plan === 'pro_annual' ? 'per year' : 'per month';

  async function startPayment(chosenMethod) {
    setMethod(chosenMethod);
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/payment/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ plan, method: chosenMethod }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Payment init failed');
      if (chosenMethod === 'chapa') {
        if (!j.checkout_url) throw new Error('No checkout URL returned');
        const twa = window.Telegram?.WebApp;
        if (twa?.openLink) twa.openLink(j.checkout_url);
        else window.open(j.checkout_url, '_blank');
      } else {
        // Manual flow — show instructions + screenshot upload
        setManualState({ instructions: j.instructions, tx_ref: j.tx_ref, plan: j.plan, amount: j.amount, months: j.months });
      }
    } catch (e) {
      setErr(e.message); setMethod(null);
    } finally { setBusy(false); }
  }

  if (manualState) {
    return <ManualPaymentForm initData={initData} method={method} plan={plan} state={manualState} onReset={() => { setManualState(null); setMethod(null); }} />;
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20 }}>
      <div style={{ fontFamily: SERIF, fontSize: 18, marginBottom: 6 }}>Upgrade to Pro</div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.5 }}>
        Unlimited AI replies, full bot, priority support.
      </div>

      {/* Plan toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[
          { id: 'pro_monthly', label: 'Monthly', price: '2,500 ETB', period: '/month' },
          { id: 'pro_annual',  label: 'Annual',  price: '25,000 ETB', period: '/year', badge: '2 months free' },
        ].map(p => (
          <button key={p.id} onClick={() => setPlan(p.id)} style={{
            flex: 1, padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
            border: `2px solid ${plan === p.id ? INK : LINE}`,
            background: plan === p.id ? INK : '#fff',
            color: plan === p.id ? PAPER : INK,
            fontFamily: BODY, position: 'relative', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{p.price}</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{p.period}</div>
            {p.badge && (
              <div style={{ position: 'absolute', top: -10, right: 8, background: MINT, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999 }}>
                {p.badge}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Payment method buttons */}
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Pay with
      </div>

      <button onClick={() => startPayment('telebirr_manual')} disabled={busy}
        style={methodButtonStyle({ disabled: busy, color: '#00A859' })}>
        <span style={{ fontSize: 20 }}>📱</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Telebirr</div>
          <div style={{ fontSize: 11, color: MUTED }}>Send to our number, upload screenshot</div>
        </div>
        <span style={{ color: MUTED }}>›</span>
      </button>

      <button onClick={() => startPayment('cbe_manual')} disabled={busy}
        style={methodButtonStyle({ disabled: busy, color: '#742F8F' })}>
        <span style={{ fontSize: 20 }}>🏦</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>CBE Bank transfer</div>
          <div style={{ fontSize: 11, color: MUTED }}>Bank account + screenshot</div>
        </div>
        <span style={{ color: MUTED }}>›</span>
      </button>

      <button onClick={() => startPayment('chapa')} disabled={busy}
        style={methodButtonStyle({ disabled: busy, color: '#7E50A6' })}>
        <span style={{ fontSize: 20 }}>💳</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Chapa (instant)</div>
          <div style={{ fontSize: 11, color: MUTED }}>Card / mobile money — auto-confirmed</div>
        </div>
        <span style={{ color: MUTED }}>›</span>
      </button>

      {err && (
        <div style={{ background: 'rgba(184,84,80,.1)', border: `1px solid rgba(184,84,80,.25)`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: ERROR, marginTop: 12 }}>
          {err}
        </div>
      )}
    </div>
  );
}

function methodButtonStyle({ disabled }) {
  return {
    width: '100%', padding: '14px 16px', marginBottom: 8,
    border: `1px solid ${LINE}`, borderRadius: 12,
    background: '#fff', cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', gap: 12,
    fontFamily: BODY, color: INK, transition: 'all .12s',
    opacity: disabled ? 0.5 : 1,
  };
}

// ─── Manual payment form (Telebirr / CBE) ────────────────────────────────────
function ManualPaymentForm({ initData, method, plan, state, onReset }) {
  const fileRef = useRef(null);
  const [uploadState, setUploadState] = useState('idle'); // idle | uploading | done | error
  const [resultMsg, setResultMsg] = useState('');
  const [err, setErr] = useState('');

  const ins = state.instructions;
  const isTelebirr = method === 'telebirr_manual';

  async function submitScreenshot(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr('Screenshot too large (10 MB max)'); return; }
    setUploadState('uploading'); setErr(''); setResultMsg('');
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      fd.append('tx_ref', state.tx_ref);
      fd.append('method', method);
      fd.append('plan', plan);
      const r = await fetch('/api/payment/subscribe/proof', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      setUploadState('done');
      setResultMsg(j.status === 'active' ? '🎉 Subscription activated!' : '📨 Sent for review — we\'ll confirm within 24 hours.');
    } catch (e) {
      setUploadState('error'); setErr(e.message);
    }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontFamily: SERIF, fontSize: 18 }}>
          {isTelebirr ? 'Pay with Telebirr' : 'Pay with CBE'}
        </div>
        <button onClick={onReset} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 13 }}>
          ← Back
        </button>
      </div>

      {/* Instructions */}
      <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
          Send {ins.amount.toLocaleString()} {ins.currency} to:
        </div>
        {isTelebirr ? (
          <>
            <InfoRow label="Phone" value={ins.phone} copy />
            <InfoRow label="Name"  value={ins.name} />
          </>
        ) : (
          <>
            <InfoRow label="Account" value={ins.account} copy />
            <InfoRow label="Name"    value={ins.name} />
            {ins.phone && <InfoRow label="Phone" value={ins.phone} />}
          </>
        )}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
          <InfoRow label="Reference" value={ins.reference} copy mono />
          <InfoRow label="Amount" value={`${ins.amount.toLocaleString()} ${ins.currency}`} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: MUTED, marginBottom: 12, lineHeight: 1.5 }}>
        After sending, upload a screenshot of the confirmation. {plan === 'pro_annual' ? 'Annual payments are reviewed within 24 hours.' : 'Monthly subscriptions activate instantly.'}
      </div>

      {uploadState === 'done' ? (
        <div style={{ background: 'rgba(79,163,138,.1)', border: `1px solid ${MINT}`, color: '#1E6B58', borderRadius: 12, padding: '14px 16px', fontSize: 14, fontWeight: 500, textAlign: 'center' }}>
          {resultMsg}
        </div>
      ) : (
        <>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={submitScreenshot} />
          <button onClick={() => fileRef.current?.click()} disabled={uploadState === 'uploading'} style={{
            width: '100%', padding: 14, borderRadius: 999, border: 'none',
            background: uploadState === 'uploading' ? MUTED : INK, color: PAPER,
            fontSize: 14, fontWeight: 600, cursor: uploadState === 'uploading' ? 'default' : 'pointer',
            fontFamily: BODY,
          }}>
            {uploadState === 'uploading' ? 'Uploading…' : '📸 Upload screenshot'}
          </button>
          {err && (
            <div style={{ background: 'rgba(184,84,80,.1)', border: `1px solid rgba(184,84,80,.25)`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: ERROR, marginTop: 10 }}>
              {err}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value, copy, mono }) {
  function doCopy() {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(String(value)).catch(() => {});
    }
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', gap: 12 }}>
      <span style={{ fontSize: 12, color: MUTED }}>{label}</span>
      <span onClick={copy ? doCopy : undefined} style={{
        fontSize: 14, fontWeight: 500, color: INK,
        fontFamily: mono ? "'Geist Mono', monospace" : BODY,
        cursor: copy ? 'pointer' : 'default',
        userSelect: 'all',
      }}>
        {value}{copy && <span style={{ marginLeft: 6, fontSize: 11, color: GOLD }}>📋</span>}
      </span>
    </div>
  );
}
