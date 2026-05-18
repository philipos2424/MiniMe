'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';

const ACTION_LABELS = {
  'refund.issued':         { icon: '↩️', label: 'Refund issued',         color: '#B85450' },
  'staff.added':           { icon: '👷', label: 'Staff added',            color: '#4FA38A' },
  'staff.removed':         { icon: '👷', label: 'Staff removed',          color: '#B08A4A' },
  'discount.created':      { icon: '🏷️', label: 'Discount created',      color: '#4FA38A' },
  'discount.deleted':      { icon: '🏷️', label: 'Discount deleted',      color: '#B85450' },
  'discount.updated':      { icon: '🏷️', label: 'Discount updated',      color: '#B08A4A' },
  'broadcast.sent':        { icon: '📢', label: 'Broadcast sent',          color: '#4FA38A' },
  'order.status_changed':  { icon: '📦', label: 'Order status changed',   color: '#B08A4A' },
  'bot.token_updated':     { icon: '🤖', label: 'Bot re-linked',           color: '#B08A4A' },
  'subscription.activated':{ icon: '✅', label: 'Subscription activated', color: '#4FA38A' },
  'auth.failed':           { icon: '🔒', label: 'Auth failure',            color: '#B85450' },
  'customer.opt_out':      { icon: '🔕', label: 'Customer opted out',     color: '#8A9590' },
  'customer.opt_in':       { icon: '🔔', label: 'Customer opted in',      color: '#4FA38A' },
  'admin.impersonate_started':{ icon: '🎭', label: 'Admin impersonation', color: '#B85450' },
};

function timeStr(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_LABELS[log.action] || { icon: '·', label: log.action, color: COLORS.textHint };

  return (
    <div
      onClick={() => setExpanded(v => !v)}
      style={{
        background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
        padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
            background: meta.color + '18', color: meta.color,
          }}>
            {meta.icon} {meta.label}
          </span>
          {log.resource_id && (
            <span style={{ fontSize: 11, color: COLORS.textHint, fontFamily: 'monospace' }}>
              #{log.resource_id.slice(-6).toUpperCase()}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: COLORS.textHint, flexShrink: 0 }}>{timeStr(log.created_at)}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: COLORS.bg, borderRadius: RADII.md }}>
          <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 3 }}>
            <strong>Who:</strong> {log.actor_type} (ID: {log.actor_id})
          </div>
          {log.resource_type && (
            <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 3 }}>
              <strong>What:</strong> {log.resource_type}{log.resource_id ? ` · ${log.resource_id}` : ''}
            </div>
          )}
          {log.ip && (
            <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 3 }}>
              <strong>IP:</strong> {log.ip}
            </div>
          )}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 4 }}>DETAILS</div>
              <pre style={{
                fontSize: 11, color: COLORS.textSecondary, background: '#fff',
                padding: '8px', borderRadius: 6, overflow: 'auto', maxHeight: 120,
                margin: 0, border: `1px solid ${COLORS.border}`,
              }}>
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LIMIT = 50;

export default function AuditPage() {
  const { initData } = useTelegram() || {};
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [offset, setOffset]   = useState(0);
  const [hasMore, setHasMore] = useState(false);

  async function load(off = 0, actionFilter = '', append = false) {
    if (!initData) return;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
    if (actionFilter) params.set('action', actionFilter);
    const r = await fetch(`/api/audit?${params}`, { headers: { 'x-telegram-init-data': initData } });
    if (r.ok) {
      const j = await r.json();
      const newLogs = j.logs || [];
      setLogs(prev => append ? [...prev, ...newLogs] : newLogs);
      setHasMore(newLogs.length >= LIMIT);
    }
    setLoading(false);
  }

  useEffect(() => { setOffset(0); load(0, filter); }, [initData, filter]);

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 80, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: COLORS.amber, marginBottom: 4 }}>
          Security & Compliance
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Audit Log</h1>
        <p style={{ fontSize: 13, color: COLORS.textHint, margin: '4px 0 0', lineHeight: 1.4 }}>
          Tamper-evident record of every sensitive action — refunds, staff changes, broadcasts, and more.
        </p>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* Filter */}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px', marginBottom: 16,
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.md, outline: 'none',
            fontSize: 13, fontFamily: FONT.body, background: COLORS.bg, color: COLORS.textPrimary,
          }}
        >
          <option value="">All events</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>

        {/* Log list */}
        {loading && logs.length === 0 ? (
          <div style={{ color: COLORS.textHint, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: COLORS.textHint }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No audit events yet</div>
            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
              Events are recorded when you issue refunds, manage staff, send broadcasts, or change the bot.
            </div>
          </div>
        ) : (
          <>
            {logs.map(l => <LogRow key={l.id} log={l} />)}
            {hasMore && (
              <button
                onClick={() => { const next = offset + LIMIT; setOffset(next); load(next, filter, true); }}
                disabled={loading}
                style={{
                  width: '100%', padding: '12px', background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
                  fontSize: 13, fontWeight: 500, cursor: loading ? 'default' : 'pointer',
                  fontFamily: FONT.body, color: COLORS.textSecondary, marginTop: 4,
                }}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
