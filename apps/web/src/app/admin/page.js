'use client';
/**
 * Platform admin dashboard — overview + tenant list + tenant editor.
 * Auth: only Telegram IDs in ADMIN_TELEGRAM_IDS env var (server-side enforced
 * on every API call).
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';

const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";

export default function AdminPage() {
  const { initData, telegramUser, loading: telegramLoading, error: telegramError } = useTelegram() || {};
  const [tab, setTab] = useState('pulse');
  const [overview, setOverview] = useState(null);
  const [pulse, setPulse] = useState(null);
  const [businesses, setBusinesses] = useState(null);
  const [activeBiz, setActiveBiz] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [adminError, setAdminError] = useState(null);
  const [files, setFiles] = useState(null);
  const [bots, setBots] = useState(null);
  const [botsLoading, setBotsLoading] = useState(false);

  async function readAdminJson(response, label) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (response.status === 403 || response.status === 401) {
      setForbidden(true);
      return null;
    }
    if (!response.ok) {
      const message = payload?.error || payload?.message || `${label} failed (${response.status})`;
      throw new Error(message);
    }
    return payload || {};
  }

  async function loadFiles() {
    try {
      const r = await fetch('/api/admin/files', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await readAdminJson(r, 'Files');
      if (!j) return;
      setFiles(j.files || []);
    } catch (e) { setAdminError(e.message); }
  }

  async function loadPulse() {
    try {
      const r = await fetch('/api/admin/pulse', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await readAdminJson(r, 'Pulse');
      if (!j) return;
      setPulse(j);
      setAdminError(null);
    } catch (e) { setAdminError(e.message); }
  }
  async function loadOverview() {
    try {
      const r = await fetch('/api/admin/overview', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await readAdminJson(r, 'Overview');
      if (!j) return;
      setOverview(j);
      setAdminError(null);
    } catch (e) { setAdminError(e.message); }
  }
  async function loadBusinesses() {
    try {
      const r = await fetch('/api/admin/businesses', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await readAdminJson(r, 'Businesses');
      if (!j) return;
      setBusinesses(j.businesses || []);
      setAdminError(null);
    } catch (e) { setAdminError(e.message); }
  }
  async function loadBots() {
    setBotsLoading(true);
    try {
      const r = await fetch('/api/admin/bots', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await readAdminJson(r, 'Connected bots');
      if (!j) return;
      setBots(j.bots || []);
      setAdminError(null);
    } catch (e) { setAdminError(e.message); }
    finally { setBotsLoading(false); }
  }
  useEffect(() => {
    if (initData) {
      loadPulse();
      loadOverview();
      loadBusinesses();
      loadFiles();
    }
  }, [initData]);

  // Load bots tab lazily on first visit
  useEffect(() => {
    if (tab === 'bots' && !bots && initData) loadBots();
  }, [tab, initData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mission control: keep Pulse fresh while it's on screen
  useEffect(() => {
    if (tab !== 'pulse' || !initData) return;
    const t = setInterval(loadPulse, 60000);
    return () => clearInterval(t);
  }, [tab, initData]); // eslint-disable-line react-hooks/exhaustive-deps

  if (forbidden) {
    return (
      <div style={{ minHeight: '100vh', background: '#FBF6EC', color: '#1A0F08', fontFamily: SERIF, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <h1 style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.025em', margin: 0 }}>Not authorized</h1>
        <p style={{ fontFamily: 'system-ui, sans-serif', color: '#8A7560', marginTop: 8 }}>Your Telegram ID ({telegramUser?.id || '—'}) is not on the admin allowlist.</p>
      </div>
    );
  }

  if (telegramLoading) {
    return <AdminNotice title="Opening admin" message="Waiting for Telegram authentication..." />;
  }

  if (!initData) {
    return (
      <AdminNotice
        title="Telegram auth required"
        message={telegramError || 'Open the master admin from the Telegram mini app so it can send signed initData.'}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FBF6EC', color: '#1A0F08', fontFamily: 'system-ui, sans-serif', paddingBottom: 40 }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid #E8DFD0', padding: '20px 24px', background: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1152, margin: '0 auto' }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8A7560' }}>MiniMe · Platform admin</div>
            <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.03em', margin: 0, marginTop: 2 }}>Master dashboard</h1>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>
            {telegramUser?.first_name} · #{telegramUser?.id}
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 4, marginTop: 16, maxWidth: 1152, margin: '16px auto 0', overflowX: 'auto' }}>
          {[
            ['pulse', '⚡ Pulse'],
            ['overview', 'Overview'],
            ['businesses', 'Businesses' + (businesses ? ` (${businesses.length})` : '')],
            ['funnel', '📈 Funnel'],
            ['notify', '📣 Notify owners'],
            ['bots', 'Connected Bots' + (bots ? ` (${bots.length})` : '')],
            ['files', 'Files' + (files ? ` (${files.length})` : '')],
            ['feedback', '📣 Feedback'],
            ['advisor', '🧠 Advisor'],
            ['email', 'Email Integration'],
            ['economics', '💰 Unit economics'],
            ['analytics', 'API Costs'],
            ['health', 'Platform health'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
              padding: '8px 14px', fontSize: 13, fontWeight: 500,
              color: tab === k ? '#8B2E1F' : '#8A7560',
              borderBottom: tab === k ? '2px solid #8B2E1F' : '2px solid transparent',
              marginBottom: -1,
            }}>{l}</button>
          ))}
        </nav>
      </header>

      <div style={{ maxWidth: 1152, margin: '0 auto', padding: 24 }}>
        {adminError && (
          <div style={{ marginBottom: 16, background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 4, padding: 14, color: '#9A3412' }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>Admin data failed to load</div>
            <div style={{ fontFamily: SERIF, fontSize: 15 }}>{adminError}</div>
            <button onClick={() => { loadOverview(); loadBusinesses(); loadFiles(); }} style={{
              marginTop: 10, appearance: 'none', border: '1px solid #FDBA74', background: '#FFFFFF',
              color: '#9A3412', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
            }}>Retry</button>
          </div>
        )}
        {tab === 'pulse'       && <PulseTab pulse={pulse} onRefresh={loadPulse} setTab={setTab} initData={initData} />}
        {tab === 'overview'    && <Overview overview={overview} initData={initData} reload={loadOverview} />}
        {tab === 'businesses'  && <BusinessesList businesses={businesses} onPick={setActiveBiz} />}
        {tab === 'funnel'      && <FunnelPanel initData={initData} onPick={setActiveBiz} />}
        {tab === 'notify'      && <NotifyOwnersPanel initData={initData} />}
        {tab === 'bots'        && <BotsPanel bots={bots} loading={botsLoading} onRefresh={loadBots} onPick={setActiveBiz} businesses={businesses} initData={initData} />}
        {tab === 'files'       && <FilesPanel files={files} />}
        {tab === 'feedback'    && <PlatformFeedback initData={initData} />}
        {tab === 'advisor'     && <PlatformAdvisor initData={initData} />}
        {tab === 'email'       && <EmailIntegration />}
        {tab === 'economics'   && <UnitEconomics initData={initData} />}
        {tab === 'analytics'   && <LLMAnalytics initData={initData} />}
        {tab === 'health'      && <PlatformHealth overview={overview} initData={initData} />}
      </div>

      {activeBiz && (
        <BusinessDrawer
          businessId={activeBiz.id}
          initData={initData}
          onClose={() => setActiveBiz(null)}
          onChanged={() => { loadBusinesses(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────── Pulse (master view) ──────────────────────────
// Mission control: needs-attention alerts, today vs yesterday, live feed.
// One button per possible triage action. Owns its own busy/result state so
// tapping it never navigates away or reloads the dashboard.
const ALERT_ACTION_LABELS = {
  test_bot: '🔧 Test bot',
  reregister_webhook: '🔁 Re-register webhook',
  message_owner: '💬 Message owner',
};
// Which buttons make sense for each alert type — a payment reminder doesn't
// need a webhook check, and a search-volume alert isn't business-specific.
const ALERT_TYPE_ACTIONS = {
  pending_payment: ['message_owner'],
  panic_mode: ['test_bot', 'message_owner'],
  silent_bot: ['test_bot', 'reregister_webhook', 'message_owner'],
  expiring_trial: ['message_owner'],
  search_gap: [],
};

function AlertActionButton({ action, biz, initData }) {
  const [state, setState] = useState('idle'); // idle | busy | ok | err
  const [msg, setMsg] = useState('');

  async function run() {
    if (action === 'message_owner') {
      const text = (typeof window !== 'undefined' && window.prompt(`Message to ${biz.name}'s owner:`)) || '';
      if (!text.trim()) return;
      setState('busy');
      try {
        const r = await fetch('/api/admin/notify-owners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ business_ids: [biz.id], message: text, include_open_button: false }),
        });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || 'send failed');
        setState('ok'); setMsg(j.sent ? 'Sent' : (j.message || 'No reachable owner'));
      } catch (e) { setState('err'); setMsg(e.message); }
      return;
    }
    if (action === 'test_bot') {
      setState('busy');
      try {
        const r = await fetch(`/api/admin/businesses/${biz.id}/test-bot`, { headers: { 'x-telegram-init-data': initData } });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'check failed');
        const healthy = j.bot_alive && j.webhook_healthy;
        setState(healthy ? 'ok' : 'err');
        setMsg(!j.bot_alive ? 'Bot token invalid' : !j.webhook_healthy ? 'Webhook misconfigured' : 'Bot + webhook OK');
      } catch (e) { setState('err'); setMsg(e.message); }
      return;
    }
    if (action === 'reregister_webhook') {
      setState('busy');
      try {
        const r = await fetch('/api/admin/reregister-webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ business_ids: [biz.id] }),
        });
        const j = await r.json();
        const result = (j.results || [])[0];
        if (!result || result.status !== 'ok') throw new Error(result?.error || j.error || 'failed');
        setState('ok'); setMsg('Webhook re-registered');
      } catch (e) { setState('err'); setMsg(e.message); }
      return;
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={run} disabled={state === 'busy'} style={{
        appearance: 'none', border: '1px solid #E8DFD0', background: '#FFFFFF', borderRadius: 4,
        padding: '3px 8px', cursor: state === 'busy' ? 'default' : 'pointer', fontFamily: MONO, fontSize: 10.5, color: '#3D2817',
      }}>{state === 'busy' ? '…' : ALERT_ACTION_LABELS[action]}</button>
      {state === 'ok' && <span style={{ fontSize: 10.5, color: '#5A7A3F' }}>✅ {msg}</span>}
      {state === 'err' && <span style={{ fontSize: 10.5, color: '#B23A1F' }}>❌ {msg}</span>}
    </span>
  );
}

function PulseTab({ pulse, onRefresh, setTab, initData }) {
  if (!pulse) return <Skeleton />;
  const { status = 'ok', statusReasons = [], alerts = [], today = {}, yesterday = {}, funnel = null, mostWanted = [] } = pulse;
  // Vanity metrics are noise below real traffic — the dashboard should not
  // manufacture false confidence out of single-digit numbers.
  const showVanity = (today.messages || 0) > 100;

  const cards = [
    { k: 'Messages today', v: (today.messages || 0).toLocaleString(), accent: '#3F5D3F', delta: [today.messages, yesterday.messages] },
    { k: 'Orders today', v: today.orders || 0, accent: '#8B2E1F', delta: [today.orders, yesterday.orders] },
    { k: 'GMV today (ETB)', v: (today.revenue_etb || 0).toLocaleString(), accent: '#D9A441', delta: [today.revenue_etb, yesterday.revenue_etb] },
    { k: 'New customers', v: today.new_customers || 0, accent: '#1A0F08', delta: [today.new_customers, yesterday.new_customers] },
    { k: 'Searches today', v: today.searches || 0, accent: '#5A7A3F', delta: [today.searches, yesterday.searches] },
    { k: 'Signups today', v: today.signups || 0, accent: '#7C3AED', delta: [today.signups, yesterday.signups] },
    { k: 'Order clicks', v: today.order_clicks || 0, accent: '#8B6508', delta: [today.order_clicks, yesterday.order_clicks] },
    ...(showVanity ? [
      { k: 'Market views', v: today.market_views || 0, accent: '#1A0F08', delta: [today.market_views, yesterday.market_views] },
      { k: 'Product views', v: today.product_views || 0, accent: '#3D2817', delta: [today.product_views, yesterday.product_views] },
      { k: 'AI cost (USD)', v: `$${(today.ai_cost_usd || 0).toFixed(2)}`, accent: '#B23A1F', delta: [today.ai_cost_usd, yesterday.ai_cost_usd] },
    ] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Platform status — the one thing that should make you look up */}
      <div style={{
        padding: '14px 18px', borderRadius: 4,
        background: status === 'red' ? 'rgba(178,58,31,0.08)' : 'rgba(90,122,63,0.08)',
        border: `1px solid ${status === 'red' ? 'rgba(178,58,31,0.35)' : 'rgba(90,122,63,0.3)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: status === 'red' ? '#B23A1F' : '#5A7A3F' }}>
            {status === 'red' ? '🔴 Platform status: needs attention' : '✅ Platform status: normal'}
          </div>
          <button onClick={onRefresh} style={{
            appearance: 'none', border: '1px solid #E8DFD0', background: '#FFFFFF', borderRadius: 4,
            padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: 11, color: '#8A7560',
          }}>↻ Refresh</button>
        </div>
        {status === 'red' && statusReasons.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#8B2E1F' }}>
            {statusReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      {/* Needs attention — every item is a one-click fix, not a note */}
      <div>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Needs attention</div>
        {alerts.length === 0 ? (
          <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderLeft: '3px solid #5A7A3F', borderRadius: 4, padding: 14, fontFamily: SERIF, fontSize: 15, color: '#5A7A3F' }}>
            ✅ All clear — nothing needs your attention right now.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((a, i) => (
              <div key={i} style={{
                background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: '12px 14px',
                borderLeft: `3px solid ${a.severity === 'red' ? '#B23A1F' : '#D9A441'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{a.icon}</span>
                  <span style={{ flex: 1, fontFamily: SERIF, fontSize: 14.5, color: '#1A0F08' }}>{a.summary}</span>
                  {a.tab && (
                    <button onClick={() => setTab(a.tab)} style={{
                      appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer',
                      fontFamily: MONO, fontSize: 10, color: '#8A7560',
                    }}>open tab →</button>
                  )}
                </div>
                {a.businesses?.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {a.businesses.map(b => (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: 26 }}>
                        <span style={{ fontSize: 13, color: '#3D2817', minWidth: 120 }}>{b.name}</span>
                        {(ALERT_TYPE_ACTIONS[a.type] || []).map(action => (
                          <AlertActionButton key={action} action={action} biz={b} initData={initData} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today at a glance */}
      <div>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>
          Today · vs yesterday
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          {cards.map((c, i) => (
            <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 16 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560' }}>{c.k}</div>
              <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.025em', color: c.accent, lineHeight: 1, marginTop: 6 }}>
                {c.v}
                <Delta now={c.delta[0]} prev={c.delta[1]} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Where are we leaking users — replaces the old raw event feed */}
      {funnel && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>
            Signup → Searchable → Surfaced → Messaged → Ordered · last 30 days
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
            {funnel.stages.map((s, i) => {
              const isLeak = i === funnel.leakStage;
              const base = funnel.stages[0].count || 0;
              const widthPct = base > 0 ? Math.max(4, Math.round((s.count / base) * 100)) : 4;
              return (
                <div key={i} style={{ marginBottom: i < funnel.stages.length - 1 ? 14 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: isLeak ? '#B23A1F' : '#1A0F08' }}>{isLeak ? '⚠️ ' : ''}{s.label}</span>
                    <span style={{ fontFamily: MONO, color: '#8A7560' }}>
                      {s.count.toLocaleString()}{s.pctOfPrevious != null ? ` · ${s.pctOfPrevious}%` : ''}
                    </span>
                  </div>
                  <div style={{ height: 10, background: '#F5EFE2', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${widthPct}%`, background: isLeak ? '#B23A1F' : '#5A7A3F', borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
            {funnel.leakHint && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: '#B23A1F', fontStyle: 'italic' }}>⚠️ {funnel.leakHint}</div>
            )}
          </div>
        </div>
      )}

      {/* Most wanted this week — hidden below real traffic to avoid false signal */}
      {showVanity && mostWanted.length > 0 && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>
            🔥 Most wanted (7d) · by order taps
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, overflow: 'hidden' }}>
            {mostWanted.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 14px', borderBottom: i < mostWanted.length - 1 ? '1px solid #F5EFE2' : 'none' }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560', width: 14 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13.5, color: '#1A0F08', fontWeight: 500 }}>
                  {p.name} <span style={{ color: '#8A7560', fontWeight: 400 }}>· {p.business_name}</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: '#5A7A3F', whiteSpace: 'nowrap' }}>{p.clicks} taps · {p.views} views</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Overview ──────────────────────────────
function AdminNotice({ title, message }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FBF6EC', color: '#1A0F08', fontFamily: SERIF, padding: 40, textAlign: 'center' }}>
      <h1 style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.025em', margin: 0 }}>{title}</h1>
      <p style={{ fontFamily: 'system-ui, sans-serif', color: '#8A7560', marginTop: 8 }}>{message}</p>
    </div>
  );
}

function Sparkline({ data, color = '#5A7A3F', height = 40 }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  const w = 100, h = height, pts = data.length;
  const points = data.map((d, i) => {
    const x = (i / (pts - 1)) * w;
    const y = h - (d.count / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block', marginTop: 8 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Week-over-week arrow: ▲/▼ vs the previous 7-day window. Hidden when the
// server didn't send prev_totals (old payloads) or both weeks are zero.
function Delta({ now, prev }) {
  if (prev === undefined || prev === null) return null;
  const cur = Number(now) || 0;
  const before = Number(prev) || 0;
  if (cur === 0 && before === 0) return null;
  const pct = before > 0 ? Math.round(((cur - before) / before) * 100) : 100;
  const up = cur >= before;
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, marginLeft: 8, color: up ? '#5A7A3F' : '#B23A1F' }}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function Overview({ overview, initData, reload }) {
  const loadOverview = reload || (() => {});
  if (!overview) return <Skeleton />;
  const t = overview.totals;
  const p = overview.prev_totals || {};
  // Prefer the connected count (own bot OR shared shop_code); older payloads
  // only have `linked`.
  const connected = t.connected ?? t.linked;
  const cards = [
    { k: 'Businesses', v: t.businesses, sub: `${connected} connected · ${t.signups_week} new this week`, accent: '#1A0F08', delta: [t.signups_week, p.signups_week] },
    { k: 'Active businesses', v: t.active_week, sub: `messaging in last 7d · ${t.businesses ? Math.round((t.active_week / t.businesses) * 100) : 0}% of total`, accent: '#5A7A3F', delta: [t.active_week, p.active_week] },
    { k: 'Messages', v: (t.messages_week || 0).toLocaleString(), sub: `this week · ${t.ai_rate_pct}% AI`, accent: '#3F5D3F', delta: [t.messages_week, p.messages_week] },
    { k: 'Orders', v: t.orders_week, sub: 'this week', accent: '#8B2E1F', delta: [t.orders_week, p.orders_week] },
    { k: 'GMV (ETB)', v: (t.revenue_etb_week || 0).toLocaleString(), sub: 'paid + fulfilled · this week', accent: '#D9A441', delta: [t.revenue_etb_week, p.revenue_etb_week] },
    { k: 'Active jobs', v: t.jobs_active, sub: 'in flight right now', accent: '#3D2817' },
    { k: 'Customers', v: (t.customers_total || 0).toLocaleString(), sub: t.customers_new_week != null ? `+${t.customers_new_week} this week · all businesses` : 'across all businesses', accent: '#1A0F08', delta: [t.customers_new_week, p.customers_new_week] },
    { k: 'Lessons learned', v: t.lessons_week, sub: 'auto-mined this week', accent: '#7C3AED' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Pending payments — surface first when there are any */}
      {(overview.pending_payments?.length || 0) > 0 && (
        <PendingPaymentsSection
          payments={overview.pending_payments}
          initData={initData}
          onRefresh={() => loadOverview()}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560' }}>{c.k}</div>
            <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, letterSpacing: '-0.025em', color: c.accent, lineHeight: 1, marginTop: 6 }}>
              {c.v}
              {c.delta && <Delta now={c.delta[0]} prev={c.delta[1]} />}
            </div>
            <div style={{ fontSize: 11.5, color: '#8A7560', marginTop: 6, fontFamily: SERIF, fontStyle: 'italic' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Trends row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 4 }}>Messages / day — last 7d</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: '#3F5D3F' }}>{(t.messages_week || 0).toLocaleString()} total</div>
          <Sparkline data={overview.message_trend} color="#3F5D3F" />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {(overview.message_trend || []).map((d, i) => (
              <span key={i} style={{ fontFamily: MONO, fontSize: 8.5, color: '#8A7560' }}>{d.date.slice(5)}</span>
            ))}
          </div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 4 }}>Signups / day — last 30d</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: '#1A0F08' }}>{t.signups_week} this week</div>
          <Sparkline data={overview.signup_trend} color="#8B2E1F" height={40} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {(overview.signup_trend || []).filter((_, i) => i % 5 === 0 || i === 29).map((d, i) => (
              <span key={i} style={{ fontFamily: MONO, fontSize: 8.5, color: '#8A7560' }}>{d.date.slice(5)}</span>
            ))}
          </div>
        </div>
      </div>

      {/* AI automation rate bar */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 12 }}>AI Automation Rate — this week</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, height: 10, background: '#F5EFE2', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${t.ai_rate_pct || 0}%`, background: t.ai_rate_pct >= 60 ? '#5A7A3F' : t.ai_rate_pct >= 30 ? '#D9A441' : '#8A7560', borderRadius: 999, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: '#3F5D3F', lineHeight: 1, minWidth: 60, textAlign: 'right' }}>{t.ai_rate_pct || 0}%</div>
        </div>
        <div style={{ fontSize: 12, color: '#8A7560', marginTop: 8, fontFamily: SERIF, fontStyle: 'italic' }}>
          {(t.ai_messages_week || 0).toLocaleString()} AI replies out of {(t.messages_week || 0).toLocaleString()} total messages
        </div>
      </div>

      {/* Top businesses + plan/status breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Top businesses this week</div>
          {(overview.top_businesses || []).length === 0 && (
            <div style={{ fontSize: 12, color: '#8A7560', fontStyle: 'italic', fontFamily: SERIF }}>No activity yet</div>
          )}
          {(overview.top_businesses || []).map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < overview.top_businesses.length - 1 ? '1px solid #F5EFE2' : 'none' }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560', width: 14, textAlign: 'right' }}>{i + 1}</span>
              <span style={{ flex: 1, fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: '#1A0F08', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: '#3F5D3F' }}>{b.messages_week}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Plans</div>
          {Object.entries(overview.plans).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontFamily: SERIF, fontSize: 16, color: '#1A0F08', fontStyle: 'italic' }}>{k}</span>
              <span style={{ fontFamily: MONO, fontSize: 14, color: '#8B2E1F' }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Subscription status</div>
          {Object.entries(overview.statuses).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ fontFamily: SERIF, fontSize: 16, color: '#1A0F08', fontStyle: 'italic' }}>{k}</span>
              <span style={{ fontFamily: MONO, fontSize: 14, color: k === 'active' ? '#5A7A3F' : k === 'expired' ? '#B23A1F' : '#8A7560' }}>{v}</span>
            </div>
          ))}
          {t.trials_expiring_soon > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(217,164,65,0.12)', border: '1px solid rgba(217,164,65,0.3)', borderRadius: 4, fontSize: 12, color: '#8B6508' }}>
              ⚠️ {t.trials_expiring_soon} trial{t.trials_expiring_soon > 1 ? 's' : ''} expiring in the next 5 days
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── Businesses list ──────────────────────────────
function ImpersonateButton({ businessId, businessName }) {
  const { initData } = useTelegram() || {};
  const [loading, setLoading] = useState(false);

  async function start() {
    if (!initData || loading) return;
    if (!confirm(`Impersonate "${businessName}"? All your actions will be audit-logged.`)) return;
    setLoading(true);
    try {
      const r = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ business_id: businessId, duration_mins: 30 }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error || 'Failed'); return; }
      // Open the dashboard with the impersonate token
      window.open(`/?impersonate=${j.token}`, '_blank');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <button onClick={start} disabled={loading} style={{
      appearance: 'none', border: '1px solid #C5A57A', background: 'transparent',
      color: '#8B6508', fontSize: 11, cursor: loading ? 'default' : 'pointer',
      fontFamily: 'inherit', borderRadius: 4, padding: '2px 8px',
    }}>
      {loading ? '…' : '🎭'}
    </button>
  );
}

function BusinessesList({ businesses, onPick }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  if (!businesses) return <Skeleton />;
  // A business is "connected" if it finished onboarding AND has either a
  // custom Telegram bot linked OR a shop_code (shared MiniMe bot mode).
  // Showing "not linked" purely on telegram_bot_username made shared-mode
  // owners look broken in the admin even though they're fully operational.
  const isConnected = b => !!(b.onboarding_completed && (b.telegram_bot_username || b.shop_code));
  const filtered = businesses.filter(b => {
    if (filter === 'linked'      && !b.telegram_bot_username) return false;
    if (filter === 'shared'      && !(b.shop_code && !b.telegram_bot_username)) return false;
    if (filter === 'connected'   && !isConnected(b)) return false;
    if (filter === 'disconnected' && isConnected(b)) return false;
    if (filter === 'active' && b.subscription_status !== 'active') return false;
    if (filter === 'trial' && b.subscription_status !== 'trial') return false;
    if (filter === 'expired' && b.subscription_status !== 'expired') return false;
    if (filter === 'panic' && !b.panic_mode) return false;
    if (q) {
      const hay = `${b.name} ${b.owner_name} ${b.owner_username || ''} ${b.telegram_bot_username} ${b.shop_code} ${b.category} ${b.owner_telegram_id}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 12, borderBottom: '1px solid #E8DFD0' }}>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search name, owner, handle…"
          style={{ flex: 1, minWidth: 200, border: '1px solid #E8DFD0', borderRadius: 4, padding: '7px 10px', fontSize: 13, background: '#FBF6EC', fontFamily: 'inherit' }}
        />
        {[['all', 'All'], ['connected', 'Connected'], ['linked', 'Own bot'], ['shared', 'Shared bot'], ['disconnected', 'Disconnected'], ['active', 'Active'], ['trial', 'Trial'], ['expired', 'Expired'], ['panic', '🔴 Panic']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            appearance: 'none', border: '1px solid ' + (filter === k ? '#8B2E1F' : '#E8DFD0'),
            background: filter === k ? '#8B2E1F' : 'transparent',
            color: filter === k ? '#FFFFFF' : '#8A7560',
            padding: '5px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>{l}</button>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E8DFD0', background: '#FBF6EC' }}>
            {['Business', 'Owner', 'Plan', 'Status', 'Msgs 7d', 'Orders 7d', 'GMV 7d', 'Last seen', ''].map((h, i) => (
              <th key={i} style={{ textAlign: 'left', padding: '10px 12px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(b => (
            <tr key={b.id} style={{ borderBottom: '1px solid #E8DFD0' }}>
              <td style={{ padding: '11px 12px' }}>
                <div style={{ fontFamily: SERIF, fontSize: 15, color: '#1A0F08', fontStyle: 'italic' }}>{b.name}</div>
                <div style={{ fontSize: 11, color: '#8A7560' }}>
                  {b.telegram_bot_username
                    ? <span style={{ color: '#3F5D3F' }}>@{b.telegram_bot_username}</span>
                    : b.shop_code && b.onboarding_completed
                      ? <span style={{ color: '#3F5D3F' }} title="Uses shared @MiniMeAgentBot">🛍️ shop_{b.shop_code}</span>
                      : <span style={{ color: '#B23A1F' }}>not connected</span>}
                  {b.panic_mode && <span style={{ marginLeft: 6, color: '#B23A1F' }}>· 🔴 panic</span>}
                </div>
              </td>
              <td style={{ padding: '11px 12px', color: '#3D2817' }}>
                {b.owner_name || '—'}
                <div style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560' }}>
                  {b.owner_username
                    ? <a href={`https://t.me/${b.owner_username}`} target="_blank" rel="noreferrer" style={{ color: '#8B2E1F', textDecoration: 'none' }}>@{b.owner_username}</a>
                    : <span>#{b.owner_telegram_id}</span>}
                </div>
              </td>
              <td style={{ padding: '11px 12px' }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#1A0F08', color: '#FBF6EC', fontFamily: SERIF, fontStyle: 'italic' }}>
                  {b.plan_tier || b.subscription_plan || 'free'}
                </span>
              </td>
              <td style={{ padding: '11px 12px' }}>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 3, fontFamily: MONO, letterSpacing: '0.05em',
                  background: b.subscription_status === 'active' ? 'rgba(90,122,63,0.15)' : b.subscription_status === 'trial' ? 'rgba(217,164,65,0.15)' : b.subscription_status === 'expired' ? 'rgba(178,58,31,0.15)' : '#F5EFE2',
                  color: b.subscription_status === 'active' ? '#5A7A3F' : b.subscription_status === 'trial' ? '#8B6508' : b.subscription_status === 'expired' ? '#B23A1F' : '#8A7560',
                }}>{b.subscription_status || '—'}</span>
              </td>
              <td style={{ padding: '11px 12px', fontFamily: MONO, fontSize: 12, color: '#3D2817' }}>{b.stats.messages_week}</td>
              <td style={{ padding: '11px 12px', fontFamily: MONO, fontSize: 12, color: '#3D2817' }}>{b.stats.orders_week}</td>
              <td style={{ padding: '11px 12px', fontFamily: MONO, fontSize: 12, color: '#3D2817' }}>{b.stats.revenue_week.toLocaleString()}</td>
              <td style={{ padding: '11px 12px', fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>{timeAgo(b.updated_at)}</td>
              <td style={{ padding: '11px 12px', textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => onPick(b)} style={{ appearance: 'none', border: 'none', background: 'transparent', color: '#8B2E1F', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Open ›</button>
                <ImpersonateButton businessId={b.id} businessName={b.name} />
              </td>
            </tr>
          ))}
          {!filtered.length && (
            <tr><td colSpan="9" style={{ padding: 32, textAlign: 'center', color: '#8A7560', fontStyle: 'italic', fontFamily: SERIF }}>No businesses match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────── Signup funnel ──────────────────────────────
// "Track how they use MiniMe from signing up" — funnel bars (unique owners who
// reached at least each wizard stage, last 30d) + per-business journey table.
function FunnelPanel({ initData, onPick }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState('all'); // all | stuck | activated

  useEffect(() => {
    if (!initData) return;
    fetch('/api/admin/funnel', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' })
      .then(r => r.json()).then(setData).catch(() => {});
  }, [initData]);

  if (!data) return <Skeleton />;

  const maxOwners = Math.max(...(data.steps || []).map(s => s.owners), 1);
  const journeys = (data.journeys || []).filter(j => {
    if (show === 'stuck') return !j.activated;
    if (show === 'activated') return j.activated;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Funnel bars */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 12 }}>
          Signup funnel — unique owners, last 30 days
        </div>
        {(data.steps || []).map((s, i) => {
          const prev = i > 0 ? data.steps[i - 1].owners : null;
          const dropPct = prev ? Math.round(((prev - s.owners) / Math.max(prev, 1)) * 100) : null;
          return (
            <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 90px', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <div style={{ fontFamily: SERIF, fontSize: 13, fontStyle: 'italic', color: '#1A0F08' }}>{s.label}</div>
              <div style={{ height: 18, background: '#F5EFE2', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(s.owners / maxOwners) * 100}%`, background: i === data.steps.length - 1 ? '#5A7A3F' : '#8B2E1F', opacity: 0.5 + 0.5 * (s.owners / maxOwners), transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: '#3D2817', textAlign: 'right' }}>
                {s.owners}
                {dropPct !== null && dropPct > 0 && <span style={{ color: '#B23A1F', fontSize: 10, marginLeft: 6 }}>−{dropPct}%</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Journey table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderBottom: '1px solid #E8DFD0' }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', flex: 1 }}>
            Every signup, newest first
          </div>
          {[['all', 'All'], ['stuck', '🔴 Stuck'], ['activated', '✅ Activated']].map(([k, l]) => (
            <button key={k} onClick={() => setShow(k)} style={{
              appearance: 'none', border: '1px solid ' + (show === k ? '#8B2E1F' : '#E8DFD0'),
              background: show === k ? '#8B2E1F' : 'transparent',
              color: show === k ? '#FFFFFF' : '#8A7560',
              padding: '4px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l}</button>
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E8DFD0', background: '#FBF6EC' }}>
              {['Business', 'Owner', 'Signed up', 'Journey', 'Furthest step', 'Last activity', ''].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '9px 12px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {journeys.map(j => (
              <tr key={j.id} style={{ borderBottom: '1px solid #F5EFE2' }}>
                <td style={{ padding: '9px 12px' }}>
                  <div style={{ fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: '#1A0F08' }}>{j.name}</div>
                  <div style={{ fontSize: 10.5, color: j.activated ? '#3F5D3F' : '#B23A1F' }}>
                    {j.activated ? (j.bot || 'activated') : 'not activated'}
                    {j.subscription_status && <span style={{ color: '#8A7560' }}> · {j.subscription_status}</span>}
                  </div>
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: '#3D2817' }}>
                  {j.owner_name || '—'}
                  <div style={{ fontFamily: MONO, fontSize: 10 }}>
                    {j.owner_username
                      ? <a href={`https://t.me/${j.owner_username}`} target="_blank" rel="noreferrer" style={{ color: '#8B2E1F', textDecoration: 'none' }}>@{j.owner_username}</a>
                      : <span style={{ color: '#8A7560' }}>#{j.owner_telegram_id}</span>}
                  </div>
                </td>
                <td style={{ padding: '9px 12px', fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>{timeAgo(j.created_at)}</td>
                <td style={{ padding: '9px 12px' }}>
                  {/* Mini stage dots: filled up to furthest_index */}
                  <div style={{ display: 'flex', gap: 3 }}>
                    {Array.from({ length: data.total_stages }).map((_, i) => (
                      <span key={i} style={{
                        width: 9, height: 9, borderRadius: 999,
                        background: i <= j.furthest_index ? (j.activated && i === data.total_stages - 1 ? '#5A7A3F' : '#8B2E1F') : '#EDE4D3',
                      }} />
                    ))}
                  </div>
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, color: '#3D2817' }}>
                  {j.furthest_stage || <span style={{ color: '#8A7560' }}>no telemetry</span>}
                  {j.events_30d > 0 && <div style={{ fontFamily: MONO, fontSize: 9.5, color: '#8A7560' }}>{j.events_30d} events · {j.last_step}</div>}
                </td>
                <td style={{ padding: '9px 12px', fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>{j.last_event_at ? timeAgo(j.last_event_at) : '—'}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                  <button onClick={() => onPick({ id: j.id })} style={{ appearance: 'none', border: 'none', background: 'transparent', color: '#8B2E1F', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Open ›</button>
                </td>
              </tr>
            ))}
            {!journeys.length && (
              <tr><td colSpan="7" style={{ padding: 32, textAlign: 'center', color: '#8A7560', fontStyle: 'italic', fontFamily: SERIF }}>Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────── Tenant detail drawer ──────────────────────────────
function BusinessDrawer({ businessId, initData, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const r = await fetch(`/api/admin/businesses/${businessId}`, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    const j = await r.json();
    setData(j);
  }
  useEffect(() => { load(); }, [businessId]);

  async function patch(updates) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(updates),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function nuke() {
    if (!confirm(`Delete ${data?.business?.name}? This cascades through every customer, conversation, order, job — irreversible.`)) return;
    const name = data?.business?.name || businessId;
    const typed = prompt(`Type DELETE ${name} to confirm.`);
    if (typed !== `DELETE ${name}`) return;
    setBusy(true); setErr('');
    const r = await fetch(`/api/admin/businesses/${businessId}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || 'delete failed');
      setBusy(false);
      return;
    }
    onChanged?.(); onClose();
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(26,15,8,0.5)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 100vw)', height: '100vh', background: '#FBF6EC', overflow: 'auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8A7560' }}>Tenant</div>
            <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.025em', margin: 0, marginTop: 2 }}>{data?.business?.name || '…'}</h2>
            {data?.business?.telegram_bot_username && (
              <a href={`https://t.me/${data.business.telegram_bot_username}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#8B2E1F' }}>@{data.business.telegram_bot_username} ↗</a>
            )}
          </div>
          <button onClick={onClose} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 22, color: '#8A7560', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {!data ? <Skeleton /> : (
          <>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
              {[
                ['Msgs 7d', data.stats.msgs_week],
                ['Orders 7d', data.stats.orders_week],
                ['GMV 7d', data.stats.revenue_week.toLocaleString()],
                ['Customers', data.stats.customers_total],
                ['Conv.', data.stats.convos_total],
                ['Active jobs', data.stats.jobs_active],
                ['Lessons 7d', data.stats.lessons_week],
                ['Docs', data.stats.docs_total],
                ['Team', data.stats.team_count],
              ].map(([k, v]) => (
                <div key={k} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 10 }}>
                  <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>{k}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: '#1A0F08', lineHeight: 1, marginTop: 4 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Subscription controls */}
            <Section title="Subscription">
              {/* Status badge */}
              {(() => {
                const st = data.business.subscription_status || 'trial';
                const trialEnd = data.business.trial_ends_at ? new Date(data.business.trial_ends_at) : null;
                const subExp = data.business.subscription_expires_at ? new Date(data.business.subscription_expires_at) : null;
                const isExpired = st === 'expired' || st === 'cancelled' || (trialEnd && trialEnd < new Date()) || (subExp && subExp < new Date());
                return (
                  <div style={{ padding: '8px 12px', borderRadius: 4, marginBottom: 12, background: isExpired ? 'rgba(178,58,31,0.08)' : st === 'active' ? 'rgba(90,122,63,0.08)' : 'rgba(217,164,65,0.08)', border: `1px solid ${isExpired ? 'rgba(178,58,31,0.2)' : st === 'active' ? 'rgba(90,122,63,0.2)' : 'rgba(217,164,65,0.2)'}`, fontSize: 12, color: isExpired ? '#B23A1F' : st === 'active' ? '#5A7A3F' : '#8B6508', fontFamily: MONO, letterSpacing: '0.05em' }}>
                    {isExpired ? '⛔ PAUSED — bot is blocked from sending AI replies' : st === 'active' ? '✅ ACTIVE — bot is running normally' : '⏳ TRIAL — will pause when trial expires'}
                  </div>
                );
              })()}
              <Row label="Plan tier">
                <select value={data.business.plan_tier || 'free'} onChange={e => patch({ plan_tier: e.target.value })} disabled={busy} style={selectStyle}>
                  {['free', 'starter', 'pro', 'business', 'enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Row>
              <Row label="Status">
                <select value={data.business.subscription_status || 'trial'} onChange={e => patch({ subscription_status: e.target.value })} disabled={busy} style={selectStyle}>
                  {['trial', 'active', 'expired', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Row>
              <Row label="Trial ends">
                <input
                  type="date"
                  defaultValue={data.business.trial_ends_at ? data.business.trial_ends_at.slice(0, 10) : ''}
                  onBlur={e => e.target.value && patch({ trial_ends_at: e.target.value })}
                  disabled={busy}
                  style={{ ...selectStyle, fontFamily: MONO, fontSize: 11 }}
                />
              </Row>
              <Row label="Subscription expires">
                <input
                  type="date"
                  defaultValue={data.business.subscription_expires_at ? data.business.subscription_expires_at.slice(0, 10) : ''}
                  onBlur={e => e.target.value && patch({ subscription_expires_at: new Date(e.target.value).toISOString() })}
                  disabled={busy}
                  style={{ ...selectStyle, fontFamily: MONO, fontSize: 11 }}
                />
              </Row>
              <Row label="Payment ref">
                <input
                  type="text"
                  defaultValue={data.business.payment_ref || ''}
                  placeholder="Chapa/Telebirr ref…"
                  onBlur={e => patch({ payment_ref: e.target.value.trim() || null })}
                  disabled={busy}
                  style={{ ...selectStyle, fontFamily: MONO, fontSize: 11, width: '100%' }}
                />
              </Row>
              <Row label="Payment notes">
                <input
                  type="text"
                  defaultValue={data.business.payment_notes || ''}
                  placeholder="e.g. paid via CBE, receipt #…"
                  onBlur={e => patch({ payment_notes: e.target.value.trim() || null })}
                  disabled={busy}
                  style={{ ...selectStyle, fontSize: 11, width: '100%' }}
                />
              </Row>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {[7, 14, 30, 90, 365].map(d => (
                  <button key={d} disabled={busy} onClick={() => patch({ extend_trial_days: d })} style={btnGhost}>+{d}d</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button disabled={busy} onClick={() => patch({ subscription_status: 'active', plan_tier: 'pro', subscription_expires_at: new Date(Date.now() + 30*86400000).toISOString() })} style={{ ...btnGhost, background: '#1A0F08', color: '#FBF6EC', borderColor: '#1A0F08' }}>🚀 Activate Pro +30d</button>
                <button disabled={busy} onClick={() => patch({ subscription_status: 'active' })} style={{ ...btnGhost, color: '#5A7A3F', borderColor: 'rgba(90,122,63,0.4)' }}>✅ Activate</button>
                <button disabled={busy} onClick={() => patch({ subscription_status: 'expired' })} style={{ ...btnGhost, color: '#B23A1F', borderColor: 'rgba(178,58,31,0.4)' }}>⛔ Expire</button>
                <button disabled={busy} onClick={() => patch({ subscription_status: 'cancelled' })} style={{ ...btnGhost, color: '#8A7560', borderColor: 'rgba(138,117,96,0.4)' }}>✗ Cancel</button>
              </div>
            </Section>

            {/* Operational controls */}
            <Section title="Operations">
              <Row label="Brain mode">
                <Toggle on={!!data.business.brain_mode} onChange={v => patch({ brain_mode: v })} disabled={busy} />
              </Row>
              <Row label="Panic mode (kill switch)">
                <Toggle on={!!data.business.panic_mode} onChange={v => patch({ panic_mode: v })} disabled={busy} danger />
              </Row>
              <Row label="Verified badge ✅">
                <Toggle on={!!data.business.verified} onChange={v => patch({ verified: v })} disabled={busy} />
              </Row>
              <Row label="Listed in Market & Search">
                <Toggle on={!!data.business.b2b_discoverable} onChange={v => patch({ b2b_discoverable: v })} disabled={busy} />
              </Row>
              <Row label="Trust level">
                <select value={data.business.trust_level ?? 0} onChange={e => patch({ trust_level: Number(e.target.value) })} disabled={busy} style={selectStyle}>
                  <option value={0}>0 · Shadow</option>
                  <option value={1}>1 · Supervised</option>
                  <option value={2}>2 · Trusted</option>
                  <option value={3}>3 · Full Agent</option>
                </select>
              </Row>
            </Section>

            {/* Owner contact */}
            <Section title="Owner">
              <Row label="Name"><span>{data.business.owner_name || '—'}</span></Row>
              <Row label="Telegram">
                {data.business.owner_username
                  ? <a href={`https://t.me/${data.business.owner_username}`} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 12, color: '#8B2E1F' }}>@{data.business.owner_username} ↗</a>
                  : <span style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>no @username</span>}
              </Row>
              <Row label="Telegram ID"><span style={{ fontFamily: MONO, fontSize: 12 }}>#{data.business.owner_telegram_id}</span></Row>
              <Row label="Created"><span style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>{new Date(data.business.created_at).toLocaleDateString()}</span></Row>
            </Section>

            <SubAdminsSection businessId={businessId} business={data.business} initData={initData} />

            {/* Customer list + GDPR-grade erase */}
            <CustomersSection businessId={businessId} initData={initData} onChanged={load} />

            {/* AI deep analysis */}
            <BusinessAdvisor businessId={businessId} initData={initData} businessName={data.business.name} />

            {err && <div style={{ background: 'rgba(178,58,31,0.1)', border: '1px solid rgba(178,58,31,0.3)', color: '#B23A1F', padding: 10, borderRadius: 4, fontSize: 12, marginTop: 16 }}>{err}</div>}

            {/* Danger */}
            <Section title="Danger zone">
              <button onClick={nuke} disabled={busy} style={{ ...btnGhost, color: '#B23A1F', borderColor: '#B23A1F' }}>
                Delete tenant + all data
              </button>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── Customers (admin erase) ─────────────────────
// Lazy-loaded list of a tenant's customers with per-row GDPR-grade erasure
// (reuses the same eraseCustomerData path as customer-initiated deletion —
// orders survive as anonymous accounting records). Every erase is audit-logged
// server-side.
const SEGMENT_LABELS = {
  buyer: { label: 'Buyer', color: '#5A7A3F' },
  warm: { label: 'Warm', color: '#B08A4A' },
  browser: { label: 'Browser', color: '#8A7560' },
};
const CADENCE_LABELS = { repeat: 'Repeat', one_and_done: 'One-and-done' };

// One customer's cross-source timeline (searches, Market views/clicks,
// first message, orders) merged chronologically, plus a computed behavior
// segment — lazy-loaded per row so listing 50 customers doesn't fire 50 queries.
function CustomerJourneyRow({ businessId, customer, initData }) {
  const [open, setOpen] = useState(false);
  const [journey, setJourney] = useState(null);
  const [err, setErr] = useState('');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !journey) {
      try {
        const r = await fetch(`/api/admin/businesses/${businessId}/customers/${customer.id}/journey`, {
          headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'failed to load journey');
        setJourney(j);
      } catch (e) { setErr(e.message); }
    }
  }

  return (
    <>
      <button onClick={toggle} style={{
        appearance: 'none', border: '1px solid #E8DFD0', background: '#FFFFFF', borderRadius: 4,
        padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: '#3D2817',
      }}>{open ? 'Hide' : '🔎 Journey'}</button>
      {open && (
        <div style={{ width: '100%', marginTop: 8, paddingLeft: 4 }}>
          {err && <div style={{ color: '#B23A1F', fontSize: 11.5 }}>{err}</div>}
          {!journey && !err && <div style={{ fontSize: 11.5, color: '#8A7560' }}>Loading…</div>}
          {journey && (
            <div style={{ background: '#FBF6EC', border: '1px solid #E8DFD0', borderRadius: 4, padding: '8px 10px' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', background: SEGMENT_LABELS[journey.segment.intent]?.color || '#8A7560', borderRadius: 10, padding: '2px 8px' }}>
                  {SEGMENT_LABELS[journey.segment.intent]?.label || journey.segment.intent}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#8A7560', border: '1px solid #E8DFD0', borderRadius: 10, padding: '2px 8px' }}>
                  {CADENCE_LABELS[journey.segment.cadence] || journey.segment.cadence}
                </span>
              </div>
              {journey.timeline.length === 0 ? (
                <div style={{ fontSize: 11.5, color: '#8A7560', fontStyle: 'italic' }}>No cross-source activity found for this customer.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflow: 'auto' }}>
                  {journey.timeline.map((e, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                      <span style={{ color: '#1A0F08' }}>{e.text}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560', whiteSpace: 'nowrap' }}>{timeAgo(e.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function CustomersSection({ businessId, initData, onChanged }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  async function loadCustomers() {
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}/customers`, { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed to load customers');
      setRows(j.customers || []);
    } catch (e) { setErr(e.message); }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) loadCustomers();
  }

  async function erase(c) {
    if (!confirm(`Erase ${c.name || 'this customer'} (#${c.telegram_id})?\n\nDeletes their chats, memory and profile at this business. Orders stay as anonymous records. Irreversible.`)) return;
    setBusyId(c.id); setErr('');
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}/customers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ customer_id: c.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'erase failed');
      setRows(prev => (prev || []).filter(x => x.id !== c.id));
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusyId(null); }
  }

  return (
    <Section title="Customers">
      <button onClick={toggle} style={btnGhost}>
        {open ? 'Hide customers' : 'Show customers'}{rows ? ` (${rows.length})` : ''}
      </button>
      {err && <div style={{ color: '#B23A1F', fontSize: 12, marginTop: 8 }}>{err}</div>}
      {open && (
        rows === null ? (
          <div style={{ fontSize: 12, color: '#8A7560', marginTop: 10 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8A7560', marginTop: 10 }}>No customers yet.</div>
        ) : (
          <div style={{ marginTop: 10, border: '1px solid #E8DFD0', borderRadius: 4, background: '#FFFFFF', maxHeight: 320, overflow: 'auto' }}>
            {rows.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '8px 12px', borderBottom: i < rows.length - 1 ? '1px solid #E8DFD0' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1A0F08', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || 'Unnamed'}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: '#8A7560' }}>
                    #{c.telegram_id} · {c.total_orders || 0} order{(c.total_orders || 0) === 1 ? '' : 's'}
                    {c.last_active_at ? ` · last active ${new Date(c.last_active_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <CustomerJourneyRow businessId={businessId} customer={c} initData={initData} />
                <button
                  onClick={() => erase(c)}
                  disabled={busyId === c.id}
                  title="Erase this customer (GDPR)"
                  style={{ appearance: 'none', border: '1px solid rgba(178,58,31,0.4)', background: 'transparent', color: '#B23A1F', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
                >{busyId === c.id ? '…' : '🗑'}</button>
              </div>
            ))}
          </div>
        )
      )}
    </Section>
  );
}

// ────────────────────────────── Notify owners ────────────────────────────────
// Send a one-off platform announcement to onboarded owners via the shared
// @MiniMeAgentBot. Every owner has a chat with the shared bot (that's how
// they signed up), so this reaches them whether or not they later linked
// their own custom bot.
function NotifyOwnersPanel({ initData }) {
  const SEGMENTS = [
    ['all',          'All onboarded owners'],
    ['shared',       'Shared-mode owners (no own bot)'],
    ['linked',       'Linked-bot owners'],
    ['inactive_7d',  'Inactive 7+ days'],
    ['no_products',  'No products yet'],
    ['never_taught', 'Never ran /learn'],
  ];

  const TEMPLATES = [
    {
      label: '🎓 How to use MiniMe (re-engagement)',
      text: `*Welcome back to MiniMe* 👋\n\nQuick refresher on getting the most out of your AI assistant:\n\n*1. Teach it your business* — open the mini app and tap *Teach*. Add your top 5 products, your hours, and the questions customers ask most. The more it knows, the better it replies.\n\n*2. Share your link* — your Business Card (in Settings → Card) has a one-tap share for Instagram, WhatsApp, Telegram groups. New customers land straight in your shop.\n\n*3. Let it learn from you* — every time you correct a draft reply, MiniMe remembers. After ~20 chats it starts handling routine questions on its own.\n\n*4. Check the Dashboard daily* — pending replies, new customers, and what people are asking are all on the home screen.\n\nNeed help? Just reply to this message.`,
    },
    {
      label: '📦 You haven\'t added products yet',
      text: `Hi! 👋\n\nWe noticed your MiniMe is up and running, but your catalog is still empty.\n\nAdding even 3–5 products makes a huge difference — your AI assistant can answer price questions, show photos, and take orders automatically.\n\nOpen MiniMe and tap *Teach* — you can paste a list, send a photo, or upload a price list PDF. It takes about 2 minutes.`,
    },
    {
      label: '✨ What\'s new',
      text: `*What's new in MiniMe* ✨\n\n• *Branded storefront pages* — when you share your link on Instagram or WhatsApp it now shows YOUR business name and logo, not "MiniMe".\n\n• *Smarter learning* — every time you correct a reply, MiniMe remembers. Even when customers ask the same thing differently later.\n\n• *Faster replies* — model calls are now bounded so a stuck request can't hold up your customers.\n\nOpen the app to see your updated Business Card.`,
    },
  ];

  const [segment, setSegment] = useState('all');
  const [targetingMode, setTargetingMode] = useState('segment'); // 'segment' or 'custom'
  const [message, setMessage] = useState('');
  const [includeButton, setIncludeButton] = useState(true);
  // recipients: full enriched list for the current segment.
  // selectedIds: subset the admin actually wants to send to. We seed it with
  // every recipient id whenever the segment changes, so the default behaviour
  // is "send to the whole segment" and the admin only has to deselect.
  const [recipients, setRecipients] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeCount, setActiveCount] = useState(null);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function loadList(seg) {
    if (!initData) return;
    setLoadingList(true);
    setRecipients(null);
    setActiveCount(null);
    try {
      const r = await fetch(`/api/admin/notify-owners?segment=${encodeURIComponent(seg)}&include_recipients=1`, {
        headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
      });
      const j = await r.json();
      if (r.ok) {
        const list = j.recipients || [];
        setRecipients(list);
        setActiveCount(j.active_count ?? null);
        // Default selection = everyone in the segment who isn't already opted
        // out. The admin still needs to actively click Send, so this isn't a
        // foot-gun — it just removes the busywork of selecting all by default.
        setSelectedIds(new Set(list.filter(r => !r.opted_out).map(r => r.id)));
      }
    } catch {} finally { setLoadingList(false); }
  }

  useEffect(() => { loadList(segment); }, [segment, initData]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRecipients = (recipients || []).filter(r => {
    if (!search) return true;
    const hay = `${r.name} ${r.owner_name || ''} ${r.telegram_bot_username || ''} ${r.shop_code || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });
  const selectedCount = selectedIds.size;
  const selectedActiveCount = (recipients || []).filter(r => selectedIds.has(r.id) && r.is_active_7d).length;

  function toggleOne(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll()      { setSelectedIds(new Set((recipients || []).filter(r => !r.opted_out).map(r => r.id))); }
  function selectNone()     { setSelectedIds(new Set()); }
  function selectActive()   { setSelectedIds(new Set((recipients || []).filter(r => r.is_active_7d && !r.opted_out).map(r => r.id))); }
  function selectInactive() { setSelectedIds(new Set((recipients || []).filter(r => !r.is_active_7d && !r.opted_out).map(r => r.id))); }

  useEffect(() => {
    if (targetingMode === 'custom') {
      selectNone();
    } else {
      loadList(segment);
    }
  }, [targetingMode]);

  async function send() {
    if (!message.trim()) { setErr('Write a message first.'); return; }
    if (selectedCount === 0) { setErr('Select at least one owner.'); return; }
    if (!confirm(`Send to ${selectedCount} owner${selectedCount === 1 ? '' : 's'} via @MiniMeAgentBot? This can't be undone.`)) return;
    setSending(true); setErr(''); setResult(null);
    try {
      const r = await fetch('/api/admin/notify-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          message,
          include_open_button: includeButton,
          business_ids: Array.from(selectedIds),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setResult(j);
    } catch (e) { setErr(e.message); } finally { setSending(false); }
  }

  // Compact relative time, optimised for "this morning vs last week vs never".
  function relTime(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    return `${mo}mo ago`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560' }}>Platform announcement</div>
        <h2 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, margin: '4px 0 0', letterSpacing: '-0.02em' }}>Notify onboarded owners</h2>
        <p style={{ fontSize: 13, color: '#8A7560', marginTop: 6, marginBottom: 0, fontFamily: SERIF, fontStyle: 'italic' }}>
          Sends from <strong>@MiniMeAgentBot</strong> to each owner's Telegram. Includes a "Reply STOP" footer. Rate-limited to 1 broadcast every 5 minutes platform-wide.
        </p>
      </div>

      {/* Segment + recipient list */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Audience</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button 
            onClick={() => setTargetingMode('segment')} 
            style={{
              appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (targetingMode === 'segment' ? '#8B2E1F' : '#E8DFD0'),
              background: targetingMode === 'segment' ? '#8B2E1F' : 'transparent',
              color: targetingMode === 'segment' ? '#FFFFFF' : '#3D2817',
              padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
            }}>
            🎯 Segment Mode
          </button>
          <button 
            onClick={() => setTargetingMode('custom')} 
            style={{
              appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid ' + (targetingMode === 'custom' ? '#8B2E1F' : '#E8DFD0'),
              background: targetingMode === 'custom' ? '#8B2E1F' : 'transparent',
              color: targetingMode === 'custom' ? '#FFFFFF' : '#3D2817',
              padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
            }}>
            👤 Custom Selection
          </button>
        </div>
        {targetingMode === 'segment' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {SEGMENTS.map(([k, l]) => (
              <button key={k} onClick={() => setSegment(k)} style={{
                appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid ' + (segment === k ? '#8B2E1F' : '#E8DFD0'),
                background: segment === k ? '#8B2E1F' : 'transparent',
                color: segment === k ? '#FFFFFF' : '#3D2817',
                padding: '6px 12px', borderRadius: 999, fontSize: 12,
              }}>{l}</button>
            ))}
          </div>
        )}

        {/* At-a-glance stats: segment total, how many of them are active, how
            many the admin has currently selected. Three numbers because that's
            the loop the admin actually thinks in: "out of N in this segment,
            X are alive enough to bother — and I want to hit Y of those". */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 16, padding: '12px 0', borderTop: '1px solid #F5EFE2' }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>In segment</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, color: '#1A0F08', lineHeight: 1 }}>
              {loadingList ? '…' : (recipients?.length ?? '—')}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>Active 7d</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, color: '#3F5D3F', lineHeight: 1 }}>
              {loadingList ? '…' : (activeCount ?? '—')}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>Selected</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, color: '#8B2E1F', lineHeight: 1 }}>{selectedCount}</div>
            <div style={{ fontSize: 10, color: '#8A7560', marginTop: 2 }}>{selectedActiveCount} active</div>
          </div>
        </div>

        {/* Quick-select row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <button onClick={selectAll}      style={pillBtn}>Select all</button>
          <button onClick={selectActive}   style={pillBtn}>Active 7d only</button>
          <button onClick={selectInactive} style={pillBtn}>Inactive only</button>
          <button onClick={selectNone}     style={pillBtn}>Clear</button>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name / owner / @bot…"
            style={{ marginLeft: 'auto', minWidth: 200, border: '1px solid #E8DFD0', borderRadius: 4, padding: '6px 10px', fontSize: 12, background: '#FBF6EC', fontFamily: 'inherit' }}
          />
        </div>

        {/* Recipient list */}
        <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto', border: '1px solid #E8DFD0', borderRadius: 4 }}>
          {loadingList && (
            <div style={{ padding: 24, textAlign: 'center', color: '#8A7560', fontFamily: SERIF, fontStyle: 'italic' }}>Loading owners…</div>
          )}
          {!loadingList && filteredRecipients.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#8A7560', fontFamily: SERIF, fontStyle: 'italic' }}>
              {search ? 'No owners match this search.' : 'No owners in this segment.'}
            </div>
          )}
          {!loadingList && filteredRecipients.map(r => {
            const checked = selectedIds.has(r.id);
            const isOpted = r.opted_out;
            return (
              <label key={r.id} style={{
                display: 'grid', gridTemplateColumns: '20px 1fr auto', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderBottom: '1px solid #F5EFE2',
                cursor: isOpted ? 'not-allowed' : 'pointer',
                opacity: isOpted ? 0.5 : 1,
                background: checked ? 'rgba(139,46,31,0.05)' : 'transparent',
              }}>
                <input
                  type="checkbox" checked={checked} disabled={isOpted}
                  onChange={() => !isOpted && toggleOne(r.id)}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: '#1A0F08', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                    {isOpted && <span style={{ marginLeft: 6, fontSize: 10, color: '#B23A1F', fontStyle: 'normal' }}>(opted out)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8A7560', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.owner_name || '—'}
                    {' · '}
                    {r.telegram_bot_username
                      ? <span>@{r.telegram_bot_username}</span>
                      : r.shop_code
                        ? <span>🛍️ shop_{r.shop_code}</span>
                        : <span style={{ color: '#B23A1F' }}>no bot</span>}
                    {' · '}
                    <span>{r.product_count} prod</span>
                    {' · '}
                    <span>{r.document_count} docs</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    display: 'inline-block', fontSize: 10, padding: '2px 7px', borderRadius: 999,
                    background: r.is_active_7d ? 'rgba(63,93,63,0.15)' : 'rgba(138,117,96,0.15)',
                    color:       r.is_active_7d ? '#3F5D3F'           : '#8A7560',
                    fontFamily: MONO, letterSpacing: '0.05em',
                  }}>{r.is_active_7d ? 'ACTIVE' : 'IDLE'}</div>
                  <div style={{ fontSize: 10, color: '#8A7560', marginTop: 2 }}>{relTime(r.last_active_at)}</div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Templates */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Start from a template</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TEMPLATES.map((t, i) => (
            <button key={i} onClick={() => setMessage(t.text)} style={{
              appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid #E8DFD0', background: '#FBF6EC',
              color: '#3D2817', padding: '8px 12px', borderRadius: 4, fontSize: 13,
              textAlign: 'left',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>Message</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: message.length > 3800 ? '#B23A1F' : '#8A7560' }}>
            {message.length} / 3800
          </div>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Write your announcement. Markdown supported (*bold*, _italic_). A 'Reply STOP' footer is appended automatically."
          style={{
            width: '100%', minHeight: 220, padding: 12, fontSize: 13,
            border: '1px solid #E8DFD0', borderRadius: 4, background: '#FBF6EC',
            fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            color: '#1A0F08',
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#3D2817', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeButton} onChange={e => setIncludeButton(e.target.checked)} />
          Include an "📱 Open MiniMe" button at the bottom
        </label>
      </div>

      {/* Preview */}
      {message.trim() && (
        <div style={{ background: '#F5EFE2', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 8 }}>Preview (what owners will see)</div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 8, padding: 14, fontSize: 14, color: '#1A0F08', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, color: '#1A0F08', marginBottom: 6 }}>Hi <span style={{ color: '#8A7560' }}>[Owner's first name]</span>,</div>
            {message}
            <div style={{ marginTop: 12, fontSize: 12, color: '#8A7560', fontStyle: 'italic' }}>
              — MiniMe · Reply STOP if you don't want these updates.
            </div>
            {includeButton && (
              <div style={{ marginTop: 12 }}>
                <span style={{ display: 'inline-block', background: '#229ED9', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 12 }}>📱 Open MiniMe</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Send */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={send}
          disabled={sending || !message.trim() || selectedCount === 0}
          style={{
            appearance: 'none', border: 'none', fontFamily: 'inherit', cursor: sending || !message.trim() || selectedCount === 0 ? 'default' : 'pointer',
            background: sending || !message.trim() || selectedCount === 0 ? '#C7B79A' : '#8B2E1F',
            color: '#FFFFFF', padding: '12px 24px', borderRadius: 4, fontSize: 14, fontWeight: 600,
          }}>
          {sending ? 'Sending…' : `Send to ${selectedCount} owner${selectedCount === 1 ? '' : 's'}`}
        </button>
        {err && <span style={{ color: '#B23A1F', fontSize: 13 }}>{err}</span>}
        {result && (
          <span style={{ color: '#3F5D3F', fontSize: 13 }}>
            ✓ Sent {result.sent} · Failed {result.failed}
            {result.blocked > 0 && ` · Blocked ${result.blocked} (auto opted-out)`}
            {' '}· Total {result.total}
            {result.aborted_flood_wait && <span style={{ color: '#B23A1F' }}> · ⚠ stopped early: Telegram flood limit</span>}
          </span>
        )}
      </div>
    </div>
  );
}

const pillBtn = {
  appearance: 'none', cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid #E8DFD0', background: '#FBF6EC',
  color: '#3D2817', padding: '5px 11px', borderRadius: 999, fontSize: 11,
};

// ────────────────────────────── Connected Bots ───────────────────────────────
function BotsPanel({ bots, loading, onRefresh, onPick, businesses, initData }) {
  const [filter, setFilter] = useState('all');
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

  async function repairWebhooks(ids) {
    if (!ids.length) return;
    const label = ids.length === 1 ? 'this bot' : `${ids.length} broken bots`;
    if (!confirm(`Re-register Telegram webhooks for ${label}?`)) return;
    setRepairing(true);
    setRepairResult(null);
    try {
      const r = await fetch('/api/admin/reregister-webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ business_ids: ids }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'webhook repair failed');
      setRepairResult(j);
      await onRefresh?.();
    } catch (e) {
      setRepairResult({ error: e.message });
    } finally {
      setRepairing(false);
    }
  }

  if (loading || !bots) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 60, color: '#8A7560' }}>
        <div style={{ fontSize: 32 }}>🔄</div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18 }}>Checking webhooks…</div>
        <div style={{ fontFamily: MONO, fontSize: 11 }}>Pinging Telegram API for each bot</div>
      </div>
    );
  }

  const filtered = bots.filter(b => {
    if (filter === 'healthy')  return b.webhook.healthy;
    if (filter === 'broken')   return !b.webhook.healthy;
    if (filter === 'active')   return b.stats.messages_day > 0;
    if (filter === 'silent')   return b.stats.messages_week === 0;
    if (filter === 'panic')    return b.panic_mode;
    return true;
  });

  const healthyCount = bots.filter(b => b.webhook.healthy).length;
  const brokenCount  = bots.length - healthyCount;
  const activeToday  = bots.filter(b => b.stats.messages_day > 0).length;
  const brokenIds = bots.filter(b => !b.webhook.healthy).map(b => b.id);

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total bots', value: bots.length, accent: '#1A0F08' },
          { label: 'Webhook OK', value: healthyCount, accent: '#5A7A3F' },
          { label: 'Webhook broken', value: brokenCount, accent: brokenCount > 0 ? '#B23A1F' : '#8A7560' },
          { label: 'Active today', value: activeToday, accent: '#8B2E1F' },
        ].map((c, i) => (
          <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: '12px 16px', minWidth: 100 }}>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560' }}>{c.label}</div>
            <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: c.accent, lineHeight: 1, marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
        <button onClick={onRefresh} style={{ ...btnGhost, marginLeft: 'auto', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6 }}>
          ↻ Refresh
        </button>
        <button
          onClick={() => repairWebhooks(brokenIds)}
          disabled={repairing || !brokenIds.length}
          style={{ ...btnGhost, alignSelf: 'center', opacity: repairing || !brokenIds.length ? 0.55 : 1, borderColor: brokenIds.length ? '#B23A1F' : '#E8DFD0', color: brokenIds.length ? '#B23A1F' : '#8A7560' }}
        >
          {repairing ? 'Repairing...' : `Repair broken (${brokenIds.length})`}
        </button>
      </div>

      {repairResult && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 4, border: `1px solid ${repairResult.error ? 'rgba(178,58,31,0.3)' : 'rgba(90,122,63,0.25)'}`, background: repairResult.error ? 'rgba(178,58,31,0.06)' : 'rgba(90,122,63,0.07)', color: repairResult.error ? '#B23A1F' : '#3F5D3F', fontSize: 12 }}>
          {repairResult.error
            ? `Webhook repair failed: ${repairResult.error}`
            : `Webhook repair done: ${repairResult.ok} ok, ${repairResult.failed} failed, ${repairResult.skipped} skipped.`}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['all','All'],['healthy','✅ Healthy'],['broken','❌ Broken'],['active','⚡ Active today'],['silent','😶 Silent 7d'],['panic','🔴 Panic']].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            appearance: 'none', border: '1px solid ' + (filter === k ? '#8B2E1F' : '#E8DFD0'),
            background: filter === k ? '#8B2E1F' : 'transparent',
            color: filter === k ? '#FFFFFF' : '#8A7560',
            padding: '5px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>{l}</button>
        ))}
      </div>

      {/* Bot cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(b => {
          const wh = b.webhook;
          const msgsWeek = b.stats.messages_week;
          const msgsDay  = b.stats.messages_day;
          const lastMsg  = b.stats.last_message_at;

          return (
            <div key={b.id} style={{
              background: '#FFFFFF', border: `1px solid ${wh.healthy ? '#E8DFD0' : '#F5D0C8'}`,
              borderRadius: 4, padding: '14px 16px',
              borderLeft: `3px solid ${b.panic_mode ? '#B23A1F' : wh.healthy ? '#5A7A3F' : '#D9A441'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                {/* Bot identity */}
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: b.panic_mode ? '#B23A1F' : wh.healthy ? '#5A7A3F' : '#D9A441',
                    }} />
                    <span style={{ fontFamily: SERIF, fontSize: 16, fontStyle: 'italic', color: '#1A0F08' }}>{b.name}</span>
                    {b.panic_mode && <span style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(178,58,31,0.12)', color: '#B23A1F', borderRadius: 3, fontFamily: MONO }}>PANIC</span>}
                  </div>
                  {b.telegram_bot_username ? (
                    <a href={`https://t.me/${b.telegram_bot_username}`} target="_blank" rel="noreferrer"
                      style={{ fontFamily: MONO, fontSize: 12, color: '#8B2E1F', textDecoration: 'none' }}>
                      @{b.telegram_bot_username} ↗
                    </a>
                  ) : (
                    <span style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>no username</span>
                  )}
                  <div style={{ fontSize: 11, color: '#8A7560', marginTop: 3 }}>{b.owner_name} · #{b.owner_telegram_id}</div>
                </div>

                {/* Activity */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: MONO, fontSize: 18, color: msgsDay > 0 ? '#3F5D3F' : '#8A7560' }}>{msgsDay}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', color: '#8A7560', textTransform: 'uppercase' }}>msgs today</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: MONO, fontSize: 18, color: msgsWeek > 0 ? '#1A0F08' : '#8A7560' }}>{msgsWeek}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', color: '#8A7560', textTransform: 'uppercase' }}>msgs 7d</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560' }}>{timeAgo(lastMsg)}</div>
                    <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: '0.1em', color: '#8A7560', textTransform: 'uppercase' }}>last msg</div>
                  </div>
                </div>

                {/* Webhook status */}
                <div style={{ flex: '0 0 auto', background: wh.healthy ? 'rgba(90,122,63,0.07)' : 'rgba(217,164,65,0.1)', border: `1px solid ${wh.healthy ? 'rgba(90,122,63,0.2)' : 'rgba(217,164,65,0.3)'}`, borderRadius: 4, padding: '8px 12px', minWidth: 160 }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: wh.healthy ? '#5A7A3F' : '#8B6508', marginBottom: 4 }}>
                    {wh.healthy ? '✓ Webhook OK' : '⚠ Webhook issue'}
                  </div>
                  {wh.pending > 0 && (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: '#8B6508' }}>{wh.pending} pending updates</div>
                  )}
                  {wh.lastError && (
                    <div style={{ fontSize: 10, color: '#B23A1F', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={wh.lastError}>
                      {wh.lastError}
                    </div>
                  )}
                  {!wh.healthy && wh.error && (
                    <div style={{ fontSize: 10, color: '#8A7560', marginTop: 2 }}>{wh.error}</div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <button
                    onClick={() => {
                      const biz = businesses?.find(biz => biz.id === b.id);
                      if (biz) onPick(biz);
                    }}
                    style={{ ...btnGhost, fontSize: 12 }}
                  >
                    Manage ›
                  </button>
                  {!wh.healthy && (
                    <button
                      onClick={() => repairWebhooks([b.id])}
                      disabled={repairing}
                      style={{ ...btnGhost, fontSize: 12, color: '#B23A1F', borderColor: 'rgba(178,58,31,0.35)', opacity: repairing ? 0.55 : 1 }}
                    >
                      Repair
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!filtered.length && (
          <div style={{ padding: 40, textAlign: 'center', color: '#8A7560', fontFamily: SERIF, fontStyle: 'italic' }}>
            No bots match this filter.
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── Files panel ──────────────────────────────────
function FilesPanel({ files }) {
  const [q, setQ] = useState('');
  if (!files) return <Skeleton />;
  const filtered = files.filter(f => !q || `${f.file_name} ${f.business_name} ${f.customer_name}`.toLowerCase().includes(q.toLowerCase()));
  const images = filtered.filter(f => (f.file_type || '').startsWith('image/'));
  const others  = filtered.filter(f => !(f.file_type || '').startsWith('image/'));

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: 16 }}>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search files, business, client…"
          style={{ width: '100%', border: '1px solid #E8DFD0', borderRadius: 4, padding: '10px 14px', fontSize: 13, background: '#FBF6EC', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>

      {!filtered.length && (
        <div style={{ padding: 40, textAlign: 'center', color: '#8A7560', fontFamily: SERIF, fontStyle: 'italic' }}>
          No files received yet.
        </div>
      )}

      {images.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Images ({images.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {images.map((f, i) => (
              <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, overflow: 'hidden' }}>
                <a href={f.file_url} target="_blank" rel="noreferrer">
                  <img src={f.file_url} alt={f.file_name} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                </a>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#1A0F08', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name || 'Image'}</div>
                  <div style={{ fontSize: 10, color: '#8A7560', marginTop: 2 }}>{f.business_name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: '#8A7560', marginTop: 1 }}>{f.customer_name}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Documents & files ({others.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FBF6EC', borderBottom: '1px solid #E8DFD0' }}>
                {['File', 'Business', 'Client', 'Type', 'Received', ''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '8px 12px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#8A7560', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {others.map((f, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #E8DFD0' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>
                        {(f.file_type || '').includes('pdf') ? '📄' : (f.file_type || '').includes('audio') ? '🎵' : '📎'}
                      </span>
                      <span style={{ fontSize: 13, color: '#1A0F08', fontFamily: SERIF, fontStyle: 'italic' }}>{f.file_name || 'Attachment'}</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#3D2817' }}>{f.business_name || '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#3D2817' }}>{f.customer_name || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: MONO, fontSize: 10, color: '#8A7560' }}>{f.file_type || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: MONO, fontSize: 10, color: '#8A7560' }}>{timeAgo(f.created_at)}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {f.file_url && (
                      <a href={f.file_url} target="_blank" rel="noreferrer" style={{ color: '#8B2E1F', fontSize: 12, textDecoration: 'none' }}>Open ↗</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Email integration ────────────────────────────
function EmailIntegration() {
  const [tab, setTab] = useState('setup'); // 'setup' | 'inbox'
  const integrations = [
    { name: 'Gmail', icon: '📧', status: 'coming_soon', desc: 'Connect Gmail to handle customer emails with MiniMe' },
    { name: 'Outlook', icon: '📨', status: 'coming_soon', desc: 'Connect Microsoft Outlook / Office 365' },
    { name: 'Custom IMAP', icon: '🔌', status: 'coming_soon', desc: 'Connect any email server via IMAP/SMTP' },
  ];

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 24, marginBottom: 16 }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 400, color: '#1A0F08', marginBottom: 8 }}>Email Integration</div>
        <p style={{ fontSize: 14, color: '#8A7560', lineHeight: 1.6, marginBottom: 0 }}>
          Connect your business email so MiniMe can read incoming emails and draft replies — just like it does with Telegram messages.
          Available in the next platform update.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {integrations.map((intg, i) => (
          <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, opacity: 0.75 }}>
            <span style={{ fontSize: 32 }}>{intg.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, fontStyle: 'italic', color: '#1A0F08' }}>{intg.name}</div>
              <div style={{ fontSize: 12, color: '#8A7560', marginTop: 3 }}>{intg.desc}</div>
            </div>
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: '#8A7560',
              padding: '4px 10px', border: '1px solid #E8DFD0', borderRadius: 999,
            }}>Coming soon</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, background: 'rgba(61,40,23,0.04)', border: '1px solid #E8DFD0', borderRadius: 4, padding: 16 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 8 }}>How it will work</div>
        {[
          '1. Connect your email account (OAuth / IMAP)',
          '2. MiniMe reads new emails and identifies customer inquiries',
          '3. AI drafts a reply in your voice — you approve before it sends',
          '4. All email threads appear alongside your Telegram conversations',
        ].map((step, i) => (
          <div key={i} style={{ fontSize: 13, color: '#3D2817', padding: '5px 0', display: 'flex', gap: 10 }}>
            <span style={{ color: '#8A7560' }}>→</span> {step}
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────── Platform health ──────────────────────────────
function PlatformHealth({ overview, initData }) {
  const [hasab, setHasab] = useState(null);         // null | 'checking' | { ok, latencyMs, reply, error }
  const [hasabTest, setHasabTest] = useState({ message: 'Hello, how are you?', model: 'hasab-1-lite', temperature: 0.7, max_tokens: 2048 });
  const [hasabResult, setHasabResult] = useState(null);
  const [hasabBusy, setHasabBusy] = useState(false);

  async function checkHasab() {
    setHasab('checking');
    try {
      const r = await fetch('/api/admin/hasab-test', { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setHasab(j);
    } catch (e) { setHasab({ ok: false, error: e.message }); }
  }

  async function sendHasabTest() {
    setHasabBusy(true); setHasabResult(null);
    try {
      const r = await fetch('/api/admin/hasab-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ ...hasabTest, stream: false, tools: null }),
      });
      const j = await r.json();
      setHasabResult(j);
    } catch (e) { setHasabResult({ ok: false, error: e.message }); }
    finally { setHasabBusy(false); }
  }

  const items = [
    { name: 'Auto-learn cron (nightly)', ok: (overview?.totals?.lessons_week || 0) > 0 || (overview?.totals?.messages_week || 0) === 0, note: `${overview?.totals?.lessons_week ?? 0} lessons mined this week` },
    { name: 'Webhook ingestion', ok: (overview?.totals?.messages_week || 0) > 0 || (overview?.totals?.linked || 0) === 0, note: `${overview?.totals?.messages_week ?? 0} messages this week` },
    { name: 'Order pipeline', ok: true, note: `${overview?.totals?.orders_week ?? 0} orders, ${overview?.totals?.revenue_etb_week?.toLocaleString() ?? 0} ETB this week` },
    { name: 'Linked bots', ok: true, note: `${overview?.totals?.linked ?? 0} of ${overview?.totals?.businesses ?? 0} businesses` },
    { name: 'Hasab AI', ok: hasab && hasab !== 'checking' ? hasab.ok : null, note: hasab === 'checking' ? 'Checking…' : hasab ? (hasab.ok ? `${hasab.latencyMs}ms · ${hasab.model || 'hasab-1-lite'}` : hasab.error || 'connection failed') : 'Not checked yet' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid #E8DFD0' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: it.ok === null ? '#E8DFD0' : it.ok ? '#5A7A3F' : '#B23A1F' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, fontStyle: 'italic', color: '#1A0F08' }}>{it.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560', marginTop: 2 }}>{it.note}</div>
            </div>
            {it.name === 'Hasab AI' ? (
              <button onClick={checkHasab} disabled={hasab === 'checking'} style={{ ...btnGhost, fontSize: 11 }}>
                {hasab === 'checking' ? 'Checking…' : hasab ? '↻ Recheck' : 'Check'}
              </button>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', color: it.ok ? '#5A7A3F' : '#B23A1F', textTransform: 'uppercase' }}>{it.ok ? 'OK' : 'CHECK'}</span>
            )}
          </div>
        ))}
      </div>

      {/* Hasab AI test console */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 20 }}>
        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 14 }}>Hasab AI test console</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <select
            value={hasabTest.model}
            onChange={e => setHasabTest(t => ({ ...t, model: e.target.value }))}
            style={{ ...selectStyle, minWidth: 160 }}
          >
            <option value="hasab-1-lite">hasab-1-lite</option>
            <option value="hasab-1-main">hasab-1-main</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3D2817' }}>
            temp
            <input
              type="number" min="0" max="1" step="0.1"
              value={hasabTest.temperature}
              onChange={e => setHasabTest(t => ({ ...t, temperature: Number(e.target.value) }))}
              style={{ ...selectStyle, width: 60 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3D2817' }}>
            max_tokens
            <input
              type="number" min="64" max="4096" step="64"
              value={hasabTest.max_tokens}
              onChange={e => setHasabTest(t => ({ ...t, max_tokens: Number(e.target.value) }))}
              style={{ ...selectStyle, width: 80 }}
            />
          </label>
        </div>

        {/* Request preview */}
        <div style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560', marginBottom: 6 }}>Request body preview</div>
        <pre style={{ background: '#FBF6EC', border: '1px solid #E8DFD0', borderRadius: 4, padding: '10px 12px', fontSize: 11, fontFamily: MONO, color: '#1A0F08', overflow: 'auto', margin: '0 0 12px' }}>
{JSON.stringify({ message: hasabTest.message, model: hasabTest.model, temperature: hasabTest.temperature, max_tokens: hasabTest.max_tokens, stream: false, tools: null }, null, 2)}
        </pre>

        <textarea
          value={hasabTest.message}
          onChange={e => setHasabTest(t => ({ ...t, message: e.target.value }))}
          rows={3}
          placeholder="Enter a message to send to Hasab…"
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E8DFD0', borderRadius: 4, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', background: '#FBF6EC', marginBottom: 10 }}
        />
        <button
          onClick={sendHasabTest}
          disabled={hasabBusy || !hasabTest.message.trim()}
          style={{ ...btnGhost, background: '#1A0F08', color: '#FBF6EC', border: 'none', opacity: hasabBusy ? 0.6 : 1 }}
        >
          {hasabBusy ? 'Sending…' : 'Send to Hasab'}
        </button>

        {hasabResult && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: hasabResult.ok ? 'rgba(90,122,63,0.06)' : 'rgba(178,58,31,0.06)', border: `1px solid ${hasabResult.ok ? 'rgba(90,122,63,0.2)' : 'rgba(178,58,31,0.2)'}`, borderRadius: 4 }}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.13em', textTransform: 'uppercase', color: hasabResult.ok ? '#5A7A3F' : '#B23A1F', marginBottom: 8 }}>
              {hasabResult.ok ? `Response · ${hasabResult.tokensUsed} tokens` : 'Error'}
            </div>
            <div style={{ fontSize: 13, color: '#1A0F08', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {hasabResult.ok ? hasabResult.content : hasabResult.error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────── Sub-admins section ──────────────────────────
function SubAdminsSection({ businessId, business, initData }) {
  const [ids, setIds] = useState(business.sub_admin_telegram_ids || []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    const tid = parseInt(input.trim(), 10);
    if (!Number.isFinite(tid) || tid <= 0) { setErr('Enter a valid Telegram numeric ID'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}/sub-admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ telegram_id: tid }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setIds(j.sub_admin_telegram_ids);
      setInput('');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove(tid) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}/sub-admins`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ telegram_id: tid }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setIds(j.sub_admin_telegram_ids);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Section title="Sub-admins">
      <p style={{ fontSize: 12, color: '#8A7560', margin: '0 0 12px', lineHeight: 1.5 }}>
        Sub-admins can access MiniMe (teach, conversations, advisor) for this business but cannot change settings or billing.
      </p>
      {ids.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {ids.map(tid => (
            <div key={tid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#FBF6EC', border: '1px solid #E8DFD0', borderRadius: 4 }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: '#3D2817' }}>#{tid}</span>
              <button onClick={() => remove(tid)} disabled={busy} style={{ appearance: 'none', border: 'none', background: 'transparent', color: '#B23A1F', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#8A7560', fontStyle: 'italic', fontFamily: SERIF, marginBottom: 12 }}>No sub-admins yet.</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !busy && add()}
          placeholder="Telegram user ID (numeric)"
          style={{ flex: 1, border: '1px solid #E8DFD0', borderRadius: 4, padding: '6px 10px', fontSize: 13, background: '#FFFFFF', fontFamily: 'inherit' }}
        />
        <button onClick={add} disabled={busy || !input.trim()} style={{ ...btnGhost, background: '#1A0F08', color: '#FBF6EC', border: 'none', opacity: busy || !input.trim() ? 0.5 : 1 }}>
          Add
        </button>
      </div>
      {err && <div style={{ fontSize: 12, color: '#B23A1F', marginTop: 8 }}>{err}</div>}
    </Section>
  );
}

// ────────────────────────────── helpers ──────────────────────────────
const selectStyle = { border: '1px solid #E8DFD0', borderRadius: 4, padding: '5px 8px', fontSize: 13, background: '#FFFFFF', fontFamily: 'inherit' };
const btnGhost = { appearance: 'none', border: '1px solid #E8DFD0', background: 'transparent', color: '#3D2817', padding: '7px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 8 }}>{title}</div>
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 12 }}>{children}</div>
    </section>
  );
}
function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
      <span style={{ fontSize: 13, color: '#3D2817' }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}
function Toggle({ on, onChange, disabled, danger }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} disabled={disabled} style={{
      appearance: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
      width: 38, height: 22, borderRadius: 999, position: 'relative',
      background: on ? (danger ? '#B23A1F' : '#5A7A3F') : '#E8DFD0',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF', transition: 'left 0.15s' }} />
    </button>
  );
}
function Skeleton() {
  return <div style={{ height: 200, background: '#F5EFE2', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />;
}
function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

// ─── Pending payments review ─────────────────────────────────────────────────
function PendingPaymentsSection({ payments, initData, onRefresh }) {
  const [busy, setBusy] = useState(null);
  const [zoomImg, setZoomImg] = useState(null);

  async function decide(businessId, action) {
    setBusy(businessId);
    try {
      const r = await fetch(`/api/admin/businesses/${businessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(action === 'approve'
          ? { subscription_status: 'active', payment_verified: true, plan_tier: 'pro', subscription_plan: 'pro' }
          : { subscription_status: 'cancelled', payment_verified: false }
        ),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'patch failed');
      onRefresh?.();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally { setBusy(null); }
  }

  return (
    <div style={{ background: 'rgba(217,164,65,0.08)', border: '2px solid rgba(217,164,65,0.4)', borderRadius: 6, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8B6508' }}>Pending payment review</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: '#1A0F08', marginTop: 4 }}>
            {payments.length} payment{payments.length !== 1 ? 's' : ''} awaiting your action
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {payments.map(p => {
          const isAnnualReview = p.subscription_status === 'pending_review';
          return (
            <div key={p.id} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
              {p.payment_proof_url && (
                <img
                  src={p.payment_proof_url}
                  alt="proof"
                  onClick={() => setZoomImg(p.payment_proof_url)}
                  style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in', border: '1px solid #E8DFD0' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, color: '#1A0F08' }}>{p.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560', marginTop: 2 }}>
                  {p.payment_method || '?'} · {p.payment_ref || '—'} · {timeAgo(p.created_at)} ago
                  {isAnnualReview && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'rgba(217,164,65,0.2)', borderRadius: 3, color: '#8B6508' }}>ANNUAL</span>}
                  {!isAnnualReview && !p.payment_verified && <span style={{ marginLeft: 8, padding: '1px 6px', background: 'rgba(79,163,138,0.15)', borderRadius: 3, color: '#1E6B58' }}>AUTO-ACTIVATED</span>}
                </div>
                {p.payment_notes && (
                  <div style={{ fontSize: 11, color: '#8A7560', marginTop: 3, fontStyle: 'italic' }}>{p.payment_notes.slice(0, 120)}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {isAnnualReview ? (
                  <>
                    <button disabled={busy === p.id} onClick={() => decide(p.id, 'approve')} style={{ appearance: 'none', cursor: busy === p.id ? 'default' : 'pointer', background: '#5A7A3F', color: '#FFFFFF', border: 'none', borderRadius: 4, padding: '8px 14px', fontFamily: MONO, fontSize: 12 }}>
                      ✓ Approve
                    </button>
                    <button disabled={busy === p.id} onClick={() => decide(p.id, 'reject')} style={{ appearance: 'none', cursor: busy === p.id ? 'default' : 'pointer', background: '#FFFFFF', color: '#B23A1F', border: '1px solid #B23A1F', borderRadius: 4, padding: '8px 14px', fontFamily: MONO, fontSize: 12 }}>
                      ✗ Reject
                    </button>
                  </>
                ) : (
                  <button disabled={busy === p.id} onClick={() => { if (confirm(`Revoke ${p.name}'s subscription? They claimed to pay but the screenshot looks suspicious.`)) decide(p.id, 'reject'); }} style={{ appearance: 'none', cursor: busy === p.id ? 'default' : 'pointer', background: '#FFFFFF', color: '#B23A1F', border: '1px solid rgba(178,58,31,0.4)', borderRadius: 4, padding: '8px 14px', fontFamily: MONO, fontSize: 11 }}>
                    ↩ Revoke
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Screenshot zoom modal */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
        }}>
          <img src={zoomImg} alt="proof" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 4 }} />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Business AI Advisor ──────────────────────────
// Deep-analysis component inside the BusinessDrawer.
// Runs the full advisor pipeline on demand and shows the analysis inline.
function BusinessAdvisor({ businessId, initData, businessName }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [question, setQuestion] = useState('');

  async function runAnalysis(q) {
    setLoading(true); setErr(''); setAnalysis(null);
    try {
      const r = await fetch('/api/admin/businesses/' + businessId + '/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ question: q || 'Full business health check — strengths, risks, and 3 concrete actions for this week.' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Analysis failed');
      setAnalysis(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  const presets = [
    'Full health check — strengths, risks, top 3 actions this week',
    'Which customers are at risk of churning?',
    'How is the AI performing? Where does it struggle?',
    'Revenue analysis — what\'s selling, what\'s stalling?',
    'What should this owner focus on in the next 7 days?',
  ];

  return (
    <Section title="🧠 AI Deep Analysis">
      <div style={{ fontSize: 11, color: '#8A7560', marginBottom: 10, fontFamily: MONO }}>
        Ask anything about {businessName}. Reads live data: clients, orders, jobs, feedback, agent activity.
      </div>

      {/* Preset questions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {presets.map(p => (
          <button key={p} onClick={() => runAnalysis(p)} disabled={loading} style={{
            fontSize: 10.5, fontFamily: MONO, padding: '4px 9px', borderRadius: 4, cursor: loading ? 'default' : 'pointer',
            background: '#F9F5EF', border: '1px solid #E8DFD0', color: '#5C4520',
          }}>
            {p.slice(0, 45)}{p.length > 45 ? '…' : ''}
          </button>
        ))}
      </div>

      {/* Custom question */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && question.trim() && runAnalysis(question.trim())}
          placeholder="Ask anything about this business…"
          style={{ flex: 1, fontFamily: MONO, fontSize: 12, border: '1px solid #E8DFD0', borderRadius: 4, padding: '6px 10px', background: '#FEFCF9', outline: 'none' }}
        />
        <button onClick={() => question.trim() && runAnalysis(question.trim())} disabled={loading || !question.trim()} style={{
          fontFamily: MONO, fontSize: 12, padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
          background: '#1A0F08', color: '#FBF6EC', border: 'none',
        }}>
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: '#B23A1F', background: 'rgba(178,58,31,0.08)', padding: 8, borderRadius: 4, marginBottom: 8 }}>{err}</div>}

      {loading && (
        <div style={{ fontSize: 12, fontFamily: MONO, color: '#8A7560', padding: '12px 0' }}>
          🧠 Analysing {businessName}…
        </div>
      )}

      {analysis && (
        <div>
          <div style={{ fontSize: 12, fontFamily: MONO, color: '#8A7560', marginBottom: 8 }}>
            Analysed in {analysis.latency_ms}ms · {analysis.tokens} tokens · ${analysis.cost_usd?.toFixed(4)}
          </div>
          <div style={{
            background: '#FEFCF9', border: '1px solid #E8DFD0', borderRadius: 6, padding: 14,
            fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: '#2A1F14',
          }}>
            {analysis.response}
          </div>
          {analysis.suggested_actions?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10.5, fontFamily: MONO, color: '#8A7560', marginBottom: 6 }}>SUGGESTED ACTIONS</div>
              {analysis.suggested_actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: '#D4A847', fontWeight: 700 }}>{i + 1}.</span>
                  <span>{a.label || a}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ────────────────────────────── LLM Analytics panel ──────────────────────────
// ─────────────────────── Unit economics (founder view) ───────────────────────
// The three investor metrics joined per merchant: quality (auto-send accuracy),
// ROI (paid GMV in birr), and cost (LLM $). Plus margin flags.
function UnitEconomics({ initData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  async function load(d) {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/unit-economics?days=${d || days}`, {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setData(j);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (initData) load(); }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

  const T = {
    label: { fontFamily: MONO, fontSize: 9, textTransform: 'uppercase', color: '#8A7560', letterSpacing: '0.1em' },
    val:   { fontFamily: SERIF, fontStyle: 'italic', fontSize: 24, marginTop: 4, color: '#1A0F08' },
    sub:   { fontFamily: MONO, fontSize: 10, color: '#8A7560', marginTop: 2 },
    card:  { background: '#FEFCF9', border: '1px solid #E8DFD0', borderRadius: 6, padding: 12 },
    th:    { textAlign: 'left', padding: '4px 8px', fontFamily: MONO, fontSize: 10, color: '#8A7560' },
    td:    { padding: '5px 8px', fontSize: 12, fontFamily: MONO, borderBottom: '1px solid #F5EFE6' },
  };

  const FLAG_LABEL = {
    upside_down: ['Upside-down', '#B23A1F'],
    zero_gmv:    ['Zero GMV', '#8B6F1F'],
    low_quality: ['High edits', '#8B2E1F'],
    no_autosend: ['No auto-send', '#5C4520'],
  };

  const t = data?.totals;
  const rows = (data?.merchants || []).filter(r => !onlyFlagged || r.flags.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22 }}>Unit Economics</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560', marginTop: 2 }}>
            Quality · ROI · Cost per merchant {t ? `· FX ${t.fx_birr_per_usd} birr/$` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => { setDays(d); load(d); }} style={{
              fontFamily: MONO, fontSize: 11, padding: '4px 10px',
              border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer',
              background: days === d ? '#1A0F08' : '#FEFCF9',
              color: days === d ? '#FBF6EC' : '#3D2817',
            }}>{d}d</button>
          ))}
          <button onClick={() => load()} disabled={loading} style={{
            fontFamily: MONO, fontSize: 11, padding: '4px 10px',
            border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer', background: '#FEFCF9',
          }}>{loading ? '…' : '↻'}</button>
        </div>
      </div>

      {loading && !data && <p style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>Loading…</p>}

      {t && (
        <>
          {/* The three headline metrics + blended economics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={T.card}>
              <div style={T.label}>Quality (auto-send)</div>
              <div style={{ ...T.val, color: t.quality_pct == null ? '#8A7560' : t.quality_pct >= 70 ? '#1A0F08' : '#B23A1F' }}>
                {t.quality_pct == null ? '—' : `${t.quality_pct}%`}
              </div>
              <div style={T.sub}>sent without owner edit · {t.ai_sent}/{t.ai_total} replies</div>
            </div>
            <div style={T.card}>
              <div style={T.label}>GMV (AI-handled)</div>
              <div style={T.val}>{t.gmv_birr.toLocaleString()} br</div>
              <div style={T.sub}>{t.gmv_per_active_birr.toLocaleString()} br / active merchant</div>
            </div>
            <div style={T.card}>
              <div style={T.label}>Cost / active merchant</div>
              <div style={T.val}>${t.cost_per_active_usd}</div>
              <div style={T.sub}>{t.cost_per_active_birr.toLocaleString()} br · ${t.cost_usd} total</div>
            </div>
            <div style={T.card}>
              <div style={T.label}>Cost per birr of GMV</div>
              <div style={{ ...T.val, color: t.cost_per_birr_gmv == null ? '#8A7560' : t.cost_per_birr_gmv > 0.1 ? '#B23A1F' : '#1A0F08' }}>
                {t.cost_per_birr_gmv == null ? '—' : t.cost_per_birr_gmv}
              </div>
              <div style={T.sub}>lower is better · margin {t.margin_birr.toLocaleString()} br</div>
            </div>
            <div style={T.card}>
              <div style={T.label}>Active merchants</div>
              <div style={T.val}>{t.active_merchants}</div>
              <div style={T.sub}>of {t.total_merchants} total · {t.calls.toLocaleString()} calls</div>
            </div>
          </div>

          {/* Risk flags */}
          {data.flagged && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={T.label}>Flags:</span>
              {[
                ['upside_down', `${data.flagged.upside_down} upside-down`, '#B23A1F'],
                ['zero_gmv', `${data.flagged.zero_gmv} zero-GMV`, '#8B6F1F'],
                ['low_quality', `${data.flagged.low_quality} high-edit`, '#8B2E1F'],
                ['no_autosend', `${data.flagged.no_autosend} no auto-send`, '#5C4520'],
              ].map(([k, label, color]) => (
                <span key={k} style={{ fontFamily: MONO, fontSize: 10, padding: '3px 8px', borderRadius: 4, border: `1px solid ${color}33`, background: `${color}11`, color }}>{label}</span>
              ))}
              <button onClick={() => setOnlyFlagged(v => !v)} style={{
                fontFamily: MONO, fontSize: 10, padding: '3px 10px', marginLeft: 'auto',
                border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer',
                background: onlyFlagged ? '#1A0F08' : '#FEFCF9', color: onlyFlagged ? '#FBF6EC' : '#3D2817',
              }}>{onlyFlagged ? 'Showing flagged' : 'Show only flagged'}</button>
            </div>
          )}

          {/* Per-merchant table */}
          <div>
            <div style={{ ...T.label, marginBottom: 8 }}>Per merchant — {t.period_days}-day period (sorted by GMV)</div>
            {rows.length === 0 && (
              <p style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>No merchants match.</p>
            )}
            {rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E8DFD0' }}>
                      <th style={T.th}>Business</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Quality</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>GMV (br)</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Cost ($)</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>$/br GMV</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Margin (br)</th>
                      <th style={T.th}>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                        <td style={{ ...T.td, color: '#2A1F14', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}{r.plan ? <span style={{ color: '#8A7560' }}> · {r.plan}</span> : null}
                        </td>
                        <td style={{ ...T.td, textAlign: 'right', color: r.quality_pct == null ? '#8A7560' : r.quality_pct >= 70 ? '#2A1F14' : '#B23A1F' }}>
                          {r.quality_pct == null ? '—' : `${r.quality_pct}%`}
                        </td>
                        <td style={{ ...T.td, textAlign: 'right', fontWeight: 600 }}>{r.gmv_birr.toLocaleString()}</td>
                        <td style={{ ...T.td, textAlign: 'right', color: r.cost_usd > 1 ? '#8B2E1F' : '#2A1F14' }}>${r.cost_usd}</td>
                        <td style={{ ...T.td, textAlign: 'right', color: r.cost_per_birr_gmv != null && r.cost_per_birr_gmv > 0.1 ? '#B23A1F' : '#8A7560' }}>
                          {r.cost_per_birr_gmv == null ? '—' : r.cost_per_birr_gmv}
                        </td>
                        <td style={{ ...T.td, textAlign: 'right', color: r.margin_birr < 0 ? '#B23A1F' : '#2A1F14' }}>{r.margin_birr.toLocaleString()}</td>
                        <td style={{ ...T.td }}>
                          {r.flags.map(f => {
                            const [lbl, col] = FLAG_LABEL[f] || [f, '#8A7560'];
                            return <span key={f} style={{ fontFamily: MONO, fontSize: 9, padding: '1px 5px', borderRadius: 3, marginRight: 4, background: `${col}15`, color: col }}>{lbl}</span>;
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LLMAnalytics({ initData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [view, setView] = useState('collective'); // 'collective' | 'individual'

  async function load(d) {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/costs?days=${d || days}`, {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setData(j);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (initData) load(); }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

  const T = {
    label: { fontFamily: MONO, fontSize: 9, textTransform: 'uppercase', color: '#8A7560', letterSpacing: '0.1em' },
    val:   { fontFamily: SERIF, fontStyle: 'italic', fontSize: 24, marginTop: 4, color: '#1A0F08' },
    card:  { background: '#FEFCF9', border: '1px solid #E8DFD0', borderRadius: 6, padding: 12 },
    th:    { textAlign: 'left', padding: '4px 8px', fontFamily: MONO, fontSize: 10, color: '#8A7560' },
    td:    { padding: '5px 8px', fontSize: 12, fontFamily: MONO, borderBottom: '1px solid #F5EFE6' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22 }}>API Cost Analytics</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => { setDays(d); load(d); }} style={{
              fontFamily: MONO, fontSize: 11, padding: '4px 10px',
              border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer',
              background: days === d ? '#1A0F08' : '#FEFCF9',
              color: days === d ? '#FBF6EC' : '#3D2817',
            }}>{d}d</button>
          ))}
          <button onClick={() => load()} disabled={loading} style={{
            fontFamily: MONO, fontSize: 11, padding: '4px 10px',
            border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer', background: '#FEFCF9',
          }}>{loading ? '…' : '↻'}</button>
        </div>
      </div>

      {loading && !data && <p style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>Loading…</p>}

      {data && (
        <>
          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {[
              ['Total spend', `$${data.totals.cost_usd.toFixed(4)}`],
              ['Total calls', data.totals.calls.toLocaleString()],
              ['Prompt tokens', (data.totals.prompt_tokens || 0).toLocaleString()],
              ['Output tokens', (data.totals.completion_tokens || 0).toLocaleString()],
              ['Fail rate', `${data.totals.fail_rate}%`],
              ['Period', `${data.period_days} days`],
            ].map(([k, v]) => (
              <div key={k} style={T.card}>
                <div style={T.label}>{k}</div>
                <div style={{ ...T.val, color: k === 'Fail rate' && data.totals.fail_rate > 5 ? '#B23A1F' : '#1A0F08' }}>{v}</div>
              </div>
            ))}
          </div>

          {/* View toggle */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[['collective', 'By Route'], ['individual', 'By Business']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{
                fontFamily: MONO, fontSize: 11, padding: '5px 12px',
                border: '1px solid #E8DFD0', borderRadius: 4, cursor: 'pointer',
                background: view === k ? '#1A0F08' : '#FEFCF9',
                color: view === k ? '#FBF6EC' : '#3D2817', fontWeight: view === k ? 600 : 400,
              }}>{l}</button>
            ))}
          </div>

          {/* By Route (collective) */}
          {view === 'collective' && data.top_routes?.length > 0 && (
            <div>
              <div style={{ ...T.label, marginBottom: 8 }}>Top routes by cost (platform-wide)</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E8DFD0' }}>
                      <th style={T.th}>Route</th>
                      <th style={T.th}>Model</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Calls</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Cost USD</th>
                      <th style={{ ...T.th, textAlign: 'right' }}>Fail%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_routes.map(r => (
                      <tr key={r.route + r.model}>
                        <td style={{ ...T.td, color: r.fail_rate > 5 ? '#B23A1F' : '#2A1F14' }}>{r.route}</td>
                        <td style={{ ...T.td, color: '#5C4520' }}>{r.model}</td>
                        <td style={{ ...T.td, textAlign: 'right' }}>{r.calls.toLocaleString()}</td>
                        <td style={{ ...T.td, textAlign: 'right', fontWeight: 600 }}>${r.cost_usd}</td>
                        <td style={{ ...T.td, textAlign: 'right', color: r.fail_rate > 5 ? '#B23A1F' : '#8A7560' }}>{r.fail_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By Business (individual) */}
          {view === 'individual' && (
            <div>
              <div style={{ ...T.label, marginBottom: 8 }}>Cost per business — {data.period_days}-day period</div>
              {data.per_business?.length === 0 && (
                <p style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>No logged calls in this period. Make sure openai-wrapper.js is being used with a route name.</p>
              )}
              {data.per_business?.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E8DFD0' }}>
                        <th style={T.th}>Business</th>
                        <th style={{ ...T.th, textAlign: 'right' }}>Calls</th>
                        <th style={{ ...T.th, textAlign: 'right' }}>Tokens</th>
                        <th style={{ ...T.th, textAlign: 'right' }}>Cost USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.per_business.map(b => (
                        <tr key={b.id}>
                          <td style={{ ...T.td, color: '#2A1F14', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name || b.id}</td>
                          <td style={{ ...T.td, textAlign: 'right' }}>{b.calls.toLocaleString()}</td>
                          <td style={{ ...T.td, textAlign: 'right', color: '#8A7560' }}>{(b.tokens || 0).toLocaleString()}</td>
                          <td style={{ ...T.td, textAlign: 'right', fontWeight: 600, color: b.cost_usd > 1 ? '#8B2E1F' : '#2A1F14' }}>${b.cost_usd}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Platform Advisor ────────────────────────────────
const SUGGESTED_QUESTIONS = [
  'Give me a full platform health summary.',
  'Which businesses are at churn risk this week?',
  'Who are the top 5 most active businesses?',
  'Which linked businesses had zero messages this week?',
  'What is the total revenue processed this week?',
  'How many businesses are on trial vs. paid?',
  'Which businesses have panic mode on?',
  'Who signed up this week?',
];

function PlatformAdvisor({ initData }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState(null);

  async function ask(question) {
    if (!question?.trim() || loading) return;
    const q = question.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);
    try {
      const r = await fetch('/api/admin/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ question: q }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Request failed');
      if (j.totals) setTotals(j.totals);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: j.answer,
        meta: { latency: j.latency_ms, tokens: j.tokens, model: j.model, asOf: j.data_as_of },
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${e.message}`, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ background: '#1A0F08', borderRadius: 6, padding: '20px 24px', color: '#FBF6EC' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#A89070', marginBottom: 6 }}>Platform Intelligence</div>
        <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 400, letterSpacing: '-0.025em' }}>MiniMe Advisor</div>
        <p style={{ fontSize: 13, color: '#C4A87A', margin: '6px 0 0', lineHeight: 1.5 }}>
          Ask anything about the platform. Every answer is grounded in live data — no guessing.
        </p>
        {totals && (
          <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            {[
              [`${totals.businesses}`, 'businesses'],
              [`${totals.active7d}`, 'active 7d'],
              [`${(totals.totalMsgs || 0).toLocaleString()}`, 'messages'],
              [`${totals.aiRatePct}%`, 'AI rate'],
              [`${(totals.totalRevenue || 0).toLocaleString()} ETB`, 'revenue'],
              [`${totals.churnRiskCount}`, 'churn risk'],
            ].map(([v, l]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: '#F5E6C8' }}>{v}</div>
                <div style={{ fontSize: 10, color: '#A89070', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested questions */}
      {messages.length === 0 && (
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560', marginBottom: 10 }}>Suggested questions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTED_QUESTIONS.map(q => (
              <button key={q} onClick={() => ask(q)} style={{
                appearance: 'none', border: '1px solid #E8DFD0', background: '#FFFFFF',
                borderRadius: 999, padding: '6px 14px', fontSize: 12.5, cursor: 'pointer',
                color: '#3D2817', fontFamily: 'inherit',
              }}>{q}</button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.role === 'user' ? (
                <div style={{
                  background: '#1A0F08', color: '#FBF6EC', borderRadius: '18px 18px 4px 18px',
                  padding: '10px 16px', maxWidth: '70%', fontSize: 14, lineHeight: 1.45,
                }}>{m.content}</div>
              ) : (
                <div style={{ maxWidth: '85%' }}>
                  <div style={{
                    background: '#FFFFFF', border: `1px solid ${m.error ? '#D9534F' : '#E8DFD0'}`,
                    borderRadius: '4px 18px 18px 18px', padding: '14px 18px',
                    fontSize: 14, lineHeight: 1.6, color: m.error ? '#B23A1F' : '#1A0F08',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{m.content}</div>
                  {m.meta && (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: '#B0987A', marginTop: 5, paddingLeft: 4 }}>
                      {m.meta.model} · {m.meta.tokens} tokens · {m.meta.latency}ms · data as of {new Date(m.meta.asOf).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: '4px 18px 18px 18px', padding: '14px 18px' }}>
                <span style={{ color: '#C4A87A', fontSize: 13 }}>Analyzing platform data…</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', position: 'sticky', bottom: 0, background: '#FBF6EC', paddingTop: 12, paddingBottom: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder="Ask anything about the platform…"
          rows={2}
          style={{
            flex: 1, resize: 'none', border: '1.5px solid #D9CFC0', borderRadius: 12,
            padding: '10px 14px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.45,
            background: '#FFFFFF', color: '#1A0F08', outline: 'none',
          }}
        />
        <button
          onClick={() => ask(input)}
          disabled={loading || !input.trim()}
          style={{
            appearance: 'none', border: 0, borderRadius: 12,
            background: loading || !input.trim() ? '#D9CFC0' : '#1A0F08',
            color: '#FBF6EC', padding: '12px 20px', fontSize: 14, fontWeight: 600,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', height: 46,
          }}
        >{loading ? '…' : 'Ask'}</button>
      </div>
      {messages.length > 0 && (
        <button onClick={() => { setMessages([]); setInput(''); }} style={{
          appearance: 'none', border: 'none', background: 'transparent', cursor: 'pointer',
          fontSize: 12, color: '#8A7560', fontFamily: 'inherit', textAlign: 'center',
        }}>Clear conversation</button>
      )}
    </div>
  );
}

// ─── Platform Feedback Panel ──────────────────────────────────────────────────
function PlatformFeedback({ initData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/platform/feedback', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [initData]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#8A7560' }}>Loading feedback…</div>;
  if (!data) return <div style={{ padding: 40, color: '#8A7560' }}>Could not load feedback (migration may not be run yet)</div>;

  const { total, nps, avg_score, promoters, passives, detractors, by_category, feedback } = data;
  const CAT_COLORS = { bug: '#B85450', feature: '#3498DB', general: '#8A9590', praise: '#27AE60' };
  const CAT_LABELS = { bug: '🐛 Bugs', feature: '✨ Features', general: '💬 General', praise: '🎉 Praise' };

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Platform Feedback</h2>

      {total === 0 ? (
        <div style={{ background: '#FBF8F1', border: '1px solid #E4DED1', borderRadius: 12, padding: 32, textAlign: 'center', color: '#8A7560' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>No feedback yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Users will see a "💬 Feedback" button in their dashboard</div>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Total submissions', value: total },
              { label: 'NPS score', value: nps != null ? nps : '—', sub: `${promoters}P · ${passives}Pa · ${detractors}D` },
              { label: 'Avg score', value: avg_score != null ? avg_score + '/10' : '—' },
              { label: 'Feature requests', value: by_category?.feature || 0 },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ background: '#FBF8F1', border: '1px solid #E4DED1', borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: '#8A7560', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#1A0F08' }}>{value}</div>
                {sub && <div style={{ fontSize: 11, color: '#8A7560', marginTop: 2 }}>{sub}</div>}
              </div>
            ))}
          </div>

          {/* Category breakdown */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
            {Object.entries(by_category || {}).filter(([,v]) => v > 0).map(([k, v]) => (
              <div key={k} style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                background: (CAT_COLORS[k] || '#8A9590') + '18', color: CAT_COLORS[k] || '#8A9590',
              }}>{CAT_LABELS[k] || k}: {v}</div>
            ))}
          </div>

          {/* Feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(feedback || []).map(f => (
              <div key={f.id} style={{ background: '#fff', border: '1px solid #E4DED1', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: f.note ? 8 : 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{f.business_name}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: (CAT_COLORS[f.category] || '#8A9590') + '18', color: CAT_COLORS[f.category] || '#8A9590',
                    }}>{CAT_LABELS[f.category] || f.category}</span>
                    {f.nps_score != null && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: f.nps_score >= 9 ? '#27AE6018' : f.nps_score >= 7 ? '#D4B98718' : '#B8545018',
                        color: f.nps_score >= 9 ? '#27AE60' : f.nps_score >= 7 ? '#B08A4A' : '#B85450',
                      }}>NPS {f.nps_score}</span>
                    )}
                    {f.page && <span style={{ fontSize: 10, color: '#8A7560' }}>on {f.page}</span>}
                  </div>
                  <span style={{ fontSize: 11, color: '#8A7560', flexShrink: 0 }}>
                    {new Date(f.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {f.note && (
                  <div style={{ fontSize: 13, color: '#4A5E5A', lineHeight: 1.5, fontStyle: 'italic' }}>
                    "{f.note}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
