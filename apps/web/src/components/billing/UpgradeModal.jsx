'use client';

import React, { useState, useEffect } from 'react';
import { SUBSCRIPTION_PLANS, PURCHASABLE_PLANS, PRO_FEATURES } from '../../lib/plan';
import SocialProof from '../ui/SocialProof';

// Why the modal opened. Drives the headline — it used to be hardcoded to
// "You've used all your free AI credits", which was shown even to owners
// mid-trial with everything unlocked. Claiming a limit the account has not hit
// is the exact dark pattern we don't want at the moment of highest intent.
function headlineFor(reason, feature) {
  const f = feature && PRO_FEATURES[feature];
  if (f) {
    return {
      badge: `${f.emoji} ${f.label} is a Pro feature`,
      title: `Unlock ${f.label}`,
      sub: f.pitch,
      tone: 'gold',
    };
  }
  if (reason === 'trial_ending') {
    return {
      badge: '⏳ Your free month is ending',
      title: 'Keep everything unlocked',
      sub: 'MiniMe keeps writing every reply either way. Pro is the difference between MiniMe sending them and you tapping send on each one.',
      tone: 'gold',
    };
  }
  if (reason === 'trial_expired') {
    return {
      badge: 'ℹ️ You\'re on MiniMe Free',
      title: 'Go Pro',
      sub: 'MiniMe is still writing every reply for you. Pro puts him back to sending them himself — nights, Sundays, while you serve walk-ins.',
      tone: 'gold',
    };
  }
  if (reason === 'credits_exhausted') {
    return {
      badge: '⚡ 0 AI credits remaining',
      title: 'You\'ve used all your credits',
      sub: 'Upgrade to Pro for unlimited replies — Pro is never metered.',
      tone: 'red',
    };
  }
  return {
    badge: '⭐ MiniMe Pro',
    title: 'Everything MiniMe can do',
    sub: 'One plan, everything unlocked. Cancel anytime.',
    tone: 'gold',
  };
}

