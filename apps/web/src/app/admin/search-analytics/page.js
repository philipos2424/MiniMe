'use client';
/**
 * /admin/search-analytics — MiniMe Search usage dashboard.
 *
 * All aggregation happens server-side in /api/admin/search-metrics (paginated
 * past Supabase's 1000-row cap — the old client-side queries silently capped at
 * 500 rows and needed the anon key). Shows volume trend, unique searchers,
 * click-through + conversion, top surfaced businesses, query drill-down,
 * category gaps and the waitlist.
 */
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTelegram } from '../../../context/TelegramContext';

const C = {
  bg: '#FBF8F1', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
  amber: '#B08A4A', amberLight: 'rgba(176,138,74,0.12)',
  red: '#B85450', redLight: 'rgba(184,84,80,0.10)',
  green: '#4FA38A',
};

const FONT = "'Geist','Inter',-apple-system,system-ui,sans-serif";

function StatCard({ value, label, accent }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || C.ink, letterSpacing: '-0.03em', fontFamily: "'Newsreader',Georgia,serif" }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function FunnelBar({ label, value, max, color, pctOf }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  const conv = pctOf != null && pctOf > 0 ? Math.round((value / pctOf) * 100) : null;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
        <span style={{ color: C.inkSoft, fontWeight: 500 }}>{label}</span>
        <span style={{ color: C.ink, fontWeight: 600 }}>
          {value.toLocaleString()}{conv != null && <span style={{ color: C.muted, fontWeight: 500 }}> · {conv}%</span>}
        </span>
      </div>
      <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ok = payload.find(p => p.dataKey === 'found')?.value || 0;
  const zero = payload.find(p => p.dataKey === 'zeroResults')?.value || 0;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, fontFamily: FONT, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
      <div style={{ fontWeight: 600, color: C.ink, marginBottom: 4 }}>{label}</div>
      <div style={{ color: C.teal }}>Found: {ok}</div>
      <div style={{ color: C.red }}>No results: {zero}</div>
    </div>
  );
}

