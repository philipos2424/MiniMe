'use client';
/**
 * /admin/ux — how owners actually use the Mini App.
 *
 * Reads /api/admin/ux, which aggregates the ux_events views. The four questions
 * this page exists to answer, in order down the screen:
 *
 *   1. Which of the ~50 screens do owners actually use, and which are dead?
 *   2. Where do they get stuck (rage clicks, dead clicks)?
 *   3. Do they trust the agent (accept vs edit vs reject)?
 *   4. Does search convert?
 *
 * Charting note: accept / edit / reject are NOT drawn as one stacked bar. The
 * brand teal and amber sit at ΔE 13.4 for normal vision (below the readable
 * floor of 15) and no step of amber separates from BOTH teal and red, so a
 * stacked bar would make the single most important comparison on this page the
 * hardest one to read. Each stage gets its own directly-labelled row instead —
 * identity comes from the label, and colour is only reinforcement.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../context/TelegramContext';

const C = {
  bg: '#FFFFFF', surface: '#FFFFFF', border: '#E4DED1',
  ink: '#0E2823', inkSoft: '#4A5E5A', muted: '#8A9590',
  teal: '#4FA38A', tealLight: 'rgba(79,163,138,0.10)',
  amber: '#B08A4A', amberLight: 'rgba(176,138,74,0.12)',
  red: '#B85450', redLight: 'rgba(184,84,80,0.10)',
  green: '#4FA38A',
};

const FONT = "'Geist','Inter',-apple-system,system-ui,sans-serif";

const AREA_LABEL = {
  core: 'Core', agent: 'Agent', sales: 'Sales', growth: 'Growth',
  settings: 'Settings', public: 'Public', unmapped: 'Unmapped',
};

function StatCard({ value, label, accent, hint }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || C.ink, letterSpacing: '-0.03em', fontFamily: "'Newsreader',Georgia,serif" }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontWeight: 500 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

/** One directly-labelled magnitude row. `pctOf` shows step-to-step conversion. */
function Bar({ label, value, max, color, pctOf, suffix }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  const conv = pctOf != null && pctOf > 0 ? Math.round((value / pctOf) * 100) : null;
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4, gap: 12 }}>
        <span style={{ color: C.inkSoft, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: C.ink, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {value.toLocaleString()}{suffix}
          {conv != null && <span style={{ color: C.muted, fontWeight: 500 }}> · {conv}%</span>}
        </span>
      </div>
      {/* 2px surface gap via the track's own background; 4px rounded data-end. */}
      <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .5s ease' }} />
      </div>
    </div>
  );
}

