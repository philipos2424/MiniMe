'use client';
/**
 * MiniMe Search — analytics for this business.
 * Shows: appearances in search, clicks to bot, referral conversions.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

function StatCard({ value, label, hint, accent }) {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card,
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || COLORS.textPrimary, letterSpacing: '-0.03em', fontFamily: FONT.serif }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

export default function SearchSettingsPage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();

  const [referrals, setReferrals] = useState(null);
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!business) return;
    setVisible(business.b2b_discoverable !== false);
    // Load referral count for this week
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    supabase
      .from('search_referrals')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', business.id)
      .gte('created_at', since)
      .then(({ count }) => setReferrals(count || 0))
      .catch(() => setReferrals(0));
  }, [business?.id]); // eslint-disable-line

  async function toggleVisibility(v) {
    if (!business?.id) return;
    setVisible(v);
    setSaving(true);
    await supabase.from('businesses').update({ b2b_discoverable: v }).eq('id', business.id);
    setBusiness(b => ({ ...b, b2b_discoverable: v }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  }

  const searchCount = business?.search_count || 0;
  const clickCount  = business?.click_count  || 0;
  const ctr = searchCount > 0 ? Math.round((clickCount / searchCount) * 100) : 0;

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          MiniMe Search
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          Customers find your business through @MiniMeSearchBot — here's how you're performing.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard
          value={searchCount.toLocaleString()}
          label="Search appearances"
          hint="Times your business appeared in search results"
          accent={COLORS.teal}
        />
        <StatCard
          value={clickCount.toLocaleString()}
          label="Bot clicks"
          hint="Customers who tapped to chat with you from search"
          accent={COLORS.amber}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard
          value={ctr > 0 ? `${ctr}%` : '—'}
          label="Click-through rate"
          hint="% of search appearances that led to a chat"
        />
        <StatCard
          value={referrals === null ? '…' : referrals}
          label="Referrals this week"
          hint="Customers who arrived from search in the last 7 days"
          accent={COLORS.green}
        />
      </div>

      {/* How it works */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>How MiniMe Search Works</div>
        <div style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>Anyone on Telegram can open <strong>@MiniMeSearchBot</strong> and type what they need — like "laptop repair in Bole" or "wedding catering."</p>
          <p style={{ margin: '0 0 8px' }}>The search bot finds matching businesses and shows a link directly to your bot. Customers tap once to start chatting.</p>
          <p style={{ margin: 0 }}>When they arrive via search, your bot greets them with <em>"You found us through MiniMe Search"</em> so you know where they came from.</p>
        </div>
      </div>

      {/* Visibility toggle */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Directory Visibility</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            role="switch"
            aria-checked={visible}
            onClick={() => toggleVisibility(!visible)}
            disabled={saving}
            style={{
              flexShrink: 0, marginTop: 2,
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: saving ? 'default' : 'pointer',
              background: visible ? COLORS.green : COLORS.border,
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: visible ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
            }} />
          </button>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: COLORS.textPrimary }}>
              {visible ? 'Listed in MiniMe Search' : 'Hidden from search'}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2, lineHeight: 1.4 }}>
              {visible
                ? 'Customers can find you via @MiniMeSearchBot'
                : 'Your business is not showing in search results'}
            </div>
          </div>
        </div>
        {saved && (
          <div style={{ fontSize: 13, color: COLORS.green, marginTop: 10, fontWeight: 500 }}>
            ✓ Saved
          </div>
        )}
      </div>

      {/* Tip */}
      <div style={{
        background: COLORS.tealLight, border: `1px solid rgba(79,163,138,0.2)`,
        borderRadius: RADII.lg, padding: '14px 16px',
        fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
      }}>
        💡 <strong>Tip:</strong> Fill in your <strong>business description</strong> and <strong>tags</strong> in{' '}
        <a href="/settings/profile" style={{ color: COLORS.teal, textDecoration: 'none', fontWeight: 600 }}>
          Business Profile
        </a>{' '}
        — the more detail you provide, the more search queries will match you.
      </div>
    </div>
  );
}