export default function UpgradeModal({
  isOpen,
  onClose,
  currentPlanName = 'Free',
  remainingCredits = null,
  // 'feature_gate' | 'trial_ending' | 'trial_expired' | 'credits_exhausted' | null
  reason = null,
  feature = null,
  initData = null,
  businessId = null,
  onSuccess = () => {},
}) {
  const [selectedPlan, setSelectedPlan] = useState('pro');
  // null while loading — we render every option until we know, then narrow.
  const [rails, setRails] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    fetch('/api/payment/methods', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive || !d?.rails) return;
        setRails(d.rails);
        // Move off a method that isn't actually available.
        setSelectedMethod(cur => (d.rails[cur] ? cur : Object.keys(d.rails).find(k => d.rails[k]) || cur));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOpen]);
  const [selectedMethod, setSelectedMethod] = useState('stripe'); // 'stripe' | 'chapa' | 'telebirr' | 'cbe' | 'paypal'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualInstructions, setManualInstructions] = useState(null);

  if (!isOpen) return null;

  async function handleUpgrade() {
    setLoading(true);
    setError('');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['x-telegram-init-data'] = initData;
      if (businessId) headers['x-business-id'] = businessId;

      const res = await fetch('/api/payment/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          plan: selectedPlan,
          method: selectedMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Payment initialization failed');

      if (data.checkout_url) {
        const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
        if (twa?.openLink) twa.openLink(data.checkout_url);
        else window.open(data.checkout_url, '_blank');
        onSuccess(data);
      } else if (data.next_step === 'upload_proof' || data.instructions) {
        setManualInstructions(data);
      } else {
        onSuccess(data);
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Only sellable plans. The retired USD credit tiers stay out of this list —
  // offering "$8 / 200 AI chats" beside "Pro / 2,500 ETB" contradicted the
  // upgrade sheet the owner just came from.
  const plansList = PURCHASABLE_PLANS;
  const head = headlineFor(reason, feature);
  const accent = head.tone === 'red' ? '#F87171' : '#FBBF24';
  const accentBg = head.tone === 'red' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(251, 191, 36, 0.15)';
  const accentBd = head.tone === 'red' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(251, 191, 36, 0.3)';
  const showCredits = Number.isFinite(remainingCredits) && remainingCredits >= 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: 'rgba(5, 7, 15, 0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', overflowY: 'auto',
      fontFamily: "'Geist', 'Inter', -apple-system, sans-serif"
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #0F172A 0%, #090D16 100%)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '24px',
        padding: '32px',
        maxWidth: '560px',
        width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(99, 102, 241, 0.15)',
        color: '#F8FAFC',
        animation: 'modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {manualInstructions ? (
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>
              {selectedMethod === 'telebirr'
                ? '📱 Pay with Telebirr'
                : `🏦 Pay by transfer${manualInstructions.instructions?.bank ? ` — ${manualInstructions.instructions.bank}` : ''}`}
            </h2>
            <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '20px' }}>
              Send {manualInstructions.instructions?.amount} ETB to complete your upgrade.
            </p>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '16px', padding: '16px', marginBottom: '20px'
            }}>
              {manualInstructions.instructions?.bank && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>Bank</span>
                  <span style={{ fontWeight: 600 }}>{manualInstructions.instructions.bank}</span>
                </div>
              )}
              {manualInstructions.instructions?.name && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>Account name</span>
                  <span style={{ fontWeight: 600 }}>{manualInstructions.instructions.name}</span>
                </div>
              )}
              {manualInstructions.instructions?.account && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>Account</span>
                  <span style={{ fontWeight: 600, color: '#38BDF8', fontFamily: 'monospace' }}>{manualInstructions.instructions.account}</span>
                </div>
              )}
              {manualInstructions.instructions?.phone && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>Phone</span>
                  <span style={{ fontWeight: 600, color: '#38BDF8', fontFamily: 'monospace' }}>{manualInstructions.instructions.phone}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Reference</span>
                <span style={{ fontWeight: 600, color: '#F59E0B', fontFamily: 'monospace' }}>{manualInstructions.instructions?.reference}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: '#94A3B8', fontSize: '13px' }}>Amount</span>
                <span style={{ fontWeight: 700, color: '#10B981' }}>{manualInstructions.instructions?.amount} ETB</span>
              </div>
            </div>

            <button
              onClick={() => { setManualInstructions(null); onClose(); }}
              style={{
                width: '100%', padding: '14px', borderRadius: '999px', border: 'none',
                background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                color: '#FFF', fontWeight: 600, cursor: 'pointer'
              }}
            >
              Done / Close
            </button>
          </div>
        ) : (
          <>
            {/* Header / Title */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: '999px',
                background: accentBg, border: `1px solid ${accentBd}`,
                color: accent, fontSize: '12px', fontWeight: 600, marginBottom: '12px'
              }}>
                {head.badge}
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px 0' }}>
                {head.title}
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>
                {head.sub}
              </p>
            </div>

            {/* Reassurance: Free never goes dark. */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.22)',
              borderRadius: '14px', padding: '11px 14px', marginBottom: '18px',
              fontSize: '12.5px', color: '#6EE7B7', lineHeight: 1.45, textAlign: 'center'
            }}>
              ✓ MiniMe writes every reply on Free too — upgrading is about who presses send.
            </div>

            {/* Current Plan Card */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '16px', padding: '16px 20px', marginBottom: '20px'
            }}>
              <div>
                <span style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Plan</span>
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#F1F5F9', marginTop: '2px' }}>{currentPlanName}</div>
              </div>
              {showCredits && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remaining</span>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: remainingCredits > 0 ? '#F1F5F9' : '#EF4444', marginTop: '2px' }}>
                    {remainingCredits} chats
                  </div>
                </div>
              )}
            </div>

            {/* Subscription Plan Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94A3B8', marginBottom: '10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {plansList.length > 1 ? 'Select Plan' : 'Your Plan'}
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: plansList.length > 1 ? 'repeat(2, 1fr)' : '1fr', gap: '10px' }}>
                {plansList.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    style={{
                      padding: '16px', borderRadius: '16px', cursor: 'pointer', textAlign: 'left',
                      background: selectedPlan === p.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: `2px solid ${selectedPlan === p.id ? '#6366F1' : 'rgba(255, 255, 255, 0.06)'}`,
                      color: '#F8FAFC', transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>MiniMe {p.name}</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#38BDF8', margin: '4px 0' }}>
                      {p.priceMonthlyEtb.toLocaleString()} ETB<span style={{ fontSize: '13px', fontWeight: 600, color: '#94A3B8' }}>/month</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                      {p.features.map((feat, i) => (
                        <div key={i} style={{ fontSize: '12px', color: '#94A3B8', display: 'flex', gap: '6px', lineHeight: 1.35 }}>
                          <span style={{ color: '#10B981', flexShrink: 0 }}>✓</span>
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Method Selector */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94A3B8', marginBottom: '10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Payment Method
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {[
                  { id: 'telebirr', label: '📱 Telebirr', desc: 'Send & upload proof' },
                  { id: 'bank', label: '🏦 Bank transfer', desc: 'Send & upload proof' },
                  { id: 'chapa', label: '⚡ Chapa', desc: 'Telebirr / Cards' },
                  { id: 'stripe', label: '💳 Card', desc: 'Stripe checkout' },
                  { id: 'paypal', label: '🅿️ PayPal', desc: 'PayPal checkout' },
                // Only offer rails the server can actually take money through.
                // Rendering an unconfigured method sent owners down a dead end.
                ].filter(m => rails === null || rails[m.id]).map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMethod(m.id)}
                    style={{
                      padding: '10px 8px', borderRadius: '12px', cursor: 'pointer', textAlign: 'center',
                      background: selectedMethod === m.id ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1.5px solid ${selectedMethod === m.id ? '#38BDF8' : 'rgba(255, 255, 255, 0.06)'}`,
                      color: '#F8FAFC', transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '12px', padding: '10px 14px', fontSize: '13px', color: '#F87171', marginBottom: '16px'
              }}>
                {error}
              </div>
            )}

            {/* Proof, immediately above the pay button. Renders nothing when
                we don't have numbers we can stand behind. */}
            <SocialProof tone="dark" style={{ marginBottom: '16px' }} />

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={onClose}
                disabled={loading}
                style={{
                  flex: 1, padding: '14px', borderRadius: '999px', cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94A3B8', fontWeight: 600, fontSize: '14px'
                }}
              >
                Maybe Later
              </button>
              <button
                onClick={handleUpgrade}
                disabled={loading}
                style={{
                  flex: 1.5, padding: '14px', borderRadius: '999px', cursor: loading ? 'default' : 'pointer',
                  background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)', border: 'none',
                  color: '#FFF', fontWeight: 700, fontSize: '14px',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)', opacity: loading ? 0.6 : 1
                }}
              >
                {loading
                  ? 'Processing...'
                  : `Unlock Pro — ${(SUBSCRIPTION_PLANS[selectedPlan]?.priceMonthlyEtb ?? 0).toLocaleString()} ETB`}
              </button>
            </div>

            {/* Risk reversal at the point of payment. */}
            <div style={{ marginTop: '12px', fontSize: '11.5px', color: '#64748B', textAlign: 'center', lineHeight: 1.5 }}>
              Cancel anytime · Your products and chats stay yours if you leave
            </div>
          </>
        )}
      </div>
    </div>
  );
}
