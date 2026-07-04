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
  const { initData } = useTelegram() || {};
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [openQuery, setOpenQuery] = useState(null);
  const [erasing, setErasing] = useState(null);

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

  const { totals = {}, daily = [], topBusinesses = [], topQueries = [], failedQueries = [], categoryGaps = [], waitlist = [], searchers = [], hotProducts = [], unmetDemand = [] } = data || {};
  const chartData = daily.map(d => ({
    day: d.day?.slice(5), // MM-DD
    found: Math.max(0, (d.searches || 0) - (d.zeroResults || 0)),
    zeroResults: d.zeroResults || 0,
  }));

  return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '24px 20px 60px', maxWidth: 700 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces',Georgia,serif" }}>
        Search Analytics
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
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard value={totals.cacheHitRate30 != null ? `${totals.cacheHitRate30}%` : '—'} label="Keyword cache hit rate" accent={C.green} />
        <StatCard value={`${totals.en30 ?? 0} / ${totals.am30 ?? 0}`} label="English / Amharic" />
        <StatCard value={totals.waitlistCount?.toLocaleString()} label="Waiting for a match" accent={C.amber} />
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
