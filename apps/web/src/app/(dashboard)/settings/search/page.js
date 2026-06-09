'use client';
/**
 * MiniMe Search — analytics for this business.
 * Shows: appearances in search, clicks to bot, referral conversions,
 * top queries, conversion funnel, weekly trend.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

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

function FunnelBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: COLORS.textSecondary, fontWeight: 500 }}>{label}</span>
        <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{value.toLocaleString()} {max > 0 && value < max ? `(${pct}%)` : ''}</span>
      </div>
      <div style={{ height: 8, background: COLORS.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(pct, 2)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

export default function SearchSettingsPage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();

  const [referrals, setReferrals] = useState(null);
  const [conversations, setConversations] = useState(null);
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [topQueries, setTopQueries] = useState(null);
  const [weeklyTrend, setWeeklyTrend] = useState(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexDone, setReindexDone] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [waitlistDemand, setWaitlistDemand] = useState(null);
  const [publicInfo, setPublicInfo] = useState(null);
  const [savingPublicInfo, setSavingPublicInfo] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [tagline, setTagline] = useState('');
  const [savingTagline, setSavingTagline] = useState(false);
  const [taglineSaved, setTaglineSaved] = useState(false);
  const [reviews, setReviews] = useState(null);
  const [avgRating, setAvgRating] = useState(null);
  const [totalReviews, setTotalReviews] = useState(null);

  useEffect(() => {
    if (!business) return;
    setVisible(business.b2b_discoverable !== false);

    // Load logo + public info + tagline + fresh rating data
    supabase
      .from('businesses')
      .select('logo_url, search_public_info, tagline, average_rating, total_reviews')
      .eq('id', business.id)
      .single()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url);
        if (data?.tagline) setTagline(data.tagline);
        setAvgRating(data?.average_rating ?? null);
        setTotalReviews(data?.total_reviews ?? 0);
        setPublicInfo(data?.search_public_info || {
          products: true, prices: true, faqs: true,
          address: true, hours: true, phone: false, ai_answers: true,
        });
      })
      .catch(() => {});

    // Load reviews for this business
    supabase
      .from('reviews')
      .select('id, rating, comment, created_at, visible')
      .eq('business_id', business.id)
      .eq('visible', true)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setReviews(data || []))
      .catch(() => setReviews([]));

    const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString();

    // Referrals this week (clicks that landed)
    supabase
      .from('search_referrals')
      .select('id, first_message_at', { count: 'exact', head: false })
      .eq('business_id', business.id)
      .gte('created_at', since7)
      .then(({ data, count }) => {
        setReferrals(count || 0);
        // Conversations = referrals that sent a first message
        const convos = (data || []).filter(r => r.first_message_at).length;
        setConversations(convos);
      })
      .catch(() => { setReferrals(0); setConversations(0); });

    // Top queries that surfaced this business (last 30 days)
    supabase
      .from('search_logs')
      .select('raw_query')
      .contains('results_profile_ids', [business.id])
      .gte('created_at', since30)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        const freq = {};
        (data || []).forEach(r => {
          const q = (r.raw_query || '').toLowerCase().trim();
          if (q) freq[q] = (freq[q] || 0) + 1;
        });
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8);
        setTopQueries(sorted);
      })
      .catch(() => setTopQueries([]));

    // Waitlist demand — how many people are waiting for a business in this category
    if (business.category) {
      supabase
        .from('search_waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('parsed_category', business.category)
        .is('notified_at', null)
        .then(({ count }) => setWaitlistDemand(count || 0))
        .catch(() => setWaitlistDemand(0));
    }

    // Weekly trend: compare last 7 days vs previous 7 days
    supabase
      .from('search_logs')
      .select('created_at', { count: 'exact', head: true })
      .contains('results_profile_ids', [business.id])
      .gte('created_at', since7)
      .then(({ count: thisWeek }) => {
        supabase
          .from('search_logs')
          .select('created_at', { count: 'exact', head: true })
          .contains('results_profile_ids', [business.id])
          .gte('created_at', since14)
          .lt('created_at', since7)
          .then(({ count: lastWeek }) => {
            const tw = thisWeek || 0;
            const lw = lastWeek || 0;
            if (lw > 0) {
              const change = Math.round(((tw - lw) / lw) * 100);
              setWeeklyTrend({ thisWeek: tw, lastWeek: lw, change });
            } else if (tw > 0) {
              setWeeklyTrend({ thisWeek: tw, lastWeek: 0, change: 100 });
            } else {
              setWeeklyTrend({ thisWeek: 0, lastWeek: 0, change: 0 });
            }
          })
          .catch(() => setWeeklyTrend(null));
      })
      .catch(() => setWeeklyTrend(null));
  }, [business?.id]); // eslint-disable-line

  async function uploadLogo(file) {
    if (!file || uploadingLogo) return;
    setUploadingLogo(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch('/api/settings/upload-logo', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      const json = await res.json();
      if (json.logo_url) setLogoUrl(json.logo_url);
    } catch {}
    setUploadingLogo(false);
  }

  async function saveTagline() {
    if (!business?.id || savingTagline) return;
    setSavingTagline(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ tagline: tagline.slice(0, 50) }),
      });
      setTaglineSaved(true);
      setTimeout(() => setTaglineSaved(false), 3000);
    } catch {}
    setSavingTagline(false);
  }

  async function togglePublicInfo(key, value) {
    if (!business?.id) return;
    const next = { ...publicInfo, [key]: value };
    setPublicInfo(next);
    setSavingPublicInfo(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      await fetch('/api/settings/search/public-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {}
    setSavingPublicInfo(false);
  }

  async function triggerReindex() {
    if (!business?.id || reindexing) return;
    setReindexing(true);
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const res = await fetch('/api/settings/search/reindex', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      const json = await res.json();
      if (json.readiness) setReadiness(json.readiness);
      setReindexDone(true);
      setTimeout(() => setReindexDone(false), 4000);
    } catch {}
    setReindexing(false);
  }

  async function toggleVisibility(v) {
    if (!business?.id) return;
    setVisible(v);
    setSaving(true);
    const { error } = await supabase.from('businesses').update({ b2b_discoverable: v }).eq('id', business.id);
    if (error) { setVisible(!v); setSaving(false); tgAlert('Could not save — check your connection and try again.'); return; }
    setBusiness(b => ({ ...b, b2b_discoverable: v }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  }

  const searchCount = business?.search_count || 0;
  const clickCount  = business?.click_count  || 0;
  const ctr = searchCount > 0 ? Math.round((clickCount / searchCount) * 100) : 0;

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          MiniMe Search
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          Customers find your business through @MiniMeSearchBot — here's how you're performing.
        </p>
        {weeklyTrend && weeklyTrend.thisWeek > 0 && (
          <div style={{ fontSize: 13, color: weeklyTrend.change >= 0 ? COLORS.green : COLORS.amber, fontWeight: 600, marginTop: 6 }}>
            {weeklyTrend.change >= 0 ? '↑' : '↓'} {Math.abs(weeklyTrend.change)}% vs last week ({weeklyTrend.thisWeek} searches this week)
          </div>
        )}
      </div>

      {/* Search Readiness */}
      {(() => {
        const hasUsername    = !!business?.telegram_bot_username;
        const hasShopCode    = !!business?.shop_code && !!business?.onboarding_completed;
        const hasBot         = hasUsername || hasShopCode; // custom bot OR shared mode
        const hasDescription = !!business?.description;
        const isVisible      = business?.b2b_discoverable !== false;
        const score          = [hasBot, hasDescription, isVisible].filter(Boolean).length;
        const scoreColor     = score === 3 ? COLORS.green : score >= 2 ? COLORS.amber : COLORS.red;
        const webUrl         = 'https://web-theta-one-68.vercel.app';
        const listingUrl     = hasUsername ? `${webUrl}/directory/${business.telegram_bot_username}` : null;

        return (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Search Readiness</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor }}>{score}/3 ready</div>
            </div>

            {[
              { ok: isVisible,      label: 'Visible in search',      fix: 'Toggle on below' },
              { ok: hasBot,         label: hasShopCode && !hasUsername ? 'Using MiniMe directly ✓' : 'Bot connected', fix: 'Settings → Bot' },
              { ok: hasDescription, label: 'Description filled in',  fix: 'Settings → Profile' },
            ].map(({ ok, label, fix }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                <span style={{ fontSize: 14, color: ok ? COLORS.green : COLORS.red }}>{ok ? '✓' : '✗'}</span>
                <span style={{ fontSize: 13, color: ok ? COLORS.textPrimary : COLORS.textHint, flex: 1 }}>{label}</span>
                {!ok && <span style={{ fontSize: 11, color: COLORS.textHint }}>{fix}</span>}
              </div>
            ))}

            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={triggerReindex}
                disabled={reindexing}
                style={{
                  padding: '8px 16px', borderRadius: 10, border: 'none',
                  background: reindexDone ? COLORS.green : COLORS.ink,
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: reindexing ? 'default' : 'pointer',
                  opacity: reindexing ? 0.6 : 1,
                }}
              >
                {reindexing ? '⏳ Reindexing…' : reindexDone ? '✓ Reindexed!' : '🔄 Reindex now'}
              </button>
              {listingUrl && (
                <a href={listingUrl} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.teal, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                  👁 Preview listing
                </a>
              )}
            </div>
            {reindexDone && (
              <div style={{ fontSize: 12, color: COLORS.green, marginTop: 8 }}>
                ✓ Index updated — your products and knowledge are now searchable.
              </div>
            )}
          </div>
        );
      })()}

      {/* Logo upload */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          Business Logo / Cover Photo
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          Shown in @minimesearchbot results and the web directory. Businesses with photos get highlighted listings.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {logoUrl ? (
            <img src={logoUrl} alt="logo" style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', border: `1px solid ${COLORS.border}` }} />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 12, background: COLORS.tealLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: `1px dashed ${COLORS.border}` }}>
              🏪
            </div>
          )}
          <div>
            <label style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 10, background: COLORS.ink, color: '#fff', fontSize: 13, fontWeight: 600, cursor: uploadingLogo ? 'default' : 'pointer', opacity: uploadingLogo ? 0.6 : 1 }}>
              {uploadingLogo ? '⏳ Uploading…' : logoUrl ? '🔄 Change logo' : '📸 Upload logo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
            </label>
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 6 }}>JPEG, PNG or WebP · max 5 MB</div>
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Tagline
        </div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
          A short one-liner shown in search results. Make it catchy!
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={tagline}
            onChange={e => setTagline(e.target.value.slice(0, 50))}
            placeholder="e.g. Best laptops in Addis"
            maxLength={50}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 10,
              border: `1px solid ${COLORS.border}`, fontSize: 14,
              background: COLORS.surface, color: COLORS.textPrimary,
              outline: 'none',
            }}
          />
          <button
            onClick={saveTagline}
            disabled={savingTagline}
            style={{
              padding: '10px 16px', borderRadius: 10, border: 'none',
              background: taglineSaved ? COLORS.green : COLORS.ink,
              color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: savingTagline ? 'default' : 'pointer',
              opacity: savingTagline ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {savingTagline ? '…' : taglineSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 6 }}>
          {tagline.length}/50 characters
        </div>
      </div>

      {/* Public Info — what search bot can share */}
      {publicInfo && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              What @minimesearchbot Can Share
            </div>
            {savingPublicInfo && <div style={{ fontSize: 11, color: COLORS.textHint }}>Saving…</div>}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
            When customers ask questions about your business in the search bot, it will answer using the info you allow below.
          </div>
          {[
            { key: 'ai_answers',  label: 'AI-powered answers',   hint: 'Bot can answer any question using your knowledge base' },
            { key: 'products',    label: 'Products & services',   hint: 'Show your catalog items in search results' },
            { key: 'prices',      label: 'Prices',                hint: 'Include prices when showing products' },
            { key: 'faqs',        label: 'FAQs & common answers', hint: 'Answer "do you deliver?" and similar questions' },
            { key: 'hours',       label: 'Business hours',        hint: 'Show when you are open' },
            { key: 'address',     label: 'Address & location',    hint: 'Show your full address' },
            { key: 'phone',       label: 'Phone number',          hint: 'Share your phone in search (off by default)' },
          ].map(({ key, label, hint }) => {
            const on = publicInfo[key] !== false;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                <button
                  role="switch" aria-checked={on}
                  onClick={() => togglePublicInfo(key, !on)}
                  style={{
                    flexShrink: 0, width: 38, height: 22, borderRadius: 11, border: 'none',
                    cursor: 'pointer', background: on ? COLORS.green : COLORS.border,
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: on ? 18 : 2,
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
                  }} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary }}>{label}</div>
                  <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 1 }}>{hint}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

      {/* Conversion Funnel */}
      {searchCount > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Conversion Funnel</div>
          <FunnelBar label="Search appearances" value={searchCount} max={searchCount} color={COLORS.teal} />
          <FunnelBar label="Clicked to chat" value={clickCount} max={searchCount} color={COLORS.amber} />
          <FunnelBar label="Started conversation" value={conversations ?? 0} max={searchCount} color={COLORS.green} />
        </div>
      )}

      {/* Top Queries */}
      {topQueries && topQueries.length > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Top Searches That Found You</div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6 }}>
            {topQueries.map(([query, count], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < topQueries.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
                <span style={{ color: COLORS.textPrimary }}>"{query}"</span>
                <span style={{ color: COLORS.textHint, fontWeight: 600, fontSize: 12, flexShrink: 0, marginLeft: 12 }}>{count}x</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 10, lineHeight: 1.4 }}>
            Last 30 days. Improve your tags and description to match more queries.
          </div>
        </div>
      )}

      {/* Reviews */}
      {reviews && reviews.length > 0 && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Your Reviews
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#D4A017' }}>
              ⭐ {avgRating != null ? avgRating : '—'}/5 ({totalReviews ?? 0})
            </div>
          </div>
          {reviews.slice(0, 8).map((review, i) => {
            const timeAgo = (() => {
              const diff = Date.now() - new Date(review.created_at).getTime();
              const days = Math.floor(diff / 86400000);
              if (days === 0) return 'today';
              if (days === 1) return 'yesterday';
              if (days < 7) return `${days} days ago`;
              if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
              return `${Math.floor(days / 30)} months ago`;
            })();
            return (
              <div key={review.id} style={{ padding: '8px 0', borderBottom: i < Math.min(reviews.length, 8) - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, color: '#D4A017' }}>{'⭐'.repeat(review.rating)}</span>
                  <span style={{ fontSize: 11, color: COLORS.textHint }}>{timeAgo}</span>
                </div>
                {review.comment && (
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
                    &ldquo;{review.comment}&rdquo;
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 10, lineHeight: 1.4 }}>
            Reviews are collected from customers who found you through @MiniMeSearchBot.
          </div>
        </div>
      )}

      {/* How it works */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', boxShadow: SHADOW.card, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>How MiniMe Search Works</div>
        <div style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>Anyone on Telegram can open <strong>@MiniMeSearchBot</strong> and type what they need — like "laptop repair in Bole" or "wedding catering."</p>
          <p style={{ margin: '0 0 8px' }}>The search bot finds matching businesses using AI-powered semantic search and shows a link directly to your bot. Customers tap once to start chatting.</p>
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

      {/* Demand from waitlist */}
      {waitlistDemand > 0 && (
        <div style={{
          background: 'rgba(176,138,74,0.08)', border: `1px solid rgba(176,138,74,0.25)`,
          borderRadius: RADII.lg, padding: '14px 16px', marginBottom: 12,
          fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
        }}>
          🔔 <strong>{waitlistDemand} {waitlistDemand === 1 ? 'person is' : 'people are'} waiting</strong> for a business in your category on @MiniMeSearchBot — they searched and found nothing, and will be notified when you appear. Make sure you're visible and reindexed above!
        </div>
      )}

      {/* Tip */}
      <div style={{
        background: COLORS.tealLight, border: `1px solid rgba(79,163,138,0.2)`,
        borderRadius: RADII.lg, padding: '14px 16px',
        fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
      }}>
        💡 <strong>Tip:</strong> Add your products in{' '}
        <a href="/settings/catalog" style={{ color: COLORS.teal, textDecoration: 'none', fontWeight: 600 }}>
          Catalog
        </a>{' '}
        and fill in your description in{' '}
        <a href="/settings/profile" style={{ color: COLORS.teal, textDecoration: 'none', fontWeight: 600 }}>
          Business Profile
        </a>{' '}
        — then tap <strong>Reindex now</strong> above to include them in search.
      </div>
    </div>
  );
}