export default function SearchAnalyticsPage() {
  // Dual-auth (same as the master admin): Telegram Mini App initData when
  // opened inside Telegram, otherwise probe the mm_admin_session browser
  // cookie set by /admin/login. The 'session' sentinel keeps the
  // x-telegram-init-data header path working — the server falls back to the
  // cookie via requireAdminRequest.
  const { initData: telegramInitData, loading: telegramLoading } = useTelegram() || {};
  const [cookieAdmin, setCookieAdmin] = useState(undefined); // undefined=checking, null=none, obj=signed in
  useEffect(() => {
    if (telegramLoading || telegramInitData) return;
    fetch('/api/admin/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setCookieAdmin(j?.admin || null))
      .catch(() => setCookieAdmin(null));
  }, [telegramLoading, telegramInitData]);
  const initData = telegramInitData || (cookieAdmin ? 'session' : null);
  const cookieProbeInFlight = !telegramLoading && !telegramInitData && cookieAdmin === undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [openQuery, setOpenQuery] = useState(null);
  const [erasing, setErasing] = useState(null);
  const [notifyState, setNotifyState] = useState({}); // query -> 'busy' | 'ok' | error string

  // Zero-result query → nudge the businesses already in that category to add
  // the missing inventory. Resolves recipients from the existing businesses
  // list (already carries `category`) so notify-owners needs no changes —
  // it already accepts an explicit business_ids list.
  async function notifyCategory(u) {
    if (!u.category) return;
    setNotifyState(s => ({ ...s, [u.query]: 'busy' }));
    try {
      const bizRes = await fetch('/api/admin/businesses', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const bizJson = await bizRes.json();
      const targets = (bizJson.businesses || []).filter(b => b.category === u.category).map(b => b.id);
      if (!targets.length) { setNotifyState(s => ({ ...s, [u.query]: 'No businesses in this category' })); return; }
      const message = `📈 Heads up — shoppers on MiniMe keep searching for "${u.query}" and finding nothing. If you carry this (or something close), add it to your catalog — you're the match they're looking for.`;
      const r = await fetch('/api/admin/notify-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ business_ids: targets, message, include_open_button: true }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'send failed');
      setNotifyState(s => ({ ...s, [u.query]: `Notified ${j.sent || 0}` }));
    } catch (e) {
      setNotifyState(s => ({ ...s, [u.query]: e.message }));
    }
  }

  // GDPR Art. 17: erase one searcher's logs/waitlist/market activity.
  async function eraseSearcher(s) {
    if (!confirm(`Erase all search & market activity for user ${s.masked}?\n\nDeletes their search logs, waitlist entries and market events. Conversion records stay anonymous. Irreversible.`)) return;
    setErasing(s.sid);
    try {
      const r = await fetch('/api/admin/search-metrics', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ sid: s.sid }),
      });
      if (!r.ok) throw new Error(`Erase failed (${r.status})`);
      setData(prev => prev ? { ...prev, searchers: (prev.searchers || []).filter(x => x.sid !== s.sid) } : prev);
    } catch (e) {
      alert(e.message);
    } finally {
      setErasing(null);
    }
  }

  useEffect(() => {
    if (!initData) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/admin/search-metrics', {
          headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
        });
        if (!r.ok) throw new Error(r.status === 403 ? 'Admin access only' : `Failed to load (${r.status})`);
        setData(await r.json());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [initData]);

  const SECTION = { marginBottom: 28 };
  const HEADER = { fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 };
  const CARD = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' };

  if (telegramLoading || cookieProbeInFlight) return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '32px 20px', maxWidth: 700 }}>
      <div style={{ color: C.muted }}>Checking your session…</div>
    </div>
  );
  if (!initData) {
    if (typeof window !== 'undefined') window.location.href = '/admin/login';
    return (
      <div style={{ fontFamily: FONT, color: C.ink, padding: '32px 20px', maxWidth: 700 }}>
        <div style={{ color: C.muted }}>Taking you to sign in…</div>
      </div>
    );
  }
  if (loading) return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '32px 20px', maxWidth: 700 }}>
      <div style={{ color: C.muted }}>Loading search analytics…</div>
    </div>
  );
  if (error) return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '32px 20px', maxWidth: 700 }}>
      <div style={{ color: C.red }}>{error}</div>
    </div>
  );

  const { totals = {}, daily = [], topBusinesses = [], topQueries = [], failedQueries = [], categoryGaps = [], waitlist = [], searchers = [], hotProducts = [], unmetDemand = [], abandonment = null, funnel = null, retention = null, risingQueries = [], peakHours = [], voiceTrend = [] } = data || {};
  const chartData = daily.map(d => ({
    day: d.day?.slice(5), // MM-DD
    found: Math.max(0, (d.searches || 0) - (d.zeroResults || 0)),
    zeroResults: d.zeroResults || 0,
  }));

  return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '24px 20px 60px', maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <a href="/admin" style={{ fontSize: 12, color: C.muted, textDecoration: 'none', fontWeight: 600 }}>← Master admin</a>
        {!telegramInitData && cookieAdmin && (
          <button
            onClick={() => fetch('/api/admin/auth/logout', { method: 'POST' }).then(() => { window.location.href = '/admin/login'; })}
            style={{ appearance: 'none', border: `1px solid ${C.border}`, background: C.surface, color: C.muted, borderRadius: 8, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
          >Sign out</button>
        )}
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces',Georgia,serif" }}>
        🔎 MiniMe Search — Command Center
      </h1>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 24px' }}>
        How people use @minimesearchbot — last 30 days
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <StatCard value={totals.searches7?.toLocaleString()} label="Searches (7d)" accent={C.teal} />
        <StatCard value={totals.searches30?.toLocaleString()} label="Searches (30d)" />
        <StatCard value={totals.uniqueSearchers7?.toLocaleString()} label="People searching (7d)" accent={C.teal} />
        <StatCard value={totals.uniqueSearchers30?.toLocaleString()} label="People searching (30d)" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <StatCard value={totals.referrals30?.toLocaleString()} label="Clicks to businesses (30d)" accent={C.teal} />
        <StatCard value={totals.ctr30 != null ? `${totals.ctr30}%` : '—'} label="Click-through rate" />
        <StatCard value={totals.conversionRate30 != null ? `${totals.conversionRate30}%` : '—'} label="Clicked → messaged" accent={C.green} />
        <StatCard value={totals.zeroRate30 != null ? `${totals.zeroRate30}%` : '—'} label="Zero-result rate" accent={C.red} />
        {abandonment && abandonment.successfulSearches > 0 && (
          <StatCard value={`${abandonment.abandonmentRate}%`} label="Shown but ignored" accent={C.amber} />
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard value={totals.cacheHitRate30 != null ? `${totals.cacheHitRate30}%` : '—'} label="Keyword cache hit rate" accent={C.green} />
        <StatCard value={`${totals.en30 ?? 0} / ${totals.am30 ?? 0}`} label="English / Amharic" />
        <StatCard value={totals.waitlistCount?.toLocaleString()} label="Waiting for a match" accent={C.amber} />
        <StatCard value={totals.budgetFilters30?.toLocaleString() ?? '0'} label="Searches with a price filter (30d)" />
        <StatCard value={totals.voiceSearches30?.toLocaleString() ?? '0'} label="Voice searches (30d)" />
      </div>

      {/* Daily trend */}
      <div style={SECTION}>
        <div style={HEADER}>📈 Searches per day</div>
        <div style={{ ...CARD, padding: '16px 12px 8px' }}>
          <div style={{ display: 'flex', gap: 14, marginBottom: 8, paddingLeft: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.inkSoft }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: C.teal }} /> Found results
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.inkSoft }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: C.red }} /> No results
            </span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} barCategoryGap="25%">
              <XAxis dataKey="day" axisLine={false} tickLine={false} interval={4}
                tick={{ fill: C.muted, fontSize: 10, fontFamily: 'monospace' }} />
              <YAxis hide />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: C.border + '50' }} />
              <Bar dataKey="found" stackId="a" fill={C.teal} />
              <Bar dataKey="zeroResults" stackId="a" fill={C.red} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Conversion funnel: search → market → order */}
      {funnel && funnel.searches > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🪜 Search → order funnel (30d)</div>
          <div style={{ ...CARD, padding: '16px 18px' }}>
            <FunnelBar label="Searches" value={funnel.searches} max={funnel.searches} color={C.teal} />
            <FunnelBar label="Found results" value={funnel.found} max={funnel.searches} pctOf={funnel.searches} color={C.teal} />
            <FunnelBar label="Clicked to a business" value={funnel.clicked} max={funnel.searches} pctOf={funnel.found} color={C.amber} />
            <FunnelBar label="Started a conversation" value={funnel.messaged} max={funnel.searches} pctOf={funnel.clicked} color={C.green} />
            <div style={{ height: 1, background: C.border, margin: '12px 0' }} />
            <FunnelBar label="Market product views" value={funnel.marketViews} max={Math.max(funnel.marketViews, funnel.searches)} color={C.amber} />
            <FunnelBar label="Order taps" value={funnel.orderTaps} max={Math.max(funnel.marketViews, 1)} pctOf={funnel.marketViews} color={C.green} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Percentages are step-to-step conversion. The Market rows are catalog activity in the same period (not attributed to a specific search).
          </div>
        </div>
      )}

      {/* Retention + Peak hours side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        {retention && retention.totalSearchers > 0 && (
          <div>
            <div style={HEADER}>🔁 Repeat searchers</div>
            <div style={{ ...CARD, padding: '16px 18px' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.teal, fontFamily: "'Newsreader',Georgia,serif", letterSpacing: '-0.03em' }}>
                {retention.repeatRate}%
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                {retention.repeatSearchers.toLocaleString()} of {retention.totalSearchers.toLocaleString()} came back
              </div>
              {[
                ['1 search', retention.buckets.one, C.muted],
                ['2–3 searches', retention.buckets.twoThree, C.amber],
                ['4+ searches', retention.buckets.fourPlus, C.green],
              ].map(([label, n, col]) => {
                const pct = retention.totalSearchers ? Math.round((n / retention.totalSearchers) * 100) : 0;
                return (
                  <div key={label} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                      <span style={{ color: C.inkSoft }}>{label}</span>
                      <span style={{ color: C.ink, fontWeight: 600 }}>{n} · {pct}%</span>
                    </div>
                    <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: col, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {peakHours.some(h => h.searches > 0) && (
          <div>
            <div style={HEADER}>🕐 Peak hours (EAT)</div>
            <div style={{ ...CARD, padding: '16px 12px' }}>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={peakHours} barCategoryGap="10%">
                  <XAxis dataKey="hour" axisLine={false} tickLine={false} interval={5}
                    tick={{ fill: C.muted, fontSize: 9, fontFamily: 'monospace' }}
                    tickFormatter={h => `${h}h`} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: C.border + '50' }}
                    contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                    formatter={v => [`${v} searches`, '']}
                    labelFormatter={h => `${h}:00–${h}:59 EAT`} />
                  <Bar dataKey="searches" fill={C.teal} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Rising queries — week over week */}
      {risingQueries.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>📈 Rising searches (this week vs last)</div>
          <div style={CARD}>
            {risingQueries.map((r, i) => (
              <div key={r.query} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: i < risingQueries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontSize: 13, color: C.ink }}>{r.query}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{r.prev} → {r.now}</div>
                <div style={{ fontSize: 12, color: C.green, fontWeight: 700, minWidth: 34, textAlign: 'right' }}>▲{r.delta}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Demand momentum — searches climbing fastest. Recruit or stock ahead of these.
          </div>
        </div>
      )}

      {/* Voice vs text adoption */}
      {voiceTrend.some(d => d.voice > 0 || d.text > 0) && (
        <div style={SECTION}>
          <div style={HEADER}>🎙️ Voice vs text (Market opens / day)</div>
          <div style={{ ...CARD, padding: '16px 12px 8px' }}>
            <div style={{ display: 'flex', gap: 14, marginBottom: 8, paddingLeft: 6 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.inkSoft }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: C.amber }} /> Voice
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.inkSoft }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: C.teal }} /> Text
              </span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={voiceTrend.map(d => ({ day: d.day?.slice(5), voice: d.voice, text: d.text }))} barCategoryGap="25%">
                <XAxis dataKey="day" axisLine={false} tickLine={false} interval={4}
                  tick={{ fill: C.muted, fontSize: 10, fontFamily: 'monospace' }} />
                <YAxis hide />
                <Tooltip cursor={{ fill: C.border + '50' }}
                  contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="text" stackId="a" fill={C.teal} />
                <Bar dataKey="voice" stackId="a" fill={C.amber} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top businesses surfaced */}
      {topBusinesses.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🏆 Businesses search shows most</div>
          <div style={CARD}>
            <div style={{ display: 'flex', gap: 10, padding: '8px 16px', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ flex: 1 }}>Business</div>
              <div style={{ width: 60, textAlign: 'right' }}>Shown</div>
              <div style={{ width: 50, textAlign: 'right' }}>Clicks</div>
              <div style={{ width: 70, textAlign: 'right' }}>Messaged</div>
            </div>
            {topBusinesses.map((b, i) => (
              <div key={b.id} style={{ display: 'flex', gap: 10, padding: '9px 16px', fontSize: 13, borderBottom: i < topBusinesses.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontWeight: 500, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                <div style={{ width: 60, textAlign: 'right', color: C.inkSoft }}>{b.surfaced}</div>
                <div style={{ width: 50, textAlign: 'right', color: C.teal, fontWeight: 600 }}>{b.referrals}</div>
                <div style={{ width: 70, textAlign: 'right', color: C.green, fontWeight: 600 }}>{b.converted}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Searcher traction — pseudonymous, GDPR-safe */}
      {searchers.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>👥 Searchers (pseudonymous · last 30 days)</div>
          <div style={CARD}>
            <div style={{ display: 'flex', gap: 8, padding: '8px 14px', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 62 }}>User</div>
              <div style={{ width: 70, textAlign: 'right' }}>Searches</div>
              <div style={{ width: 66, textAlign: 'right' }}>Mkt views</div>
              <div style={{ width: 50, textAlign: 'right' }}>Clicks</div>
              <div style={{ width: 62, textAlign: 'right' }}>Converted</div>
              <div style={{ flex: 1, textAlign: 'right' }}>Last seen</div>
              <div style={{ width: 34 }} />
            </div>
            {searchers.map((s, i) => (
              <div key={s.sid} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', fontSize: 12.5, borderBottom: i < searchers.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ width: 62, fontFamily: 'monospace', color: C.ink }}>
                  {s.masked}{s.am > 0 && <span title="searches in Amharic"> 🇪🇹</span>}
                </div>
                <div style={{ width: 70, textAlign: 'right', color: C.inkSoft }}>
                  {s.searches}{s.zero > 0 && <span style={{ color: C.red, fontSize: 11 }}> ({s.zero}✗)</span>}
                </div>
                <div style={{ width: 66, textAlign: 'right', color: C.inkSoft }}>{s.views}</div>
                <div style={{ width: 50, textAlign: 'right', color: C.teal, fontWeight: 600 }}>{s.clicks + s.referrals}</div>
                <div style={{ width: 62, textAlign: 'right', color: C.green, fontWeight: 600 }}>{s.converted}</div>
                <div style={{ flex: 1, textAlign: 'right', color: C.muted, fontSize: 11 }}>
                  {s.lastSeen ? new Date(s.lastSeen).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                </div>
                <div style={{ width: 34, textAlign: 'right' }}>
                  <button
                    onClick={() => eraseSearcher(s)}
                    disabled={erasing === s.sid}
                    title="Erase this user's search & market data (GDPR)"
                    style={{ appearance: 'none', border: `1px solid ${C.redLight}`, background: 'transparent', color: C.red, borderRadius: 8, padding: '3px 7px', cursor: 'pointer', fontSize: 12 }}
                  >{erasing === s.sid ? '…' : '🗑'}</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            IDs are masked — MiniMe never stores searcher names, only anonymous Telegram numbers. 🗑 permanently erases a user's search &amp; market data (right to erasure).
          </div>
        </div>
      )}

      {/* Most wanted products — ranked by order-click intent */}
      {hotProducts.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🔥 Most wanted products (30d)</div>
          <div style={CARD}>
            <div style={{ display: 'flex', gap: 8, padding: '8px 14px', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 20 }}>#</div>
              <div style={{ flex: 1 }}>Product</div>
              <div style={{ width: 52, textAlign: 'right' }}>Views</div>
              <div style={{ width: 76, textAlign: 'right' }}>Order taps</div>
              <div style={{ width: 56, textAlign: 'right' }}>Rate</div>
            </div>
            {hotProducts.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 14px', fontSize: 13, borderBottom: i < hotProducts.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ width: 20, textAlign: 'right', fontSize: 12, color: C.muted }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{p.business_name}{p.verified ? ' ✅' : ''}{p.price != null ? ` · ${Number(p.price).toLocaleString()} ${p.currency}` : ''}</div>
                </div>
                <div style={{ width: 52, textAlign: 'right', color: C.inkSoft }}>{p.views}</div>
                <div style={{ width: 76, textAlign: 'right', color: C.teal, fontWeight: 700 }}>{p.clicks}</div>
                <div style={{ width: 56, textAlign: 'right', fontSize: 12, color: p.click_rate >= 30 ? C.green : C.muted }}>{p.click_rate}%</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Ranked by "Order on Telegram" taps — the strongest buy-intent signal. High rate + high views = promote it; high views + low rate = price/photo problem.
          </div>
        </div>
      )}

      {/* Unmet demand — the recruiting & stocking hit-list */}
      {unmetDemand.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🕳️ People want this but can't find it (30d)</div>
          <div style={CARD}>
            {unmetDemand.map((u, i) => (
              <div key={u.query} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 14px', fontSize: 13, borderBottom: i < unmetDemand.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontStyle: 'italic', color: C.inkSoft }}>"{u.query}"</div>
                {u.category && (
                  <div style={{ fontSize: 10.5, color: C.amber, background: C.amberLight, padding: '2px 8px', borderRadius: 10, textTransform: 'capitalize' }}>
                    {u.category.replace(/_/g, ' ')}
                  </div>
                )}
                <div style={{ fontSize: 12, color: C.red, fontWeight: 700 }}>{u.searches}×</div>
                {u.waiting > 0 && <div style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>🔔 {u.waiting} waiting</div>}
                {u.category && (
                  <button
                    onClick={() => notifyCategory(u)}
                    disabled={notifyState[u.query] === 'busy'}
                    style={{ appearance: 'none', border: `1px solid ${C.teal}`, background: 'transparent', color: C.teal, borderRadius: 8, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >{notifyState[u.query] === 'busy' ? '…' : notifyState[u.query] ? notifyState[u.query] : '📢 Add inventory'}</button>
                )}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            Guaranteed demand with zero supply — recruit these businesses or nudge existing ones to stock these. "Waiting" people get auto-notified the moment it appears.
          </div>
        </div>
      )}

      {/* Category gaps — what to recruit */}
      {categoryGaps.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🎯 Categories to recruit (most searched, zero results)</div>
          <div style={CARD}>
            {categoryGaps.map(([cat, n], i) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < categoryGaps.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: C.ink, textTransform: 'capitalize' }}>
                  {cat.replace(/_/g, ' ')}
                </div>
                <div style={{ fontSize: 13, color: C.red, fontWeight: 600, background: C.redLight, padding: '2px 10px', borderRadius: 20 }}>
                  {n} missed
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            These are business categories people searched for but found nothing — recruit these first.
          </div>
        </div>
      )}

      {/* Failed queries */}
      {failedQueries.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>❌ Top zero-result searches</div>
          <div style={CARD}>
            {failedQueries.map((q, i) => (
              <div key={q.query} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', borderBottom: i < failedQueries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontSize: 13, color: C.inkSoft, fontStyle: 'italic' }}>"{q.query}"</div>
                <div style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{q.count}✗</div>
                <div style={{ fontSize: 12, color: C.muted }}>{q.total} total</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top queries with drill-down */}
      {topQueries.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🔍 Top searches (tap for detail)</div>
          <div style={CARD}>
            {topQueries.map((q, i) => (
              <div key={q.query} style={{ borderBottom: i < topQueries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div
                  onClick={() => setOpenQuery(openQuery === q.query ? null : q.query)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer' }}
                >
                  <div style={{ width: 20, textAlign: 'right', fontSize: 12, color: C.muted }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 13, color: C.ink }}>{q.query}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: q.zeroCount === q.count ? C.red : q.zeroCount > 0 ? C.amber : C.teal }}>
                    {q.count} searches
                  </div>
                  {q.zeroCount > 0 && <div style={{ fontSize: 11, color: C.red }}>{q.zeroCount} missed</div>}
                </div>
                {openQuery === q.query && (
                  <div style={{ padding: '4px 16px 12px 46px', fontSize: 12, color: C.inkSoft }}>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 6, color: C.muted }}>
                      <span>🇪🇹 Amharic: {q.am}/{q.count}</span>
                      <span style={{ color: C.teal }}>Clicks: {q.referrals}</span>
                      <span style={{ color: C.green }}>Messaged: {q.converted}</span>
                    </div>
                    {q.businesses?.length > 0 ? (
                      <div>
                        <span style={{ color: C.muted }}>Shows: </span>
                        {q.businesses.map(b => `${b.name} (${b.times}×)`).join(', ')}
                      </div>
                    ) : (
                      <div style={{ color: C.red }}>Never returned a result — recruit for this.</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waitlist */}
      {waitlist.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🔔 Search waitlist ({totals.waitlistCount} pending)</div>
          <div style={CARD}>
            {waitlist.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: i < waitlist.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ flex: 1, fontSize: 13, color: C.inkSoft, fontStyle: 'italic' }}>"{w.raw_query}"</div>
                {w.parsed_category && (
                  <div style={{ fontSize: 11, color: C.amber, background: C.amberLight, padding: '2px 8px', borderRadius: 10 }}>
                    {w.parsed_category.replace(/_/g, ' ')}
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.muted }}>
                  {new Date(w.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            These users will be auto-notified via @minimesearchbot when a matching business joins.
          </div>
        </div>
      )}

      {!topQueries.length && !failedQueries.length && !categoryGaps.length && (
        <div style={{ ...CARD, padding: '32px 20px', textAlign: 'center', color: C.muted }}>
          No search data yet. Analytics will appear once people start using @minimesearchbot.
        </div>
      )}
    </div>
  );
}
