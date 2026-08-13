'use client';

import { useState, useEffect } from 'react';

export default function AdminBillingPage() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedBiz, setSelectedBiz] = useState(null);
  const [extraCredits, setExtraCredits] = useState(10);
  const [actionStatus, setActionStatus] = useState('');

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/billing');
      const data = await res.json();
      if (data.ok) {
        setAnalytics(data.analytics);
      } else {
        setError(data.error || 'Failed to load admin analytics');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleAdminAction = async (businessId, action, extraOpts = {}) => {
    setActionStatus('Processing...');
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          action,
          ...extraOpts,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setActionStatus(`Success: ${action} applied!`);
        fetchAnalytics();
      } else {
        setActionStatus(`Error: ${data.error}`);
      }
    } catch (e) {
      setActionStatus(`Error: ${e.message}`);
    }
  };

  if (loading) {
    return <div style={{ color: '#FFF', padding: '40px', textAlign: 'center' }}>Loading Admin Billing...</div>;
  }

  return (
    <div style={{
      padding: '32px 24px', maxWidth: '1200px', margin: '0 auto',
      fontFamily: "'Geist', 'Inter', sans-serif", color: '#F8FAFC'
    }}>
      <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '8px' }}>
        ⚡ Admin Billing & Credit Management
      </h1>
      <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '32px' }}>
        Overview of platform Claude usage, subscription revenue, and business credit controls.
      </p>

      {/* Analytics KPI Overview */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px', marginBottom: '40px'
      }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase' }}>Total Revenue</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#10B981', marginTop: '4px' }}>
            ${(analytics?.totalRevenue || 0).toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase' }}>Total Claude AI Calls</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#38BDF8', marginTop: '4px' }}>
            {(analytics?.totalClaudeUsage || 0).toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase' }}>Total Tokens Processed</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#818CF8', marginTop: '4px' }}>
            {(analytics?.totalTokens || 0).toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: '#64748B', textTransform: 'uppercase' }}>Est. Claude Cost</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#F59E0B', marginTop: '4px' }}>
            ${(analytics?.totalClaudeCost || 0).toFixed(2)}
          </div>
        </div>
      </div>

      {actionStatus && (
        <div style={{
          background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)',
          color: '#38BDF8', borderRadius: '12px', padding: '12px 16px', fontSize: '14px', marginBottom: '24px'
        }}>
          {actionStatus}
        </div>
      )}

      {/* Subscription & Credit Management Table */}
      <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
        Business Subscriptions & Credit Control
      </h2>

      <div style={{
        background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '20px', overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#64748B' }}>
              <th style={{ padding: '16px' }}>Business</th>
              <th style={{ padding: '16px' }}>Plan</th>
              <th style={{ padding: '16px' }}>Remaining Credits</th>
              <th style={{ padding: '16px' }}>Used</th>
              <th style={{ padding: '16px' }}>Status</th>
              <th style={{ padding: '16px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(analytics?.subscriptions || []).map((sub) => (
              <tr key={sub.subscription_id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', color: '#CBD5E1' }}>
                <td style={{ padding: '16px', fontWeight: 600, color: '#F8FAFC' }}>
                  {sub.businesses?.name || sub.user_id.slice(0, 8)}
                </td>
                <td style={{ padding: '16px', textTransform: 'capitalize' }}>{sub.plan_name}</td>
                <td style={{ padding: '16px', fontWeight: 700, color: sub.credits_remaining <= 0 ? '#F87171' : '#38BDF8' }}>
                  {sub.credits_remaining === -1 ? 'Unlimited' : sub.credits_remaining}
                </td>
                <td style={{ padding: '16px' }}>{sub.credits_used}</td>
                <td style={{ padding: '16px' }}>
                  <span style={{
                    padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
                    background: sub.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: sub.status === 'active' ? '#10B981' : '#F87171'
                  }}>
                    {sub.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '16px', display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleAdminAction(sub.user_id, 'add_credits', { extraCredits: 10 })}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', border: 'none',
                      background: 'rgba(56, 189, 248, 0.2)', color: '#38BDF8', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    +10 Credits
                  </button>

                  <button
                    onClick={() => handleAdminAction(sub.user_id, 'reset_credits')}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', border: 'none',
                      background: 'rgba(245, 158, 11, 0.2)', color: '#F59E0B', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Reset
                  </button>

                  <button
                    onClick={() => handleAdminAction(sub.user_id, 'suspend', { suspend: sub.status !== 'suspended' })}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', border: 'none',
                      background: sub.status === 'suspended' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: sub.status === 'suspended' ? '#10B981' : '#F87171', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {sub.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
