'use client';
/**
 * /admin/search-analytics — Search intelligence dashboard.
 *
 * Shows what people are searching for, what's failing, which categories
 * to recruit next, and the search waitlist.
 */
import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabase-browser';

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

export default function SearchAnalyticsPage() {
  const sb = createClient();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [topQueries, setTopQueries] = useState([]);
  const [failedQueries, setFailedQueries] = useState([]);
  const [categoryGaps, setCategoryGaps] = useState([]);
  const [waitlist, setWaitlist] = useState([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const since7  = new Date(Date.now() -  7 * 86400000).toISOString();

      // Overall stats
      const [
        { count: total30 },
        { count: total7 },
        { count: zeroResults },
        { count: waitlistCount },
        { count: cachedSearches },
      ] = await Promise.all([
        sb.from('search_logs').select('id', { count: 'exact', head: true }).gte('created_at', since30),
        sb.from('search_logs').select('id', { count: 'exact', head: true }).gte('created_at', since7),
        sb.from('search_logs').select('id', { count: 'exact', head: true }).eq('results_count', 0).gte('created_at', since30),
        sb.from('search_waitlist').select('id', { count: 'exact', head: true }).is('notified_at', null),
        sb.from('search_logs').select('id', { count: 'exact', head: true }).eq('used_gpt', false).gte('created_at', since30),
      ]);
      const cacheHitRate = total30 > 0 ? Math.round((cachedSearches / total30) * 100) : 0;
      setStats({ total30, total7, zeroResults, waitlistCount, cachedSearches, cacheHitRate });

      // Top queries (all)
      const { data: logs } = await sb
        .from('search_logs')
        .select('raw_query, results_count, parsed_intent')
        .gte('created_at', since30)
        .order('created_at', { ascending: false })
        .limit(500);

      if (logs) {
        // Frequency count
        const freq = {};
        logs.forEach(l => {
          const q = (l.raw_query || '').toLowerCase().trim().slice(0, 60);
          if (!q) return;
          if (!freq[q]) freq[q] = { count: 0, zeroCount: 0 };
          freq[q].count++;
          if (l.results_count === 0) freq[q].zeroCount++;
        });
        const sorted = Object.entries(freq).sort((a, b) => b[1].count - a[1].count);
        setTopQueries(sorted.slice(0, 15).map(([q, v]) => ({ query: q, count: v.count, zeroCount: v.zeroCount })));

        // Failed queries only
        const failed = sorted
          .filter(([, v]) => v.zeroCount > 0)
          .sort((a, b) => b[1].zeroCount - a[1].zeroCount)
          .slice(0, 15)
          .map(([q, v]) => ({ query: q, count: v.zeroCount, total: v.count }));
        setFailedQueries(failed);

        // Category gaps (what categories people search for but don't find)
        const catFreq = {};
        logs.filter(l => l.results_count === 0 && l.parsed_intent?.category).forEach(l => {
          const cat = l.parsed_intent.category;
          catFreq[cat] = (catFreq[cat] || 0) + 1;
        });
        setCategoryGaps(Object.entries(catFreq).sort((a, b) => b[1] - a[1]).slice(0, 8));
      }

      // Waitlist
      const { data: wl } = await sb
        .from('search_waitlist')
        .select('raw_query, parsed_category, created_at')
        .is('notified_at', null)
        .order('created_at', { ascending: false })
        .limit(30);
      setWaitlist(wl || []);

      setLoading(false);
    }
    load();
  }, []);

  const SECTION = { marginBottom: 28 };
  const HEADER = { fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 };
  const TABLE_ROW = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` };

  if (loading) return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '32px 20px', maxWidth: 700 }}>
      <div style={{ color: C.muted }}>Loading search analytics…</div>
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, color: C.ink, padding: '24px 20px 60px', maxWidth: 700 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces',Georgia,serif" }}>
        Search Analytics
      </h1>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 24px' }}>
        What people are searching for on @minimesearchbot — last 30 days
      </p>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard value={stats?.total7?.toLocaleString()} label="Searches (7d)" accent={C.teal} />
        <StatCard value={stats?.total30?.toLocaleString()} label="Searches (30d)" />
        <StatCard value={stats?.zeroResults?.toLocaleString()} label="No results (30d)" accent={C.red} />
        <StatCard value={stats?.waitlistCount?.toLocaleString()} label="Waiting for a match" accent={C.amber} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
        <StatCard value={stats?.cacheHitRate != null ? `${stats.cacheHitRate}%` : '—'} label="Keyword cache hit rate (30d)" accent={C.green} />
        <StatCard value={stats?.cachedSearches?.toLocaleString()} label="Searches saved from GPT (30d)" />
      </div>

      {/* Category gaps — what to recruit */}
      {categoryGaps.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🎯 Categories to recruit (most searched, zero results)</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            {categoryGaps.map(([cat, n], i) => (
              <div key={cat} style={{ ...TABLE_ROW, padding: '10px 16px', borderBottom: i < categoryGaps.length - 1 ? `1px solid ${C.border}` : 'none' }}>
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
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
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

      {/* All top queries */}
      {topQueries.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🔍 Top searches (all)</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            {topQueries.map((q, i) => (
              <div key={q.query} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: i < topQueries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ width: 20, textAlign: 'right', fontSize: 12, color: C.muted }}>{i + 1}</div>
                <div style={{ flex: 1, fontSize: 13, color: C.ink }}>{q.query}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: q.zeroCount === q.count ? C.red : q.zeroCount > 0 ? C.amber : C.teal }}>
                  {q.count} searches
                </div>
                {q.zeroCount > 0 && (
                  <div style={{ fontSize: 11, color: C.red }}>{q.zeroCount} missed</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waitlist */}
      {waitlist.length > 0 && (
        <div style={SECTION}>
          <div style={HEADER}>🔔 Search waitlist ({stats?.waitlistCount} pending)</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
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

      {!categoryGaps.length && !failedQueries.length && !topQueries.length && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '32px 20px', textAlign: 'center', color: C.muted }}>
          No search data yet. Analytics will appear once people start using @minimesearchbot.
        </div>
      )}
    </div>
  );
}
