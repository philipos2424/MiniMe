'use client';
/**
 * Orders page — shows all orders for the business with status, amount, customer.
 * Owner can mark pending orders as paid or fulfilled with one tap.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';
import { useToast } from '../ui/Toast';

// Status config
const STATUS = {
  pending_payment: { label: 'Awaiting payment', color: COLORS.amber,    bg: COLORS.amberLight,  dot: COLORS.amber,  icon: '⏳' },
  paid:            { label: 'Paid',              color: COLORS.green,    bg: COLORS.greenLight,  dot: COLORS.green,  icon: '✅' },
  fulfilled:       { label: 'Fulfilled',         color: COLORS.teal,     bg: COLORS.tealLight,   dot: COLORS.teal,   icon: '📦' },
  cancelled:       { label: 'Cancelled',         color: COLORS.textHint, bg: COLORS.border,      dot: COLORS.textHint, icon: '❌' },
  refunded:        { label: 'Refunded',          color: COLORS.red,      bg: COLORS.redLight,    dot: COLORS.red,    icon: '↩️' },
};

const FILTERS = [
  { key: 'all',             label: 'All' },
  { key: 'pending_payment', label: 'Pending' },
  { key: 'paid',            label: 'Paid' },
  { key: 'fulfilled',       label: 'Fulfilled' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function fmtMoney(amount, currency = 'ETB') {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k ${currency}`;
  return `${amount.toLocaleString()} ${currency}`;
}

// ─── Skeleton ────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card,
          opacity: 1 - i * 0.18, animation: 'mmPulse 1.4s ease-in-out infinite',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ height: 13, width: '40%', background: COLORS.border, borderRadius: 6 }} />
            <div style={{ height: 11, width: '20%', background: COLORS.border, borderRadius: 6 }} />
          </div>
          <div style={{ height: 11, width: '30%', background: COLORS.border, borderRadius: 6, marginTop: 10 }} />
          <div style={{ height: 11, width: '55%', background: COLORS.border, borderRadius: 6, marginTop: 6 }} />
        </div>
      ))}
      <style>{`@keyframes mmPulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────
function Empty({ filter }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: COLORS.textHint }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 8 }}>
        {filter === 'all' ? 'No orders yet' : `No ${filter.replace('_', ' ')} orders`}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 240, margin: '0 auto' }}>
        {filter === 'all'
          ? "When customers place orders through your bot, they'll appear here."
          : 'Try switching to "All" to see all orders.'}
      </div>
    </div>
  );
}

// ─── Order card ──────────────────────────────────────────────────
function OrderCard({ order, onStatusChange, updating }) {
  const st = STATUS[order.status] || STATUS.pending_payment;
  const ts = order.paid_at || order.created_at;
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
  const itemNames = Array.isArray(order.items) && order.items.length
    ? order.items.map(it => `${it.quantity || 1}× ${it.name || 'item'}`).join(', ')
    : null;

  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${order.status === 'pending_payment' ? COLORS.amber + '50' : COLORS.border}`,
      borderRadius: RADII.lg,
      padding: '14px 16px',
      boxShadow: SHADOW.card,
    }}>
      {/* Top row: customer + time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0,
          }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.customer_name}
          </span>
        </div>
        <span style={{ fontSize: 12, color: COLORS.textHint, flexShrink: 0 }}>{timeAgo(ts)}</span>
      </div>

      {/* Amount + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
        <span style={{
          fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 400,
          color: COLORS.textPrimary, letterSpacing: '-0.02em',
        }}>
          {fmtMoney(order.total, order.currency)}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 9px',
          background: st.bg, color: st.color, borderRadius: 999,
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
        }}>
          <span>{st.icon}</span>
          {st.label}
        </span>
      </div>

      {/* Items */}
      {itemNames && (
        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {itemNames}
        </div>
      )}

      {/* Payment method */}
      {order.payment_method && (
        <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 3 }}>
          via {order.payment_method === 'chapa' ? 'Chapa' : order.payment_method === 'cbe_manual' ? 'CBE transfer' : order.payment_method === 'telegram_stars' ? 'Telegram Stars' : order.payment_method}
        </div>
      )}

      {/* Owner note */}
      {order.owner_note && (
        <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 4, fontStyle: 'italic' }}>
          Note: {order.owner_note}
        </div>
      )}

      {/* Action buttons — only for actionable statuses */}
      {order.status === 'pending_payment' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <ActionBtn
            label={updating === order.id + '_paid' ? 'Marking…' : '✅ Mark paid'}
            disabled={!!updating}
            accent={COLORS.green}
            bg={COLORS.greenLight}
            onClick={() => onStatusChange(order.id, 'paid')}
          />
          <ActionBtn
            label={updating === order.id + '_cancelled' ? 'Cancelling…' : '✕ Cancel'}
            disabled={!!updating}
            accent={COLORS.textSecondary}
            bg={COLORS.bg}
            border={COLORS.border}
            onClick={() => onStatusChange(order.id, 'cancelled')}
          />
        </div>
      )}
      {order.status === 'paid' && (
        <div style={{ marginTop: 12 }}>
          <ActionBtn
            label={updating === order.id + '_fulfilled' ? 'Marking…' : '📦 Mark fulfilled'}
            disabled={!!updating}
            accent={COLORS.teal}
            bg={COLORS.tealLight}
            onClick={() => onStatusChange(order.id, 'fulfilled')}
          />
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, disabled, accent, bg, border }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none', border: `1px solid ${border || accent + '40'}`,
        borderRadius: RADII.md, padding: '8px 14px',
        background: disabled ? COLORS.border : bg,
        color: disabled ? COLORS.textHint : accent,
        fontSize: 13, fontWeight: 600, fontFamily: FONT.body,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
        flex: 1,
      }}
    >
      {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────
export default function OrdersPage() {
  const { initData } = useTelegram() || {};
  const { toast } = useToast();
  const [orders, setOrders]     = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [updating, setUpdating] = useState(null); // "orderId_status"

  const load = useCallback(async (statusFilter) => {
    if (!initData) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/orders?status=${statusFilter}&limit=50`, {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('Failed to load');
      const j = await r.json();
      setOrders(j.orders || []);
      setSummary({ revenue_today: j.revenue_today, orders_today: j.orders_today, currency: j.currency });
    } catch (e) {
      toast('Could not load orders', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [initData]);

  useEffect(() => { load(filter); }, [filter, load]);

  const handleStatusChange = useCallback(async (orderId, newStatus) => {
    const key = `${orderId}_${newStatus}`;
    setUpdating(key);
    try {
      const r = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ id: orderId, status: newStatus }),
      });
      if (!r.ok) throw new Error('Update failed');
      toast(newStatus === 'paid' ? 'Order marked as paid ✅' : newStatus === 'fulfilled' ? 'Order fulfilled 📦' : 'Order cancelled', { variant: 'success' });
      // Update in-place
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus, paid_at: newStatus === 'paid' ? new Date().toISOString() : o.paid_at } : o));
    } catch {
      toast('Could not update order', { variant: 'error' });
    } finally {
      setUpdating(null);
    }
  }, [initData, toast]);

  const pendingCount = orders.filter(o => o.status === 'pending_payment').length;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>Orders</h1>
            {summary && summary.orders_today > 0 ? (
              <p style={{ fontSize: 13, color: COLORS.green, margin: '2px 0 0', fontWeight: 500 }}>
                {fmtMoney(summary.revenue_today, summary.currency)} today · {summary.orders_today} paid
              </p>
            ) : (
              <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>
                Customer orders & payments
              </p>
            )}
          </div>
          {pendingCount > 0 && (
            <div style={{
              background: COLORS.amber, color: '#FFFFFF',
              borderRadius: 999, minWidth: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, padding: '0 8px',
            }}>
              {pendingCount}
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`,
        padding: '0 16px', display: 'flex', gap: 4, overflowX: 'auto',
      }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              appearance: 'none', border: 'none', background: 'none',
              cursor: 'pointer', fontFamily: FONT.body,
              padding: '11px 14px', fontSize: 13, fontWeight: filter === f.key ? 600 : 400,
              color: filter === f.key ? COLORS.teal : COLORS.textSecondary,
              borderBottom: `2px solid ${filter === f.key ? COLORS.teal : 'transparent'}`,
              whiteSpace: 'nowrap', transition: 'all 0.15s',
              flexShrink: 0,
            }}
          >
            {f.label}
            {f.key === 'pending_payment' && pendingCount > 0 && (
              <span style={{
                marginLeft: 6, background: COLORS.amber, color: '#fff',
                borderRadius: 999, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', display: 'inline-block',
              }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 20px' }}>
        {loading ? (
          <Skeleton />
        ) : orders.length === 0 ? (
          <Empty filter={filter} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {orders.map(o => (
              <OrderCard
                key={o.id}
                order={o}
                onStatusChange={handleStatusChange}
                updating={updating}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
