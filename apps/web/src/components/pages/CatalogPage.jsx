'use client';
/**
 * Catalog — segmented Products / Clients in one screen.
 * Replaces the split Products + Clients nav items.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { Plus, Search, Package } from 'lucide-react';
import { timeAgo } from '../../lib/utils';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FFFFFF';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const LINE2  = '#EEE9DE';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const AMH    = "'Noto Sans Ethiopic', 'Geist', sans-serif";

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name = '?', tone = 'cream' }) {
  const tones = {
    cream: { bg: CREAM2,   fg: INK     },
    gold:  { bg: '#E8D3A6', fg: '#5C4520' },
    mint:  { bg: '#CFE5DC', fg: '#1F4A3E' },
  };
  const t = tones[tone] || tones.cream;
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%', background: t.bg,
      display: 'grid', placeItems: 'center', flexShrink: 0,
      fontFamily: SERIF, fontSize: 18, color: t.fg,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Products segment ─────────────────────────────────────────────────────────
function ProductCard({ p, onUpdate }) {
  const isLow = p.low_stock_threshold > 0 && (p.stock_quantity ?? 0) <= p.low_stock_threshold;
  const isOut = (p.stock_quantity ?? 0) === 0;

  return (
    <div style={{
      background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(14,40,35,.04)',
    }}>
      {/* Image or placeholder */}
      <div style={{
        aspectRatio: '1', background: p.image_url ? undefined : CREAM2,
        position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden',
      }}>
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Package size={32} color={MUTED} strokeWidth={1.2} />
        )}
        {(isOut || isLow) && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            background: isOut ? 'rgba(184,84,80,.9)' : 'rgba(176,138,74,.9)',
            color: '#fff', padding: '2px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 500,
          }}>
            {isOut ? 'out' : 'low'}
          </span>
        )}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontFamily: SERIF, fontSize: 14.5, lineHeight: 1.2, color: INK }}>{p.name}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: MUTED }}>{p.stock_quantity ?? 0} in stock</span>
          <span style={{ fontFamily: SERIF, fontSize: 15, color: INK }}>{p.price}</span>
        </div>
      </div>
    </div>
  );
}

function ProductsGrid({ businessId }) {
  const supabase = createClient();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    supabase.from('products').select('*').eq('business_id', businessId).eq('is_active', true).order('name')
      .then(({ data }) => { setProducts(data || []); setLoading(false); });
  }, [businessId]);

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {[0,1,2,3].map(i => (
        <div key={i} style={{ height: 180, background: CREAM2, borderRadius: 14, animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.2 }} />
      ))}
    </div>
  );

  if (!products.length) return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <Package size={40} color={MUTED} strokeWidth={1.2} style={{ margin: '0 auto 12px' }} />
      <div style={{ fontFamily: SERIF, fontSize: 20, color: INK }}>No products yet</div>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
        Add your first product and MiniMe will quote prices automatically.
      </p>
      <Link href="/products" style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16,
        background: INK, color: '#F4EEE1', padding: '12px 20px', borderRadius: 999,
        textDecoration: 'none', fontSize: 14, fontWeight: 500, fontFamily: BODY,
      }}>
        <Plus size={14} /> Add product
      </Link>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {products.map((p, i) => (
        <Link key={p.id} href={`/products`} style={{ textDecoration: 'none' }}>
          <div className="fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
            <ProductCard p={p} />
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Clients segment ──────────────────────────────────────────────────────────
function ClientRow({ customer, last }) {
  const name  = customer.name || 'Unknown';
  const tier  = customer.tier || 'new';
  const isVip = tier === 'vip';
  const orders = customer.total_orders || 0;
  const spent  = Number(customer.total_spent || 0);

  return (
    <Link href={`/customers/${customer.id}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ display: 'flex', gap: 12, padding: '12px 10px', alignItems: 'center' }}>
        <Avatar name={name} tone={isVip ? 'gold' : 'cream'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {isVip && (
              <span style={{ background: 'rgba(176,138,74,.12)', color: GOLD, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 500, flexShrink: 0 }}>VIP</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
            {orders} order{orders !== 1 ? 's' : ''}{spent > 0 ? ` · ${spent.toLocaleString()} ETB` : ''}
          </div>
        </div>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      </div>
      {!last && <div style={{ height: 1, background: LINE2, marginLeft: 64, marginRight: 10 }} />}
    </Link>
  );
}

function ClientsList({ businessId }) {
  const supabase = createClient();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    supabase.from('customers').select('*').eq('business_id', businessId).order('last_active_at', { ascending: false })
      .then(({ data }) => { setCustomers(data || []); setLoading(false); });
  }, [businessId]);

  const filtered = customers.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
      {[0,1,2,3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '14px 10px', borderTop: i > 0 ? `1px solid ${LINE2}` : 'none', animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.2 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: CREAM2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: '45%', background: CREAM2, borderRadius: 6, marginBottom: 8 }} />
            <div style={{ height: 12, width: '60%', background: CREAM2, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={16} color={MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          placeholder="Search clients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '11px 14px 11px 38px',
            border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff',
            fontFamily: BODY, fontSize: 14, color: INK, outline: 'none',
          }}
        />
      </div>

      {!filtered.length ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontFamily: SERIF, fontSize: 20, color: INK }}>
            {search ? 'No matches' : 'No clients yet'}
          </div>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
            {search ? 'Try a different name.' : 'Clients appear here after they message your bot.'}
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
          {filtered.map((c, i) => <ClientRow key={c.id} customer={c} last={i === filtered.length - 1} />)}
        </div>
      )}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CatalogPage() {
  const { business } = useTelegram();
  const [seg, setSeg] = useState('products');
  const businessId = business?.id;

  const segLabel = seg === 'products' ? 'Products' : 'Clients';

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <div style={{ padding: '20px 22px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>Catalog</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>{segLabel}</div>
        </div>
        {seg === 'products' && (
          <Link href="/products" style={{ textDecoration: 'none' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: INK,
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}>
              <Plus size={18} color="#F4EEE1" />
            </div>
          </Link>
        )}
      </div>

      <div style={{ padding: '0 22px' }}>

        {/* Segmented control */}
        <div style={{ display: 'inline-flex', background: CREAM, padding: 4, borderRadius: 999, gap: 2, marginBottom: 16 }}>
          {[{ id: 'products', l: 'Products' }, { id: 'clients', l: 'Clients' }].map(s => (
            <button
              key={s.id}
              onClick={() => setSeg(s.id)}
              style={{
                padding: '8px 20px', borderRadius: 999, border: 0, cursor: 'pointer',
                fontFamily: BODY, fontSize: 13, fontWeight: 500,
                background: seg === s.id ? '#fff' : 'transparent',
                color: seg === s.id ? INK : MUTED,
                boxShadow: seg === s.id ? '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)' : 'none',
                transition: 'all .15s ease',
              }}
            >
              {s.l}
            </button>
          ))}
        </div>

        {/* Content */}
        {seg === 'products' ? (
          <ProductsGrid businessId={businessId} />
        ) : (
          <ClientsList businessId={businessId} />
        )}

      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
