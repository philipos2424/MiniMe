'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const STATUS_COLOR = {
  trial:     COLORS.amber,
  active:    COLORS.green,
  expired:   COLORS.red,
  cancelled: COLORS.textHint,
};

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

  const trialDaysLeft = business?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(business.trial_ends_at) - Date.now()) / 86400000))
    : 0;

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 20px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Billing</h1>

      {business && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: SHADOW.card }}>
          {/* Plan row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                MiniMe {business.subscription_plan === 'pro' ? 'Pro' : 'Free'}
              </p>
              <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>2,500 ETB / month</p>
            </div>
            {(() => {
              const c = STATUS_COLOR[business.subscription_status] || COLORS.textHint;
              return (
                <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: c + '22', color: c, textTransform: 'capitalize' }}>
                  {business.subscription_status}
                </span>
              );
            })()}
          </div>

          {/* Trial notice */}
          {business.subscription_status === 'trial' && (
            <div style={{ background: COLORS.amberLight, border: `1px solid ${COLORS.amber}40`, borderRadius: RADII.md, padding: '10px 14px' }}>
              <p style={{ fontSize: 13, color: '#92400E', margin: 0 }}>
                ⏳ Trial ends in <strong>{trialDaysLeft} days</strong>
              </p>
            </div>
          )}

          {/* Next billing */}
          {business.subscription_expires_at && (
            <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>
              Next billing: {new Date(business.subscription_expires_at).toLocaleDateString()}
            </p>
          )}

          {/* CTA */}
          <button style={{ width: '100%', background: COLORS.teal, color: '#FFF', fontWeight: 600, padding: '12px 0', minHeight: 44, borderRadius: RADII.md, border: 'none', fontSize: 14, cursor: 'pointer', fontFamily: FONT.body }}>
            {business.subscription_status === 'active' ? 'Manage Subscription' : 'Upgrade to Pro — 2,500 ETB/mo'}
          </button>

          <p style={{ fontSize: 11, color: COLORS.textHint, textAlign: 'center', margin: 0 }}>
            Paid via Chapa (Telebirr, CBE Birr, bank transfer)
          </p>
        </div>
      )}
    </div>
  );
}
