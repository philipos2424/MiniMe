/**
 * /receipt/[id] — Public printable receipt page.
 * No authentication required — the order ID acts as the access token.
 * Customers can open this in a browser and use "Print / Save as PDF".
 */
import { supabase } from '../../../lib/server/db';
import { findById as findBusinessById } from '../../../lib/server/businesses';

export const dynamic = 'force-dynamic';

async function getReceiptData(id) {
  const sb = supabase();
  const { data: order } = await sb.from('orders')
    .select('id, business_id, items, total, currency, paid_at, created_at, status, customers(name, phone, email)')
    .eq('id', id)
    .maybeSingle();
  if (!order) return null;
  const business = await findBusinessById(order.business_id);
  return { order, business };
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtMoney(n, cur) {
  return `${Number(n || 0).toLocaleString()} ${cur || 'ETB'}`;
}

export default async function ReceiptPage({ params }) {
  const data = await getReceiptData(params.id);

  if (!data || !data.order) {
    return (
      <html>
        <body style={{ fontFamily: 'Georgia, serif', padding: 40, textAlign: 'center', color: '#444' }}>
          <h2>Receipt not found</h2>
          <p>This receipt link may be invalid or expired.</p>
        </body>
      </html>
    );
  }

  const { order, business } = data;
  const items = Array.isArray(order.items) ? order.items : [];
  const cur = order.currency || 'ETB';
  const orderNum = order.id.slice(-6).toUpperCase();
  const isPaid = ['paid', 'fulfilled'].includes(order.status);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Receipt #{orderNum} — {business?.name || 'MiniMe'}</title>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #f5f5f0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 24px 12px;
            color: #1a2e2a;
          }
          .receipt {
            background: #fff;
            width: 100%;
            max-width: 420px;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          }
          .header {
            background: #0E2823;
            color: #fff;
            padding: 28px 24px 20px;
            text-align: center;
          }
          .biz-name {
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.02em;
            margin-bottom: 4px;
          }
          .biz-category {
            font-size: 12px;
            opacity: 0.55;
            text-transform: uppercase;
            letter-spacing: 0.12em;
          }
          .status-badge {
            display: inline-block;
            margin-top: 14px;
            padding: 5px 14px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            background: ${isPaid ? 'rgba(79,163,138,0.25)' : 'rgba(176,138,74,0.25)'};
            color: ${isPaid ? '#5ec9a4' : '#d4b060'};
          }
          .body { padding: 24px; }
          .meta-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0ede7;
            font-size: 13px;
          }
          .meta-row:last-child { border-bottom: none; }
          .meta-label { color: #8a9590; }
          .meta-value { font-weight: 600; color: #1a2e2a; text-align: right; }
          .section-title {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #8a9590;
            margin: 20px 0 10px;
          }
          .item-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            padding: 10px 0;
            border-bottom: 1px solid #f0ede7;
            font-size: 14px;
          }
          .item-row:last-child { border-bottom: none; }
          .item-name { flex: 1; font-weight: 500; }
          .item-qty { color: #8a9590; font-size: 12px; margin-top: 2px; }
          .item-sub { font-weight: 600; white-space: nowrap; }
          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 16px 0 0;
            border-top: 2px solid #0E2823;
            margin-top: 8px;
          }
          .total-label { font-size: 15px; font-weight: 700; }
          .total-amount { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #0E2823; }
          .footer {
            background: #FFFFFF;
            padding: 18px 24px;
            text-align: center;
            border-top: 1px solid #E4DED1;
          }
          .thank-you { font-size: 15px; font-weight: 600; color: #0E2823; margin-bottom: 4px; }
          .powered { font-size: 11px; color: #b0a898; margin-top: 8px; }
          .print-btn {
            display: block;
            width: 100%;
            padding: 13px;
            margin-top: 16px;
            background: #0E2823;
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
          }
          @media print {
            body { background: #fff; padding: 0; }
            .receipt { box-shadow: none; border-radius: 0; max-width: 100%; }
            .print-btn { display: none; }
          }
        `}</style>
      </head>
      <body>
        <div className="receipt">
          <div className="header">
            <div className="biz-name">{business?.name || 'Business'}</div>
            {business?.category && (
              <div className="biz-category">{business.category}</div>
            )}
            <div className="status-badge">{isPaid ? '✅ PAID' : '⏳ PENDING'}</div>
          </div>

          <div className="body">
            <div className="section-title">Receipt Details</div>
            <div className="meta-row">
              <span className="meta-label">Order #</span>
              <span className="meta-value">{orderNum}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">Date</span>
              <span className="meta-value">{fmtDate(order.paid_at || order.created_at)}</span>
            </div>
            {order.customers?.name && (
              <div className="meta-row">
                <span className="meta-label">Customer</span>
                <span className="meta-value">{order.customers.name}</span>
              </div>
            )}
            {business?.telegram_bot_username && (
              <div className="meta-row">
                <span className="meta-label">Bot</span>
                <span className="meta-value">@{business.telegram_bot_username}</span>
              </div>
            )}

            <div className="section-title">Items</div>
            {items.length > 0 ? items.map((item, i) => {
              const name = item.name || item.product || 'Item';
              const qty = item.qty || item.quantity || 1;
              const sub = (item.price ?? 0) * qty || item.subtotal || 0;
              return (
                <div key={i} className="item-row">
                  <div>
                    <div className="item-name">{name}</div>
                    {item.variant && <div className="item-qty">Variant: {item.variant}</div>}
                    <div className="item-qty">Qty: {qty}</div>
                  </div>
                  {sub > 0 && <div className="item-sub">{fmtMoney(sub, cur)}</div>}
                </div>
              );
            }) : (
              <div style={{ fontSize: 13, color: '#8a9590', fontStyle: 'italic', padding: '8px 0' }}>
                No item details available
              </div>
            )}

            <div className="total-row">
              <span className="total-label">Total</span>
              <span className="total-amount">{fmtMoney(order.total, cur)}</span>
            </div>
          </div>

          <div className="footer">
            <div className="thank-you">Thank you for your purchase! 🙏</div>
            {business?.name && (
              <div style={{ fontSize: 12, color: '#8a9590', marginTop: 2 }}>{business.name}</div>
            )}
            <div className="powered">Powered by MiniMe · minime.bot</div>
            <button className="print-btn" onClick={() => window.print()}>
              🖨️ Save as PDF / Print
            </button>
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          // Auto-show print dialog on desktop when opened directly
          if (window.innerWidth > 600 && document.referrer === '') {
            // Don't auto-print — let user tap the button
          }
        `}} />
      </body>
    </html>
  );
}
