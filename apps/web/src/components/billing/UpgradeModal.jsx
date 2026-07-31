'use client';

import React, { useState } from 'react';
import { SUBSCRIPTION_PLANS } from '../../lib/server/billing';

export default function UpgradeModal({
  isOpen,
  onClose,
  currentPlanName = 'Free',
  remainingCredits = 0,
  initData = null,
  businessId = null,
  onSuccess = () => {},
}) {
  const [selectedPlan, setSelectedPlan] = useState('business');
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

  const plansList = Object.values(SUBSCRIPTION_PLANS);

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
              {selectedMethod === 'telebirr' ? '📱 Pay with Telebirr' : '🏦 Pay with CBE Birr'}
            </h2>
            <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '20px' }}>
              Send {manualInstructions.instructions?.amount} ETB to complete your upgrade.
            </p>

            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '16px', padding: '16px', marginBottom: '20px'
            }}>
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
                background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#F87171', fontSize: '12px', fontWeight: 600, marginBottom: '12px'
              }}>
                ⚡ 0 AI Credits Remaining
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px 0' }}>
                You've used all your free AI credits.
              </h2>
              <p style={{ color: '#94A3B8', fontSize: '14px', margin: 0 }}>
                Upgrade your plan to continue using MiniMe AI.
              </p>
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
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remaining</span>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#EF4444', marginTop: '2px' }}>{remainingCredits} chats</div>
              </div>
            </div>

            {/* Subscription Plan Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94A3B8', marginBottom: '10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Select Plan
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                {plansList.filter(p => p.id !== 'free').map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlan(p.id)}
                    style={{
                      padding: '14px', borderRadius: '16px', cursor: 'pointer', textAlign: 'left',
                      background: selectedPlan === p.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: `2px solid ${selectedPlan === p.id ? '#6366F1' : 'rgba(255, 255, 255, 0.06)'}`,
                      color: '#F8FAFC', transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#38BDF8', margin: '4px 0' }}>
                      {p.priceMonthlyUsd ? `$${p.priceMonthlyUsd}/mo` : 'Custom'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                      {p.chats === -1 ? 'Unlimited chats' : `${p.chats} AI chats`}
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
                  { id: 'stripe', label: '💳 Stripe', desc: 'Card / Global' },
                  { id: 'chapa', label: '⚡ Chapa', desc: 'Telebirr / Cards' },
                  { id: 'telebirr', label: '📱 Telebirr', desc: 'Direct / Manual' },
                  { id: 'cbe', label: '🏦 CBE Birr', desc: 'Bank Transfer' },
                  { id: 'paypal', label: '🅿️ PayPal', desc: 'PayPal Checkout' },
                ].map(m => (
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
                {loading ? 'Processing...' : 'Upgrade Plan'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
