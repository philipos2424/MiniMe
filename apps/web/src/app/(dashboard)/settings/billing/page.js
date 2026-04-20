'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';

export default function BillingPage() {
  const supabase = useSupabase();
  const [business, setBusiness] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('businesses').select('*').limit(1).single();
      setBusiness(data);
    }
    load();
  }, []);

  const statusColor = { trial: '#D97706', active: '#059669', expired: '#ef4444', cancelled: '#6B7280' };
  const trialDaysLeft = business?.trial_ends_at ? Math.max(0, Math.ceil((new Date(business.trial_ends_at) - Date.now()) / 86400000)) : 0;

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="font-display text-2xl text-gold-light">Billing</h1>
      {business && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gold-light font-semibold">MiniMe {business.subscription_plan === 'pro' ? 'Pro' : 'Free'}</p>
              <p className="text-muted text-sm">2,500 ETB / month</p>
            </div>
            <span className="px-3 py-1 rounded-full text-sm capitalize" style={{ background: (statusColor[business.subscription_status] || '#6B7280') + '33', color: statusColor[business.subscription_status] || '#6B7280' }}>
              {business.subscription_status}
            </span>
          </div>
          {business.subscription_status === 'trial' && (
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3">
              <p className="text-yellow-400 text-sm">⏳ Trial ends in <strong>{trialDaysLeft} days</strong></p>
            </div>
          )}
          {business.subscription_expires_at && (
            <p className="text-muted text-sm">Next billing: {new Date(business.subscription_expires_at).toLocaleDateString()}</p>
          )}
          <button className="w-full bg-gold text-bg font-semibold py-3 rounded-lg hover:bg-gold-light transition">
            {business.subscription_status === 'active' ? 'Manage Subscription' : 'Upgrade to Pro — 2,500 ETB/mo'}
          </button>
          <p className="text-muted text-xs text-center">Paid via Chapa (Telebirr, CBE Birr, bank transfer)</p>
        </div>
      )}
    </div>
  );
}
