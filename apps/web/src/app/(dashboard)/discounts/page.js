'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { useToast } from '../../../components/ui/Toast';
import { COLORS, FONT, RADII } from '../../../lib/design-tokens';

const LABEL = { percent: '% off', fixed: 'ETB off' };

function DiscountCard({ discount, onToggle, onDelete, onShare }) {
  const isExpired = discount.expires_at && new Date(discount.expires_at) < new Date();
  const isExhausted = discount.max_uses && discount.used_count >= discount.max_uses;
  const inactive = !discount.is_active || isExpired || isExhausted;

  return (
    <div style={{
      background: '#fff', border: `1px solid ${inactive ? COLORS.border : COLORS.teal + '40'}`,
      borderRadius: RADII.lg, padding: '14px 16px', marginBottom: 10,
      opacity: inactive ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <code style={{
            fontFamily: FONT.mono || 'monospace', fontSize: 15, fontWeight: 800,
            color: inactive ? COLORS.textHint : COLORS.ink,
            background: COLORS.bg, padding: '3px 10px', borderRadius: 6, letterSpacing: '0.06em',
          }}>
            {discount.code}
          </code>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: inactive ? COLORS.bg : COLORS.greenLight,
            color: inactive ? COLORS.textHint : COLORS.green,
          }}>
            {discount.value}{LABEL[discount.type] || '% off'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onShare(discount)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 16,
          }} title="Share">📤</button>
          <button onClick={() => onToggle(discount)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 16,
          }} title={discount.is_active ? 'Pause' : 'Activate'}>
            {discount.is_active ? '⏸️' : '▶️'}
          </button>
          <button onClick={() => onDelete(discount.id)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 14, color: COLORS.red,
          }} title="Delete">🗑</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {discount.min_order && (
          <span style={{ fontSize: 11, color: COLORS.textHint }}>Min. order: {Number(discount.min_order).toLocaleString()} ETB</span>
        )}
        {discount.max_uses && (
          <span style={{ fontSize: 11, color: COLORS.textHint }}>
            Used: {discount.used_count}/{discount.max_uses}
          </span>
        )}
        {discount.expires_at && (
          <span style={{ fontSize: 11, color: isExpired ? COLORS.red : COLORS.textHint }}>
            {isExpired ? 'Expired' : `Expires: ${new Date(discount.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
          </span>
        )}
        {isExhausted && <span style={{ fontSize: 11, color: COLORS.red }}>All uses exhausted</span>}
        {!discount.is_active && !isExpired && !isExhausted && (
          <span style={{ fontSize: 11, color: COLORS.textHint }}>Paused</span>
        )}
      </div>
    </div>
  );
}

export default function DiscountsPage() {
  const { initData, business } = useTelegram() || {};
  const { toast } = useToast();
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [type, setType] = useState('percent');
  const [value, setValue] = useState('10');
  const [minOrder, setMinOrder] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    if (!initData) return;
    setLoading(true);
    const r = await fetch('/api/discounts', { headers: { 'x-telegram-init-data': initData } });
    if (r.ok) {
      const j = await r.json();
      setDiscounts(j.discounts || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [initData]);

  async function create() {
    if (!initData || !code.trim() || creating) return;
    setCreating(true);
    const r = await fetch('/api/discounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        type, value: Number(value),
        min_order: minOrder ? Number(minOrder) : null,
        max_uses: maxUses ? Number(maxUses) : null,
        expires_at: expiresAt || null,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast(j.error === 'code_already_exists' ? 'That code already exists' : (j.error || 'Failed'), { variant: 'error' });
    } else {
      setDiscounts(prev => [j.discount, ...prev]);
      setShowCreate(false);
      setCode(''); setValue('10'); setType('percent'); setMinOrder(''); setMaxUses(''); setExpiresAt('');
      toast(`Code ${j.discount.code} created ✅`, { variant: 'success' });
    }
    setCreating(false);
  }

  async function toggleDiscount(discount) {
    const r = await fetch(`/api/discounts/${discount.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ is_active: !discount.is_active }),
    });
    if (r.ok) {
      const j = await r.json();
      setDiscounts(prev => prev.map(d => d.id === discount.id ? j.discount : d));
      toast(j.discount.is_active ? 'Code activated' : 'Code paused', { variant: 'success' });
    }
  }

  async function deleteDiscount(id) {
    if (!confirm('Delete this discount code?')) return;
    await fetch(`/api/discounts/${id}`, { method: 'DELETE', headers: { 'x-telegram-init-data': initData } });
    setDiscounts(prev => prev.filter(d => d.id !== id));
    toast('Discount deleted', { variant: 'success' });
  }

  function shareDiscount(discount) {
    const cur = business?.currency || 'ETB';
    const valueStr = discount.type === 'percent'
      ? `${discount.value}% off`
      : `${discount.value} ${cur} off`;
    const minStr = discount.min_order ? ` orders above ${Number(discount.min_order).toLocaleString()} ${cur}` : '';
    const text = `🎉 Use code *${discount.code}* for ${valueStr}${minStr}! Shop with us on Telegram 👇`;
    if (window.Telegram?.WebApp?.switchInlineQuery) {
      window.Telegram.WebApp.switchInlineQuery(text, ['users', 'groups', 'channels']);
    } else if (navigator.share) {
      navigator.share({ text });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!', { variant: 'success' }));
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
    fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
    background: COLORS.bg, outline: 'none',
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 80, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: COLORS.amber, marginBottom: 4 }}>
          Promotions
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Discount Codes</h1>
        <p style={{ fontSize: 13, color: COLORS.textHint, margin: '4px 0 0', lineHeight: 1.45 }}>
          Create promo codes. Alfred will apply them when customers type the code.
        </p>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* Create button */}
        <button onClick={() => setShowCreate(!showCreate)} style={{
          width: '100%', padding: '13px', background: COLORS.ink, color: '#fff',
          border: 'none', borderRadius: RADII.lg, fontSize: 14, fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT.body, marginBottom: 20,
        }}>
          {showCreate ? '✕ Cancel' : '＋ New discount code'}
        </button>

        {/* Create form */}
        {showCreate && (
          <div style={{ background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px 18px', marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>CODE</label>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="SUMMER20"
                  maxLength={20}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>TYPE</label>
                <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                  <option value="percent">Percent off (%)</option>
                  <option value="fixed">Fixed amount (ETB)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  VALUE {type === 'percent' ? '(%)' : '(ETB)'}
                </label>
                <input
                  type="number" min="1" max={type === 'percent' ? 100 : undefined}
                  value={value} onChange={e => setValue(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>MIN ORDER (ETB)</label>
                <input
                  type="number" min="0"
                  value={minOrder} onChange={e => setMinOrder(e.target.value)}
                  placeholder="Optional"
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>MAX USES</label>
                <input
                  type="number" min="1"
                  value={maxUses} onChange={e => setMaxUses(e.target.value)}
                  placeholder="Unlimited"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: COLORS.textHint, fontWeight: 600, display: 'block', marginBottom: 4 }}>EXPIRES</label>
                <input
                  type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
            <button onClick={create} disabled={!code.trim() || creating} style={{
              width: '100%', padding: '12px', background: creating || !code.trim() ? COLORS.textHint : COLORS.teal,
              color: '#fff', border: 'none', borderRadius: RADII.md, fontSize: 14, fontWeight: 600,
              cursor: !code.trim() || creating ? 'default' : 'pointer', fontFamily: FONT.body,
            }}>
              {creating ? 'Creating…' : `Create ${code || 'code'}`}
            </button>
          </div>
        )}

        {/* Quick-tip */}
        <div style={{
          background: 'rgba(79,163,138,0.07)', border: '1px solid rgba(79,163,138,0.2)',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, color: COLORS.teal, fontWeight: 600, marginBottom: 3 }}>💡 How it works</div>
          <div style={{ fontSize: 12, color: '#2A5A4A', lineHeight: 1.5 }}>
            When a customer types a code during checkout, Alfred validates it and applies the discount automatically. Share codes via Telegram with the 📤 button.
          </div>
        </div>

        {/* Bot command tip */}
        <div style={{
          background: COLORS.bg, border: `1px solid ${COLORS.border}`,
          borderRadius: 12, padding: '12px 14px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 4 }}>
            You can also create codes from your bot:
          </div>
          <code style={{ fontSize: 12, background: '#fff', padding: '3px 8px', borderRadius: 5, color: COLORS.amber }}>
            /discount SUMMER20 20%
          </code>
          <span style={{ fontSize: 12, color: COLORS.textHint }}> or </span>
          <code style={{ fontSize: 12, background: '#fff', padding: '3px 8px', borderRadius: 5, color: COLORS.amber }}>
            /discount FRIENDS 50 fixed
          </code>
        </div>

        {/* Discount list */}
        {loading ? (
          <div style={{ color: COLORS.textHint, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
        ) : discounts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: COLORS.textHint }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏷️</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No discount codes yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Create your first one above</div>
          </div>
        ) : (
          discounts.map(d => (
            <DiscountCard
              key={d.id}
              discount={d}
              onToggle={toggleDiscount}
              onDelete={deleteDiscount}
              onShare={shareDiscount}
            />
          ))
        )}
      </div>
    </div>
  );
}
