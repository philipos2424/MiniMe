'use client';

import { useState, useEffect } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import UpgradeModal from '../../../../components/billing/UpgradeModal';
import CreditIndicator from '../../../../components/chat/CreditIndicator';
import { SUBSCRIPTION_PLANS } from '../../../../lib/server/billing';

export default function BillingPage() {
  const { business, initData } = useTelegram();
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const fetchSubscription = async () => {
    try {
      const headers = {};
      if (initData) headers['x-telegram-init-data'] = initData;
      if (business?.id) headers['x-business-id'] = business.id;

      const res = await fetch('/api/billing/subscription', { headers, cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setSubscriptionData(data);
      }
    } catch (e) {
      console.warn('[billing-page] fetch error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, [initData, business?.id]);

  const sub = subscriptionData?.subscription || {
    plan_name: business?.plan_tier || 'free',
    credits_remaining: 15,
    credits_total: 15,
    credits_used: 0,
    status: 'active'
  };

  const currentPlan = SUBSCRIPTION_PLANS[sub.plan_name] || SUBSCRIPTION_PLANS.free;
  const isUnlimited = sub.credits_remaining === -1;
  const remaining = isUnlimited ? 'Unlimited' : (sub.credits_remaining ?? 15);
  const total = isUnlimited ? 'Unlimited' : (sub.credits_total ?? 15);
  const used = sub.credits_used ?? 0;

  const percentUsed = isUnlimited
    ? 0
    : Math.min(100, Math.round((used / (sub.credits_total || 15)) * 100));

  const plansList = Object.values(SUBSCRIPTION_PLANS);

  return (
    <div style={{
      maxWidth: '800px', margin: '0 auto', padding: '20px 16px 100px',
      fontFamily: "'Geist', 'Inter', -apple-system, sans-serif",
      color: '#F8FAFC', background: '#090D16', minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '24px', flexWrap: 'wrap', gap: '12px'
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, color: '#F8FAFC' }}>
            Billing & Usage
          </h1>
          <p style={{ color: '#94A3B8', fontSize: '13px', marginTop: '4px', margin: 0 }}>
            Manage your AI chat credits and subscription plans.
          </p>
        </div>

        <button
          onClick={() => setIsUpgradeModalOpen(true)}
          style={{
            padding: '10px 20px', borderRadius: '999px', border: 'none',
            background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
            color: '#FFF', fontSize: '13px', fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 4px 16px rgba(99, 102, 241, 0.35)',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            transition: 'transform 0.15s ease'
          }}
        >
          <span>⚡</span>
          <span>Upgrade Plan</span>
        </button>
      </div>

      {/* Hero Overview Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '16px', marginBottom: '24px'
      }}>
        {/* Current Plan Card */}
        <div style={{
          background: 'linear-gradient(145deg, #131B2E 0%, #0F172A 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px', padding: '20px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                CURRENT PLAN
              </span>
              <h3 style={{ fontSize: '22px', fontWeight: 800, color: '#F8FAFC', margin: '2px 0 0 0' }}>
                {currentPlan.name}
              </h3>
            </div>
            <span style={{
              padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
              background: sub.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: sub.status === 'active' ? '#10B981' : '#F87171',
              border: `1px solid ${sub.status === 'active' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}>
              {sub.status.toUpperCase()}
            </span>
          </div>

          <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '14px' }}>
            {currentPlan.priceMonthlyUsd !== null ? (currentPlan.priceMonthlyUsd === 0 ? 'Free tier (15 chats)' : `$${currentPlan.priceMonthlyUsd} / month`) : 'Custom Plan'}
          </div>

          <CreditIndicator
            remainingCredits={sub.credits_remaining}
            totalCredits={sub.credits_total}
            isUnlimited={isUnlimited}
            onOpenUpgrade={() => setIsUpgradeModalOpen(true)}
          />
        </div>

        {/* Credits Remaining Progress Card */}
        <div style={{
          background: 'linear-gradient(145deg, #131B2E 0%, #0F172A 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px', padding: '20px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            CREDITS REMAINING
          </span>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '6px 0 14px 0' }}>
            <span style={{ fontSize: '30px', fontWeight: 800, color: sub.credits_remaining <= 3 && !isUnlimited ? '#F59E0B' : '#38BDF8' }}>
              {remaining}
            </span>
            <span style={{ fontSize: '14px', color: '#64748B', fontWeight: 600 }}>
              / {total} chats
            </span>
          </div>

          {/* Progress Bar (██████░░░░) */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{
              height: '8px', width: '100%', borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden'
            }}>
              <div style={{
                height: '100%', width: isUnlimited ? '100%' : `${100 - percentUsed}%`,
                background: isUnlimited
                  ? 'linear-gradient(90deg, #10B981, #34D399)'
                  : sub.credits_remaining <= 3
                  ? 'linear-gradient(90deg, #EF4444, #F59E0B)'
                  : 'linear-gradient(90deg, #6366F1, #38BDF8)',
                borderRadius: '999px', transition: 'width 0.4s ease'
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B' }}>
            <span>{used} used</span>
            <span>{isUnlimited ? '∞ remaining' : `${remaining} remaining`}</span>
          </div>
        </div>
      </div>

      {/* Usage This Month Stats */}
      <div style={{
        background: 'linear-gradient(145deg, #131B2E 0%, #0F172A 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '20px', padding: '20px', marginBottom: '28px'
      }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px', color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📊</span>
          <span>Usage This Month</span>
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>AI Chat Requests</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#38BDF8', marginTop: '4px' }}>
              {subscriptionData?.usageThisMonth?.requests ?? 0}
            </div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Tokens Processed</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#818CF8', marginTop: '4px' }}>
              {(subscriptionData?.usageThisMonth?.tokens ?? 0).toLocaleString()}
            </div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
            <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Est. Cost</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#10B981', marginTop: '4px' }}>
              ${(subscriptionData?.usageThisMonth?.costEstimateUsd ?? 0).toFixed(4)}
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Plans Cards (Free, Business, Professional) */}
      <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px', color: '#F8FAFC', letterSpacing: '-0.01em' }}>
        Subscription Plans
      </h2>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px', marginBottom: '32px'
      }}>
        {plansList.map((plan) => {
          const isSelected = sub.plan_name === plan.id;
          return (
            <div
              key={plan.id}
              style={{
                background: isSelected
                  ? 'linear-gradient(145deg, rgba(99, 102, 241, 0.2) 0%, #0F172A 100%)'
                  : 'linear-gradient(145deg, #131B2E 0%, #0F172A 100%)',
                border: `2px solid ${isSelected ? '#6366F1' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: '20px', padding: '20px',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                boxShadow: isSelected ? '0 10px 30px rgba(99, 102, 241, 0.2)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#F8FAFC' }}>{plan.name}</h3>
                  {isSelected && (
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', background: '#6366F1', color: '#FFF' }}>
                      Active
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '24px', fontWeight: 800, color: '#38BDF8', margin: '10px 0 2px 0' }}>
                  {plan.priceMonthlyUsd === 0 ? '$0' : `$${plan.priceMonthlyUsd}/mo`}
                </div>

                <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 600, marginBottom: '14px' }}>
                  {`${plan.chats} AI Chats`}
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {plan.features.map((feat, idx) => (
                    <li key={idx} style={{ fontSize: '12px', color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#10B981', fontWeight: 700 }}>✓</span> {feat}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => setIsUpgradeModalOpen(true)}
                style={{
                  width: '100%', padding: '11px', borderRadius: '12px', border: 'none',
                  background: isSelected ? 'rgba(255, 255, 255, 0.08)' : 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: '#FFF', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  boxShadow: isSelected ? 'none' : '0 4px 12px rgba(99, 102, 241, 0.3)',
                  transition: 'opacity 0.15s ease'
                }}
              >
                {isSelected ? 'Current Plan' : 'Select Plan'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Recent Payments Section */}
      {subscriptionData?.recentPayments?.length > 0 && (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '14px', color: '#F8FAFC' }}>
            Recent Payments
          </h2>
          <div style={{
            background: 'linear-gradient(145deg, #131B2E 0%, #0F172A 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px', overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#64748B' }}>
                  <th style={{ padding: '12px 14px' }}>Reference</th>
                  <th style={{ padding: '12px 14px' }}>Method</th>
                  <th style={{ padding: '12px 14px' }}>Amount</th>
                  <th style={{ padding: '12px 14px' }}>Status</th>
                  <th style={{ padding: '12px 14px' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {subscriptionData.recentPayments.map((pmt) => (
                  <tr key={pmt.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', color: '#CBD5E1' }}>
                    <td style={{ padding: '12px 14px', fontFamily: 'monospace' }}>{pmt.reference || pmt.id.slice(0, 8)}</td>
                    <td style={{ padding: '12px 14px', textTransform: 'capitalize' }}>{pmt.method}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: '#10B981' }}>${pmt.amount}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981' }}>
                        {pmt.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', color: '#64748B' }}>
                      {new Date(pmt.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Embedded Upgrade Modal */}
      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        currentPlanName={currentPlan.name}
        remainingCredits={sub.credits_remaining}
        initData={initData}
        businessId={business?.id}
        onSuccess={() => {
          fetchSubscription();
          setIsUpgradeModalOpen(false);
        }}
      />
    </div>
  );
}
