'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { useToast } from '../../../../components/ui/Toast';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';

const STATUS_CONFIG = {
  pending:           { label: 'New order',        color: '#D97706', bg: '#FFFBEB', dot: '#D97706', icon: '🆕' },
  pending_payment:   { label: 'Awaiting payment', color: '#D97706', bg: '#FFFBEB', dot: '#D97706', icon: '⏳' },
  paid:              { label: 'Paid',             color: '#059669', bg: '#F0FDF4', dot: '#059669', icon: '✅' },
  fulfilled:         { label: 'Fulfilled',        color: '#0891B2', bg: '#F0F9FF', dot: '#0891B2', icon: '📦' },
  cancelled:         { label: 'Cancelled',        color: '#6B7280', bg: '#F9FAFB', dot: '#6B7280', icon: '❌' },
  refunded:          { label: 'Refunded',         color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626', icon: '↩️' },
};

function timeStr(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(n, cur = 'ETB') {
  return `${Number(n || 0).toLocaleString()} ${cur}`;
}

export default function OrderDetailPage({ params }) {
  const { initData } = useTelegram() || {};
  const router = useRouter();
  const { toast } = useToast();
  const [order, setOrder] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  useEffect(() => {
    if (!initData) return;
    async function load() {
      setLoading(true);
      const r = await fetch(`/api/orders/${params.id}`, {
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) { setLoading(false); return; }
      const j = await r.json();
      setOrder(j.order);
      setNote(j.order?.owner_note || '');
      setDeliveryStatus(j.order?.delivery_status || '');
      setConversation(j.conversation || null);
      setReceiptSent(!!(j.order?.meta?.receipt_sent_at));
      setLoading(false);
    }
    load();
  }, [params.id, initData]);

  const updateStatus = useCallback(async (status) => {
    if (!initData || updating) return;
    setUpdating(true);
    try {
      const r = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ id: params.id, status }),
      });
      if (!r.ok) throw new Error('Update failed');
      const j = await r.json();
      setOrder(j.order);
      toast(
        status === 'paid' ? 'Order marked as paid ✅' :
        status === 'fulfilled' ? 'Order fulfilled 📦' : 'Order cancelled',
        { variant: 'success' }
      );
    } catch {
      toast('Could not update order', { variant: 'error' });
    } finally { setUpdating(false); }
  }, [initData, params.id, toast, updating]);

  async function saveNote() {
    if (!initData || savingNote) return;
    setSavingNote(true);
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ id: params.id, owner_note: note }),
    }).catch(() => {});
    setSavingNote(false);
    toast('Note saved', { variant: 'success' });
  }

  async function sendReceipt() {
    if (!initData || sendingReceipt) return;
    setSendingReceipt(true);
    try {
      const r = await fetch(`/api/orders/${params.id}/receipt`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.error === 'customer_no_telegram') {
          toast('Customer has no Telegram — cannot send receipt', { variant: 'error' });
        } else {
          toast('Could not send receipt', { variant: 'error' });
        }
      } else {
        setReceiptSent(true);
        toast('Receipt sent to customer ✅', { variant: 'success' });
      }
    } catch {
      toast('Could not send receipt', { variant: 'error' });
    } finally { setSendingReceipt(false); }
  }

  async function doRefund() {
    if (!initData || refunding) return;
    setRefunding(true);
    try {
      const r = await fetch(`/api/orders/${params.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ reason: refundReason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast(j.error || 'Refund failed', { variant: 'error' });
      } else {
        setOrder(prev => ({ ...prev, status: 'refunded' }));
        setShowRefundModal(false);
        toast('Refund processed ↩️', { variant: 'success' });
      }
    } catch {
      toast('Refund failed', { variant: 'error' });
    } finally { setRefunding(false); }
  }

  if (loading) return <div style={{ padding: 20, color: COLORS.textHint, fontFamily: FONT.body }}>Loading…</div>;
  if (!order) return (
    <div style={{ padding: 20, fontFamily: FONT.body }}>
      <p style={{ color: COLORS.red }}>Order not found.</p>
      <Link href="/orders" style={{ color: COLORS.teal, fontSize: 14 }}>← Back to orders</Link>
    </div>
  );

  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Link href="/orders" style={{ color: COLORS.textHint, textDecoration: 'none', fontSize: 13 }}>← Orders</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
              Order #{order.id.slice(-6).toUpperCase()}
            </h1>
            <p style={{ fontSize: 12, color: COLORS.textHint, margin: '4px 0 0' }}>{timeStr(order.created_at)}</p>
          </div>
          <span style={{
            fontSize: 12, padding: '5px 12px', borderRadius: 999,
            background: cfg.bg, color: cfg.color, fontWeight: 700,
            border: `1px solid ${cfg.color}30`,
          }}>
            {cfg.icon} {cfg.label}
          </span>
        </div>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Customer */}
        {order.customers && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
            <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Customer</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{order.customers.name || 'Unknown'}</div>
                {order.customers.telegram_username && (
                  <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>@{order.customers.telegram_username}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link href={`/customers/${order.customers.id}`} style={{
                  fontSize: 12, padding: '6px 12px', borderRadius: RADII.md,
                  background: COLORS.border, color: COLORS.textPrimary, textDecoration: 'none', fontWeight: 500,
                }}>Profile</Link>
                {conversation && (
                  <Link href={`/conversations/${conversation.id}`} style={{
                    fontSize: 12, padding: '6px 12px', borderRadius: RADII.md,
                    background: COLORS.teal, color: '#fff', textDecoration: 'none', fontWeight: 500,
                  }}>Chat</Link>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Items */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, boxShadow: SHADOW.card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Items</div>
          </div>
          {items.length > 0 ? items.map((item, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', borderBottom: i < items.length - 1 ? `1px solid ${COLORS.border}` : 'none',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{item.name || item.product || 'Item'}</div>
                {item.variant && <div style={{ fontSize: 12, color: COLORS.textHint }}>Variant: {item.variant}</div>}
                <div style={{ fontSize: 12, color: COLORS.textHint }}>Qty: {item.qty || 1}</div>
              </div>
              {item.price && (
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {fmtMoney((item.price || 0) * (item.qty || 1), order.currency)}
                </div>
              )}
            </div>
          )) : (
            <div style={{ padding: '14px 16px', color: COLORS.textHint, fontSize: 13, fontStyle: 'italic' }}>No item details</div>
          )}
          {/* Discount applied */}
          {order.meta?.discount_code && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '10px 16px',
              borderTop: `1px solid ${COLORS.border}`, background: 'rgba(79,163,138,0.05)',
            }}>
              <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 500 }}>
                🏷️ Code: <code style={{ fontWeight: 700 }}>{order.meta.discount_code}</code>
              </div>
              <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 600 }}>
                -{fmtMoney(order.meta.discount_amount || 0, order.currency)}
              </div>
            </div>
          )}
          {order.total && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '14px 16px',
              borderTop: `1px solid ${COLORS.border}`, background: COLORS.bg,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {order.meta?.discount_code ? 'Total (after discount)' : 'Total'}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {fmtMoney(order.total, order.currency)}
              </div>
            </div>
          )}
        </div>

        {/* Payment link — share with customer */}
        {order.checkout_url && order.status === 'awaiting_payment' && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
            <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Payment link</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: COLORS.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '8px 0' }}>
                {order.checkout_url.slice(0, 40)}…
              </div>
              <button onClick={() => {
                if (navigator.clipboard) navigator.clipboard.writeText(order.checkout_url).then(() => toast('Link copied!', { variant: 'success' }));
                else if (navigator.share) navigator.share({ url: order.checkout_url });
              }} style={{
                padding: '8px 14px', background: COLORS.teal, color: '#fff',
                border: 'none', borderRadius: RADII.md, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT.body, flexShrink: 0,
              }}>
                Share link
              </button>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
          <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Timeline</div>
          {[
            { label: 'Order placed', time: order.created_at, icon: '🆕' },
            order.paid_at ? { label: 'Payment confirmed', time: order.paid_at, icon: '✅' } : null,
            order.fulfilled_at ? { label: 'Fulfilled', time: order.fulfilled_at, icon: '📦' } : null,
          ].filter(Boolean).map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>{ev.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{ev.label}</div>
                <div style={{ fontSize: 11, color: COLORS.textHint }}>{timeStr(ev.time)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Owner note */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
          <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Private note</div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={saveNote}
            placeholder="Add a private note about this order…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'none',
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.md, padding: '8px 10px',
              fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary,
              outline: 'none', lineHeight: 1.5,
            }}
          />
          {savingNote && <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4 }}>Saving…</div>}
        </div>

        {/* Delivery status (for fulfilled orders) */}
        {order.status === 'fulfilled' && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
            <div style={{ fontSize: 10, color: COLORS.textHint, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Delivery status</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[
                ['preparing', '👨‍🍳 Preparing'],
                ['on_the_way', '🛵 On the way'],
                ['delivered', '✅ Delivered'],
                ['collected', '📦 Collected'],
              ].map(([v, l]) => (
                <button key={v} onClick={async () => {
                  setDeliveryStatus(v);
                  await fetch(`/api/orders/${params.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
                    body: JSON.stringify({ delivery_status: v }),
                  }).catch(() => {});
                  toast(`Delivery status: ${l}`, { variant: 'success' });
                }} style={{
                  padding: '10px', borderRadius: RADII.md, border: `1.5px solid ${deliveryStatus === v ? COLORS.teal : COLORS.border}`,
                  background: deliveryStatus === v ? `${COLORS.teal}15` : '#fff',
                  color: deliveryStatus === v ? COLORS.teal : COLORS.textSecondary,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
                }}>{l}</button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {['pending', 'pending_payment'].includes(order.status) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => updateStatus('paid')} disabled={updating} style={{
              background: COLORS.green, color: '#fff', border: 'none', borderRadius: RADII.lg,
              padding: '14px', fontSize: 15, fontWeight: 600, cursor: updating ? 'default' : 'pointer',
              fontFamily: FONT.body, opacity: updating ? 0.7 : 1,
            }}>
              ✅ Mark as paid
            </button>
            <button onClick={() => updateStatus('cancelled')} disabled={updating} style={{
              background: 'transparent', color: COLORS.textHint, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, padding: '12px', fontSize: 14, fontWeight: 500,
              cursor: updating ? 'default' : 'pointer', fontFamily: FONT.body,
            }}>
              ❌ Cancel order
            </button>
          </div>
        )}
        {order.status === 'paid' && (
          <button onClick={() => updateStatus('fulfilled')} disabled={updating} style={{
            background: COLORS.teal, color: '#fff', border: 'none', borderRadius: RADII.lg,
            padding: '14px', fontSize: 15, fontWeight: 600, cursor: updating ? 'default' : 'pointer',
            fontFamily: FONT.body, opacity: updating ? 0.7 : 1,
          }}>
            📦 Mark as fulfilled
          </button>
        )}

        {/* Receipt button — for paid/fulfilled orders */}
        {['paid', 'fulfilled'].includes(order.status) && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendReceipt} disabled={sendingReceipt} style={{
              flex: 1, background: receiptSent ? COLORS.bg : COLORS.ink2, color: receiptSent ? COLORS.textHint : '#fff',
              border: `1px solid ${receiptSent ? COLORS.border : COLORS.ink2}`,
              borderRadius: RADII.lg, padding: '13px', fontSize: 14, fontWeight: 600,
              cursor: sendingReceipt ? 'default' : 'pointer', fontFamily: FONT.body,
              opacity: sendingReceipt ? 0.7 : 1,
            }}>
              {sendingReceipt ? 'Sending…' : receiptSent ? '✅ Receipt sent' : '📄 Send receipt'}
            </button>
            <a href={`/receipt/${order.id}`} target="_blank" rel="noopener noreferrer" style={{
              padding: '13px 14px', borderRadius: RADII.lg, background: COLORS.bg,
              border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary,
              textDecoration: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              Preview
            </a>
          </div>
        )}

        {/* Refund button — for paid orders */}
        {order.status === 'paid' && (
          <button onClick={() => setShowRefundModal(true)} style={{
            background: 'transparent', color: COLORS.red, border: `1px solid ${COLORS.red}30`,
            borderRadius: RADII.lg, padding: '12px', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT.body,
          }}>
            ↩️ Issue refund
          </button>
        )}
      </div>

      {/* Refund confirmation modal */}
      {showRefundModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 1000, padding: '0 0 env(safe-area-inset-bottom)',
        }} onClick={e => { if (e.target === e.currentTarget) setShowRefundModal(false); }}>
          <div style={{
            background: COLORS.surface, borderRadius: `${RADII.lg} ${RADII.lg} 0 0`,
            padding: '24px 20px', width: '100%', maxWidth: 480,
          }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Issue refund</h3>
            <p style={{ fontSize: 13, color: COLORS.textHint, marginBottom: 16 }}>
              Refund <strong>{fmtMoney(order.total, order.currency)}</strong> to{' '}
              <strong>{order.customers?.name || 'customer'}</strong>? This cannot be undone.
            </p>
            <textarea
              value={refundReason}
              onChange={e => setRefundReason(e.target.value)}
              placeholder="Reason for refund (optional)"
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.md, padding: '10px 12px',
                fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary,
                outline: 'none', lineHeight: 1.5, marginBottom: 14,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowRefundModal(false)} style={{
                flex: 1, background: COLORS.bg, color: COLORS.textSecondary,
                border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
                padding: '13px', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: FONT.body,
              }}>
                Cancel
              </button>
              <button onClick={doRefund} disabled={refunding} style={{
                flex: 1, background: COLORS.red, color: '#fff', border: 'none',
                borderRadius: RADII.lg, padding: '13px', fontSize: 14, fontWeight: 700,
                cursor: refunding ? 'default' : 'pointer', fontFamily: FONT.body,
                opacity: refunding ? 0.7 : 1,
              }}>
                {refunding ? 'Processing…' : '↩️ Confirm refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
