'use client';
/**
 * Orders page — shows all orders for the business with status, amount, customer.
 * Owner can mark pending orders as paid or fulfilled with one tap.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
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
      {/* Top row: customer + time + DM */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0,
          }} />
          <Link href={`/orders/${order.id}`} style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
            {order.customer_name}
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {order.customer_telegram_id && (
            <a
              href={`tg://user?id=${order.customer_telegram_id}`}
              style={{ fontSize: 11, color: COLORS.teal, fontWeight: 600, textDecoration: 'none' }}
              title="Open Telegram chat"
            >
              💬
            </a>
          )}
          <span style={{ fontSize: 12, color: COLORS.textHint }}>{timeAgo(ts)}</span>
        </div>
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

      {/* Payment method + discount badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
        {order.payment_method && (
          <span style={{ fontSize: 12, color: COLORS.textHint }}>
            via {{
              chapa:          'Chapa',
              cbe_manual:     'CBE transfer',
              telebirr_manual:'Telebirr',
              telegram_stars: 'Telegram Stars',
              cash:           'Cash',
            }[order.payment_method] || order.payment_method}
          </span>
        )}
        {order.meta?.discount_code && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
            background: 'rgba(79,163,138,0.12)', color: COLORS.green,
            letterSpacing: '0.04em',
          }}>
            🏷️ {order.meta.discount_code}
          </span>
        )}
      </div>

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
      {/* View details link */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
        <Link href={`/orders/${order.id}`} style={{
          fontSize: 12, color: COLORS.teal, textDecoration: 'none', fontWeight: 500,
        }}>
          View full details →
        </Link>
      </div>

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

// ─── New Order Form ───────────────────────────────────────────────
function NewOrderForm({ initData, onCreated, onClose }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [items, setItems] = useState([{ name: '', qty: 1, price: '' }]);
  const [status, setStatus] = useState('paid');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const total = items.reduce((s, i) => s + (parseFloat(i.price || 0) * (parseInt(i.qty) || 1)), 0);

  function addItem() { setItems(prev => [...prev, { name: '', qty: 1, price: '' }]); }
  function updateItem(i, field, val) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it)); }
  function removeItem(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  async function submit() {
    const validItems = items.filter(i => i.name.trim());
    if (!validItems.length) { toast('Add at least one item', { variant: 'error' }); return; }
    if (!total) { toast('Add a price for at least one item', { variant: 'error' }); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          customer_name: customerName.trim() || 'Walk-in Customer',
          customer_phone: customerPhone.trim() || null,
          items: validItems,
          total,
          status,
          owner_note: note.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      toast('Order created ✅', { variant: 'success' });
      onCreated();
      onClose();
    } catch (e) { toast(e.message, { variant: 'error' }); }
    finally { setSaving(false); }
  }

  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${COLORS.border}`, borderRadius: RADII.md, fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary, background: COLORS.surface, outline: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(14,40,35,.5)', display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', width: '100%', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>New Order</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: COLORS.textHint }}>×</button>
        </div>

        {/* Customer */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Customer (optional)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" style={{ ...inp, flex: 2 }} />
            <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Phone" style={{ ...inp, flex: 1 }} type="tel" />
          </div>
        </div>

        {/* Items */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Items</div>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input value={item.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="Item name" style={{ ...inp, flex: 3 }} />
              <input value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} placeholder="Qty" style={{ ...inp, flex: 1, textAlign: 'center' }} type="number" min="1" />
              <input value={item.price} onChange={e => updateItem(i, 'price', e.target.value)} placeholder="Price" style={{ ...inp, flex: 2 }} type="number" />
              {items.length > 1 && (
                <button onClick={() => removeItem(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.textHint, fontSize: 18, padding: '0 2px', flexShrink: 0 }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addItem} style={{ border: `1px dashed ${COLORS.border}`, background: 'none', borderRadius: RADII.md, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontFamily: FONT.body, color: COLORS.textHint, marginTop: 2 }}>
            + Add item
          </button>
        </div>

        {/* Total */}
        {total > 0 && (
          <div style={{ background: COLORS.bg, borderRadius: RADII.md, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: COLORS.textSecondary }}>Total</span>
            <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Fraunces', Georgia, serif", letterSpacing: '-0.02em' }}>{total.toLocaleString()} ETB</span>
          </div>
        )}

        {/* Status */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['paid', '✅ Paid'], ['pending_payment', '⏳ Awaiting payment'], ['fulfilled', '📦 Fulfilled']].map(([v, l]) => (
            <button key={v} onClick={() => setStatus(v)} style={{
              flex: 1, padding: '8px 4px', borderRadius: RADII.md, border: `1.5px solid ${status === v ? COLORS.teal : COLORS.border}`,
              background: status === v ? `${COLORS.teal}15` : '#fff', fontSize: 11.5, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT.body, color: status === v ? COLORS.teal : COLORS.textHint,
            }}>{l}</button>
          ))}
        </div>

        {/* Note */}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Private note (optional)" style={{ ...inp, marginBottom: 14 }} />

        <button onClick={submit} disabled={saving} style={{
          width: '100%', padding: '13px', background: saving ? COLORS.textHint : COLORS.textPrimary,
          color: '#fff', border: 'none', borderRadius: RADII.lg, fontSize: 15, fontWeight: 600,
          cursor: saving ? 'default' : 'pointer', fontFamily: FONT.body,
        }}>
          {saving ? 'Creating…' : `Create order${total > 0 ? ` — ${total.toLocaleString()} ETB` : ''}`}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────
export default function OrdersPage() {
  const { initData } = useTelegram() || {};
  const { toast } = useToast();
  // ?period=today from home card — show only today's orders
  const todayOnly = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('period') === 'today';
  const [orders, setOrders]     = useState([]);
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [updating, setUpdating] = useState(null); // "orderId_status"
  const [showNewOrder, setShowNewOrder] = useState(false);

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

  // Apply today-only filter when coming from home card (?period=today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const q = search.trim().toLowerCase();
  const displayedOrders = orders.filter(o => {
    if (todayOnly && (o.created_at || '').slice(0, 10) !== todayStr) return false;
    if (!q) return true;
    const name = (o.customer_name || '').toLowerCase();
    const items = (o.items || []).map(i => (i.name || i.product || '')).join(' ').toLowerCase();
    const code = (o.meta?.discount_code || '').toLowerCase();
    return name.includes(q) || items.includes(q) || code.includes(q);
  });
  const pendingCount = orders.filter(o => o.status === 'pending_payment').length;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
              Orders{todayOnly ? ' — Today' : ''}
            </h1>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            <button
              onClick={() => setShowNewOrder(true)}
              style={{
                border: 'none', borderRadius: RADII.md, cursor: 'pointer',
                background: COLORS.textPrimary, color: '#fff',
                padding: '7px 14px', fontSize: 13, fontWeight: 600,
                fontFamily: FONT.body, display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              + New order
            </button>
          </div>
        </div>
      </div>

      {/* New Order modal */}
      {showNewOrder && (
        <NewOrderForm
          initData={initData}
          onCreated={() => load(filter)}
          onClose={() => setShowNewOrder(false)}
        />
      )}

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

      {/* Search */}
      <div style={{ padding: '10px 16px', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer, item or promo code…"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '9px 12px',
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
            fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary,
            background: COLORS.bg, outline: 'none',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ padding: '16px 20px' }}>
        {loading ? (
          <Skeleton />
        ) : displayedOrders.length === 0 ? (
          <Empty filter={todayOnly ? 'today' : filter} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayedOrders.map(o => (
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
