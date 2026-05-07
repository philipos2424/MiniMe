'use client';
/**
 * Platform admin dashboard — overview + tenant list + tenant editor.
 * Auth: only Telegram IDs in ADMIN_TELEGRAM_IDS env var (server-side enforced
 * on every API call).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';

const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";

export default function AdminPage() {
  const { initData, telegramUser } = useTelegram() || {};
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [businesses, setBusinesses] = useState(null);
  const [activeBiz, setActiveBiz] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [files, setFiles] = useState(null);
  const [bots, setBots] = useState(null);
  const [botsLoading, setBotsLoading] = useState(false);

  async function loadFiles() {
    try {
      const r = await fetch('/api/admin/files', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      setFiles(j.files || []);
    } catch {}
  }

  async function loadOverview() {
    const r = await fetch('/api/admin/overview', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    if (r.status === 403 || r.status === 401) { setForbidden(true); return; }
    const j = await r.json(); setOverview(j);
  }
  async function loadBusinesses() {
    const r = await fetch('/api/admin/businesses', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
    if (r.status === 403 || r.status === 401) { setForbidden(true); return; }
    const j = await r.json(); setBusinesses(j.businesses || []);
  }
  async function loadBots() {
    setBotsLoading(true);
    try {
      const r = await fetch('/api/admin/bots', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      if (r.status === 403 || r.status === 401) { setForbidden(true); return; }
      const j = await r.json();
      setBots(j.bots || []);
    } catch {} finally { setBotsLoading(false); }
  }
  useEffect(() => {
    if (initData) {
      loadOverview();
      loadBusinesses();
      loadFiles();
    }
  }, [initData]);

  // Load bots tab lazily on first visit
  useEffect(() => {
    if (tab === 'bots' && !bots && initData) loadBots();
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
            ['overview', 'Overview'],
            ['businesses', 'Businesses' + (businesses ? ` (${businesses.length})` : '')],
            ['bots', 'Connected Bots' + (bots ? ` (${bots.length})` : '')],
            ['files', 'Files' + (files ? ` (${files.length})` : '')],
            ['email', 'Email Integration'],
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
        {tab === 'overview'    && <Overview overview={overview} />}
        {tab === 'businesses'  && <BusinessesList businesses={businesses} onPick={setActiveBiz} />}
        {tab === 'bots'        && <BotsPanel bots={bots} loading={botsLoading} onRefresh={loadBots} onPick={setActiveBiz} businesses={businesses} />}
        {tab === 'files'       && <FilesPanel files={files} />}
        {tab === 'email'       && <EmailIntegration />}
        {tab === 'health'      && <PlatformHealth overview={overview} />}
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

// ────────────────────────────── Overview ──────────────────────────────
function Overview({ overview }) {
  if (!overview) return <Skeleton />;
  const t = overview.totals;
  const cards = [
    { k: 'Businesses', v: t.businesses, sub: `${t.linked} linked · ${t.signups_week} new this week`, accent: '#1A0F08' },
    { k: 'Active 7d', v: t.active_week, sub: 'used MiniMe in last 7 days', accent: '#5A7A3F' },
    { k: 'Messages', v: t.messages_week.toLocaleString(), sub: 'this week', accent: '#3F5D3F' },
    { k: 'Orders', v: t.orders_week, sub: 'this week', accent: '#8B2E1F' },
    { k: 'GMV (ETB)', v: t.revenue_etb_week.toLocaleString(), sub: 'paid + fulfilled · this week', accent: '#D9A441' },
    { k: 'Active jobs', v: t.jobs_active, sub: 'in flight right now', accent: '#3D2817' },
    { k: 'Customers', v: t.customers_total.toLocaleString(), sub: 'across all businesses', accent: '#1A0F08' },
    { k: 'Lessons learned', v: t.lessons_week, sub: 'auto-mined this week', accent: '#7C3AED' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <div key={i} style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: 18 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560' }}>{c.k}</div>
            <div style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 400, letterSpacing: '-0.025em', color: c.accent, lineHeight: 1, marginTop: 6 }}>{c.v}</div>
            <div style={{ fontSize: 11.5, color: '#8A7560', marginTop: 6, fontFamily: SERIF, fontStyle: 'italic' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
function BusinessesList({ businesses, onPick }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  if (!businesses) return <Skeleton />;
  const filtered = businesses.filter(b => {
    if (filter === 'linked' && !b.telegram_bot_username) return false;
    if (filter === 'active' && b.subscription_status !== 'active') return false;
    if (filter === 'trial' && b.subscription_status !== 'trial') return false;
    if (filter === 'expired' && b.subscription_status !== 'expired') return false;
    if (filter === 'panic' && !b.panic_mode) return false;
    if (q) {
      const hay = `${b.name} ${b.owner_name} ${b.telegram_bot_username} ${b.category} ${b.owner_telegram_id}`.toLowerCase();
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
        {[['all', 'All'], ['linked', 'Linked'], ['active', 'Active'], ['trial', 'Trial'], ['expired', 'Expired'], ['panic', '🔴 Panic']].map(([k, l]) => (
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
                  {b.telegram_bot_username ? `@${b.telegram_bot_username}` : <span style={{ color: '#B23A1F' }}>not linked</span>}
                  {b.panic_mode && <span style={{ marginLeft: 6, color: '#B23A1F' }}>· 🔴 panic</span>}
                </div>
              </td>
              <td style={{ padding: '11px 12px', color: '#3D2817' }}>{b.owner_name || '—'}<div style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560' }}>#{b.owner_telegram_id}</div></td>
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
              <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                <button onClick={() => onPick(b)} style={{ appearance: 'none', border: 'none', background: 'transparent', color: '#8B2E1F', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Open ›</button>
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
    setBusy(true);
    await fetch(`/api/admin/businesses/${businessId}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
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
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>
                  {data.business.trial_ends_at ? new Date(data.business.trial_ends_at).toLocaleDateString() : '—'}
                </span>
              </Row>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {[7, 14, 30].map(d => (
                  <button key={d} disabled={busy} onClick={() => patch({ extend_trial_days: d })} style={btnGhost}>+{d}d trial</button>
                ))}
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
              <Row label="Telegram ID"><span style={{ fontFamily: MONO, fontSize: 12 }}>#{data.business.owner_telegram_id}</span></Row>
              <Row label="Created"><span style={{ fontFamily: MONO, fontSize: 12, color: '#8A7560' }}>{new Date(data.business.created_at).toLocaleDateString()}</span></Row>
            </Section>

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

// ────────────────────────────── Connected Bots ───────────────────────────────
function BotsPanel({ bots, loading, onRefresh, onPick, businesses }) {
  const [filter, setFilter] = useState('all');

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
      </div>

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
function PlatformHealth({ overview }) {
  // Derived: if `lessons_week > 0` auto-learn is alive; if `messages_week > 0` ingestion is alive.
  const items = [
    { name: 'Auto-learn cron (nightly)', ok: (overview?.totals?.lessons_week || 0) > 0 || (overview?.totals?.messages_week || 0) === 0, note: `${overview?.totals?.lessons_week ?? 0} lessons mined this week` },
    { name: 'Webhook ingestion', ok: (overview?.totals?.messages_week || 0) > 0 || (overview?.totals?.linked || 0) === 0, note: `${overview?.totals?.messages_week ?? 0} messages this week` },
    { name: 'Order pipeline', ok: true, note: `${overview?.totals?.orders_week ?? 0} orders, ${overview?.totals?.revenue_etb_week?.toLocaleString() ?? 0} ETB this week` },
    { name: 'Linked bots', ok: true, note: `${overview?.totals?.linked ?? 0} of ${overview?.totals?.businesses ?? 0} businesses` },
  ];
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
      {items.map((it, i) => (
        <div key={i} style={{ padding: '14px 18px', borderTop: i > 0 ? '1px solid #E8DFD0' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.ok ? '#5A7A3F' : '#B23A1F', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, fontStyle: 'italic', color: '#1A0F08' }}>{it.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: '#8A7560', marginTop: 2 }}>{it.note}</div>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', color: it.ok ? '#5A7A3F' : '#B23A1F', textTransform: 'uppercase' }}>{it.ok ? 'OK' : 'CHECK'}</span>
        </div>
      ))}
    </div>
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