function fmtDwell(ms) {
  if (ms == null) return '—';
  const s = Math.round(Number(ms) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function UxAnalyticsPage() {
  // Dual auth, identical to /admin/search-analytics: Telegram initData inside
  // the Mini App, otherwise the mm_admin_session cookie set by /admin/login.
  const { initData: telegramInitData, loading: telegramLoading } = useTelegram() || {};
  const [cookieAdmin, setCookieAdmin] = useState(undefined);
  useEffect(() => {
    if (telegramLoading || telegramInitData) return;
    fetch('/api/admin/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setCookieAdmin(j?.admin || null))
      .catch(() => setCookieAdmin(null));
  }, [telegramLoading, telegramInitData]);
  const initData = telegramInitData || (cookieAdmin ? 'session' : null);
  const cookieProbeInFlight = !telegramLoading && !telegramInitData && cookieAdmin === undefined;

  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [area, setArea] = useState('all');

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/admin/ux?days=${days}`, {
          headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
        });
        if (!r.ok) throw new Error(r.status === 403 ? 'Admin access only' : `Failed to load (${r.status})`);
        const j = await r.json();
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initData, days]);

  const SECTION = { marginBottom: 28 };
  const HEADER = { fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 };
  const NOTE = { fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 };
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

  const {
    featureUsage = [], deadFeatures = [], navTabs = [], agentFunnel = [],
    searchFunnel = [], friction = {}, missingViews = [],
  } = data || {};

  // Per-day (and for the agent, per-business) rows collapse to one total here.
  const sum = (rows, key) => (rows || []).reduce((a, r) => a + Number(r[key] || 0), 0);

  const agent = {
    opens: sum(agentFunnel, 'agent_opens'),
    asked: sum(agentFunnel, 'asked'),
    shown: sum(agentFunnel, 'replies_shown'),
    accepted: sum(agentFunnel, 'accepted'),
    edited: sum(agentFunnel, 'edited'),
    rejected: sum(agentFunnel, 'rejected'),
    taught: sum(agentFunnel, 'taught'),
  };
  const handled = agent.accepted + agent.edited + agent.rejected;
  // "Trust" = sent as written, out of drafts the owner actually acted on.
  // Denominator is handled drafts, not shown drafts: an untouched draft is an
  // unanswered question, and folding it in would read as distrust.
  const trustPct = handled > 0 ? Math.round((agent.accepted / handled) * 100) : null;

  const search = {
    searches: sum(searchFunnel, 'searches'),
    clicks: sum(searchFunnel, 'result_clicks'),
    zero: sum(searchFunnel, 'zero_results'),
    refine: sum(searchFunnel, 'refinements'),
    voice: sum(searchFunnel, 'voice_searches'),
  };
  const ctr = search.searches > 0 ? Math.round((search.clicks / search.searches) * 100) : null;

  const navTotals = Object.values(
    navTabs.reduce((m, r) => {
      const k = r.intent || '?';
      m[k] = m[k] || { intent: k, taps: 0 };
      m[k].taps += Number(r.taps || 0);
      return m;
    }, {})
  ).sort((a, b) => b.taps - a.taps);
  const navMax = navTotals[0]?.taps || 0;
  const navTotal = navTotals.reduce((a, t) => a + t.taps, 0);

  const areas = ['all', ...Array.from(new Set(featureUsage.map(f => f.area).filter(Boolean)))];
  const shown = area === 'all' ? featureUsage : featureUsage.filter(f => f.area === area);
  const usageMax = shown[0]?.unique_businesses || 0;

  const totalClicks = featureUsage.reduce((a, f) => a + f.clicks, 0);
  const totalSessions = featureUsage.reduce((a, f) => a + f.sessions, 0);
  const reach = featureUsage.reduce((a, f) => Math.max(a, f.unique_businesses), 0);

  const btn = active => ({
    appearance: 'none', border: `1px solid ${active ? C.teal : C.border}`,
    background: active ? C.tealLight : C.surface, color: active ? C.teal : C.inkSoft,
    borderRadius: 999, padding: '5px 13px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  });

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
        👆 Product usage — what owners actually do
      </h1>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 16px' }}>
        Every tap and every screen-dwell across the Mini App, Market, Shop and Directory.
      </p>

      {/* Filters in one row above the data. */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 20, flexWrap: 'wrap' }}>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={btn(days === d)}>{d} days</button>
        ))}
      </div>

      {missingViews.length > 0 && (
        <div style={{ ...CARD, borderColor: '#FDBA74', background: '#FFF7ED', padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#9A3412', marginBottom: 5 }}>Migrations not applied yet</div>
          <div style={{ fontSize: 12.5, color: '#9A3412', lineHeight: 1.55 }}>
            These views don’t exist yet: <code>{missingViews.join(', ')}</code>.
            Run <code>ux_events.sql</code>, then <code>ux_feature_map.sql</code>, then{' '}
            <code>ux_intent_views.sql</code> in the Supabase SQL editor, in that order.
          </div>
        </div>
      )}

      {loading && <div style={{ color: C.muted, marginBottom: 20 }}>Loading usage data…</div>}
      {error && <div style={{ color: C.red, marginBottom: 20 }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard value={reach ? reach.toLocaleString() : '0'} label="Businesses active" accent={C.teal} />
            <StatCard value={totalSessions.toLocaleString()} label="Sessions" />
            <StatCard value={totalClicks.toLocaleString()} label="Taps recorded" />
            <StatCard value={deadFeatures.length.toLocaleString()} label="Screens near-unused" accent={C.amber} />
          </div>

          {/* ── 1. Feature leaderboard ─────────────────────────────────────── */}
          <div style={SECTION}>
            <div style={HEADER}>🏆 Which screens get used</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {areas.map(a => (
                <button key={a} onClick={() => setArea(a)} style={{ ...btn(area === a), padding: '4px 11px', fontSize: 11.5 }}>
                  {a === 'all' ? 'All areas' : (AREA_LABEL[a] || a)}
                </button>
              ))}
            </div>
            <div style={{ ...CARD, padding: '16px 18px' }}>
              {shown.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No activity in this window yet.</div>}
              {shown.slice(0, 30).map(f => (
                <div key={f.feature} style={{ marginBottom: 14 }}>
                  <Bar
                    label={f.feature}
                    value={f.unique_businesses}
                    max={usageMax}
                    color={C.teal}
                    suffix=" businesses"
                  />
                  <div style={{ fontSize: 11.5, color: C.muted, display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: -3 }}>
                    <span>{f.clicks.toLocaleString()} taps</span>
                    <span>{f.views.toLocaleString()} opens</span>
                    <span>{f.sessions.toLocaleString()} sessions</span>
                    <span>median stay {fmtDwell(f.median_dwell_ms)}</span>
                    {f.adoption_pct != null && <span>{f.adoption_pct}% of active businesses</span>}
                  </div>
                </div>
              ))}
            </div>
            <div style={NOTE}>
              Ranked by <strong>unique businesses</strong>, not taps. Ranking by taps would put a screen
              that needs six taps to do one thing above a screen that needs one — rewarding the exact
              thing we want to fix. Business counts are a lower bound: they’re the best single day in
              the window, since distinct counts can’t be summed across days without double-counting.
            </div>
          </div>

          {/* ── 2. Dead screens ────────────────────────────────────────────── */}
          <div style={SECTION}>
            <div style={HEADER}>🪦 Removal candidates — under 3 businesses in 30 days</div>
            <div style={{ ...CARD, padding: deadFeatures.length ? 0 : '16px 18px' }}>
              {deadFeatures.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Nothing qualifies — every mapped screen has real use.</div>}
              {deadFeatures.map((d, i) => (
                <div key={d.feature} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 18px',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, fontSize: 13,
                }}>
                  <span style={{ color: C.ink, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.feature}
                    <span style={{ color: C.muted, fontSize: 11.5 }}> · {AREA_LABEL[d.area] || d.area}</span>
                  </span>
                  <span style={{ color: d.businesses_30d === 0 ? C.red : C.amber, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {d.businesses_30d === 0 ? 'never opened' : `${d.businesses_30d} biz · ${d.events_30d} events`}
                  </span>
                </div>
              ))}
            </div>
            <div style={NOTE}>
              Always a 30-day window regardless of the range picked above — a screen looks dead over
              7 days simply because it’s monthly (billing, payouts). Includes screens with zero events.
            </div>
          </div>

          {/* ── 3. Bottom nav split ────────────────────────────────────────── */}
          {navTotals.length > 0 && (
            <div style={SECTION}>
              <div style={HEADER}>🧭 Where the bottom nav actually sends people</div>
              <div style={{ ...CARD, padding: '16px 18px' }}>
                {navTotals.map(t => (
                  <Bar
                    key={t.intent}
                    label={t.intent.replace('nav.tab.', '')}
                    value={t.taps}
                    max={navMax}
                    pctOf={navTotal}
                    color={t.intent === 'nav.tab.minime' ? C.amber : C.teal}
                  />
                ))}
              </div>
              <div style={NOTE}>
                The design assumes the raised centre <strong>MiniMe</strong> button is the centre of
                gravity. Percentages are share of all tab taps — this is the number that confirms or
                refutes that assumption.
              </div>
            </div>
          )}

          {/* ── 4. Agent trust ─────────────────────────────────────────────── */}
          {(agent.shown > 0 || agent.opens > 0) && (
            <div style={SECTION}>
              <div style={HEADER}>🤖 Is MiniMe trusted</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <StatCard
                  value={trustPct != null ? `${trustPct}%` : '—'}
                  label="Drafts sent as written"
                  accent={trustPct != null && trustPct >= 50 ? C.teal : C.amber}
                  hint="Of drafts the owner acted on"
                />
                <StatCard value={agent.taught.toLocaleString()} label="Times taught" />
              </div>
              <div style={{ ...CARD, padding: '16px 18px' }}>
                <Bar label="Agent screens opened" value={agent.opens} max={Math.max(agent.opens, agent.shown, 1)} color={C.teal} />
                <Bar label="Questions asked" value={agent.asked} max={Math.max(agent.opens, agent.shown, 1)} color={C.teal} />
                <Bar label="Drafts shown to owner" value={agent.shown} max={Math.max(agent.opens, agent.shown, 1)} color={C.teal} />
                <Bar label="→ Sent as written" value={agent.accepted} max={Math.max(agent.shown, 1)} pctOf={handled} color={C.teal} />
                <Bar label="→ Edited first" value={agent.edited} max={Math.max(agent.shown, 1)} pctOf={handled} color={C.amber} />
                <Bar label="→ Rejected" value={agent.rejected} max={Math.max(agent.shown, 1)} pctOf={handled} color={C.red} />
              </div>
              <div style={NOTE}>
                The last three are shares of drafts the owner <em>acted on</em> ({handled.toLocaleString()}),
                so they sum to 100%. A high edit rate isn’t failure — it’s the agent being useful but not
                yet in the owner’s voice, which is what the teaching flow is for. Rejection is the number
                to worry about.
              </div>
            </div>
          )}

          {/* ── 5. Search ──────────────────────────────────────────────────── */}
          {search.searches > 0 && (
            <div style={SECTION}>
              <div style={HEADER}>🔎 What searchers do after searching</div>
              <div style={{ ...CARD, padding: '16px 18px' }}>
                <Bar label="Searches" value={search.searches} max={search.searches} color={C.teal} />
                <Bar label="Clicked a result" value={search.clicks} max={search.searches} pctOf={search.searches} color={C.teal} />
                <Bar label="Refined the query" value={search.refine} max={search.searches} pctOf={search.searches} color={C.amber} />
                <Bar label="Got nothing back" value={search.zero} max={search.searches} pctOf={search.searches} color={C.red} />
                <Bar label="Used voice" value={search.voice} max={search.searches} pctOf={search.searches} color={C.teal} />
              </div>
              <div style={NOTE}>
                Click-through {ctr != null ? `${ctr}%` : '—'}. Zero-result searches are the highest-value
                signal here — unmet demand you could recruit a seller for. The Search command center
                has the queries themselves.
              </div>
            </div>
          )}

          {/* ── 6. Friction ────────────────────────────────────────────────── */}
          <div style={SECTION}>
            <div style={HEADER}>😤 Where people get stuck</div>
            <div style={{ display: 'grid', gap: 14 }}>
              <FrictionList
                title="Rage clicks"
                subtitle="3+ taps on the same control inside 2 seconds"
                rows={friction.rageClicks || []}
                color={C.red}
                CARD={CARD}
              />
              <FrictionList
                title="Dead clicks"
                subtitle="Tapped, then nothing happened within 3 seconds"
                rows={friction.deadClicks || []}
                color={C.amber}
                CARD={CARD}
              />
            </div>
            <div style={NOTE}>
              A screen high in the leaderboard <em>and</em> high here isn’t popular — it’s confusing,
              and the taps are people trying to escape it.
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            Structural capture only — screen, control and declared intent. No element text, input
            values, message bodies, customer names or contact details are ever recorded; anything
            matching an email or phone pattern is dropped server-side. Rows are purged after 90 days.
            See <code>docs/DATA_RETENTION.md</code>.
          </div>
        </>
      )}
    </div>
  );
}

function FrictionList({ title, subtitle, rows, color, CARD }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>{subtitle}</div>
      <div style={{ ...CARD, padding: rows.length ? 0 : '14px 16px' }}>
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>None detected — good.</div>}
        {rows.slice(0, 10).map((r, i) => (
          <div key={r.key} style={{
            display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px',
            borderTop: i === 0 ? 'none' : `1px solid ${C.border}`, fontSize: 12.5,
          }}>
            <span style={{ color: C.inkSoft, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace,monospace' }}>{r.key}</span>
            <span style={{ color, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
