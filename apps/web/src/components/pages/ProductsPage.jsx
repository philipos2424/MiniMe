'use client';
/**
 * ProductsPage — redesigned with design tokens.
 */
import { useEffect, useState, useCallback } from 'react';
import { Package, Plus, Camera, Trash2, Minus, Edit2, Check, X } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { SkeletonList } from '../ui/Skeleton';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 14,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const DEFAULT_LOW_THRESHOLD = 10;

export default function ProductsPage() {
  const { business, initData } = useTelegram();
  const supabase = createClient();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', price: '', stock_quantity: '', name_am: '', description: '', low_stock_threshold: '' });
  const [adding, setAdding] = useState(false);
  const businessId = business?.id;

  useEffect(() => {
    if (businessId) fetchProducts(businessId);
  }, [businessId]);

  async function fetchProducts(bizId) {
    setLoading(true);
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', bizId)
      .eq('is_active', true)
      .order('name');
    setProducts(data || []);
    setLoading(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!businessId) return;
    setAdding(true);
    await supabase.from('products').insert({
      ...form,
      price: parseFloat(form.price),
      stock_quantity: parseInt(form.stock_quantity || '0'),
      low_stock_threshold: form.low_stock_threshold ? parseInt(form.low_stock_threshold) : DEFAULT_LOW_THRESHOLD,
      business_id: businessId,
    });
    setForm({ name: '', price: '', stock_quantity: '', name_am: '', description: '', low_stock_threshold: '' });
    await fetchProducts(businessId);
    setAdding(false);
  }

  const handleStockChange = useCallback(async (productId, delta) => {
    // Capture newQty inside the state updater so it's always based on the latest value,
    // not a stale closure — important when clicking +/- quickly.
    let newQty;
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p;
      newQty = Math.max(0, (p.stock_quantity || 0) + delta);
      return { ...p, stock_quantity: newQty };
    }));
    if (newQty !== undefined) {
      await supabase.from('products').update({ stock_quantity: newQty }).eq('id', productId);
    }
  }, [supabase]);

  const handleFieldUpdate = useCallback(async (productId, field, value) => {
    await supabase.from('products').update({ [field]: value }).eq('id', productId);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, [field]: value } : p));
  }, [supabase]);

  async function uploadImage(productId, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api/products/${productId}/image`, {
      method: 'POST',
      headers: { 'x-telegram-init-data': initData },
      body: fd,
    });
    if (r.ok) await fetchProducts(businessId);
  }

  async function removeImage(productId) {
    if (!confirm('Remove the photo?')) return;
    await fetch(`/api/products/${productId}/image`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    await fetchProducts(businessId);
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <PageHeader
        title="Products & Inventory"
        subtitleAm="ምርቶች"
        subtitleEn="What you sell — MiniMe quotes prices and shows photos"
      />

      {/* Add product form */}
      <form
        onSubmit={handleAdd}
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.lg,
          padding: 16,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
          boxShadow: SHADOW.card,
        }}
      >
        <input
          placeholder="Product name"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
          required
        />
        <input
          placeholder="Amharic name (optional)"
          value={form.name_am}
          onChange={e => setForm(p => ({ ...p, name_am: e.target.value }))}
          style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
        />
        <input
          placeholder="Price (ETB)"
          type="number"
          inputMode="decimal"
          value={form.price}
          onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
          style={INPUT_BASE}
          required
        />
        <input
          placeholder="Stock (units)"
          type="number"
          inputMode="numeric"
          value={form.stock_quantity}
          onChange={e => setForm(p => ({ ...p, stock_quantity: e.target.value }))}
          style={INPUT_BASE}
        />
        <input
          placeholder="Low-stock alert at (default: 10)"
          type="number"
          inputMode="numeric"
          value={form.low_stock_threshold}
          onChange={e => setForm(p => ({ ...p, low_stock_threshold: e.target.value }))}
          style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
        />
        <textarea
          placeholder="Short description (helps MiniMe answer 'what is it?')"
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          rows={2}
          style={{ ...INPUT_BASE, resize: 'none', gridColumn: '1 / -1' }}
        />
        <button
          type="submit"
          disabled={adding}
          style={{
            gridColumn: '1 / -1',
            background: adding ? COLORS.textHint : COLORS.teal,
            color: '#FFFFFF',
            fontWeight: 600,
            padding: '10px 0',
            minHeight: 44,
            borderRadius: RADII.md,
            border: 'none',
            fontSize: 14,
            cursor: adding ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: FONT.body,
            transition: 'background 0.15s',
          }}
        >
          <Plus size={16} /> {adding ? 'Adding…' : 'Add Product'}
        </button>
        <p style={{ gridColumn: '1 / -1', fontSize: 11, color: COLORS.textHint, margin: '-4px 0 0' }}>
          You can add a photo to each product after creating it.
        </p>
      </form>

      {loading ? (
        <SkeletonList rows={3} />
      ) : products.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {products.map(p => (
            <ProductRow
              key={p.id}
              p={p}
              onUpload={f => uploadImage(p.id, f)}
              onRemoveImage={() => removeImage(p.id)}
              onStockChange={delta => handleStockChange(p.id, delta)}
              onFieldUpdate={(field, value) => handleFieldUpdate(p.id, field, value)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Package}
          title="ምርቶች ይጨምሩ / Add your first product"
          description="Use the form above to add what you sell. MiniMe will quote prices and check stock automatically."
        />
      )}
    </div>
  );
}

function ProductRow({ p, onUpload, onRemoveImage, onStockChange, onFieldUpdate }) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceVal, setPriceVal] = useState(String(p.price ?? ''));
  const [stockInput, setStockInput] = useState(false);
  const [stockVal, setStockVal] = useState(String(p.stock_quantity ?? 0));

  const qty = p.stock_quantity ?? 0;
  const threshold = p.low_stock_threshold ?? DEFAULT_LOW_THRESHOLD;
  const outOfStock = qty <= 0;
  const lowStock = !outOfStock && qty <= threshold;
  const stockColor = outOfStock ? COLORS.red : lowStock ? COLORS.amber : COLORS.green;
  const stockLabel = outOfStock ? 'Out of stock' : lowStock ? 'Low stock' : 'in stock';

  function savePrice() {
    const v = parseFloat(priceVal);
    if (!isNaN(v) && v !== p.price) onFieldUpdate('price', v);
    setEditingPrice(false);
  }

  function saveStock() {
    const v = parseInt(stockVal);
    if (!isNaN(v) && v >= 0) {
      onStockChange(v - qty); // delta
    }
    setStockInput(false);
  }

  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${outOfStock ? COLORS.red : COLORS.border}`,
      borderRadius: RADII.lg,
      padding: 12,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      boxShadow: SHADOW.card,
      opacity: outOfStock ? 0.85 : 1,
    }}>
      <ImageBlock url={p.image_url} onUpload={onUpload} onRemove={onRemoveImage} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}
          {p.name_am && <span style={{ color: COLORS.textHint, marginLeft: 8, fontSize: 13, fontWeight: 400 }}>({p.name_am})</span>}
        </p>

        {/* Inline price edit */}
        {editingPrice ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input
              autoFocus
              type="number"
              value={priceVal}
              onChange={e => setPriceVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') savePrice(); if (e.key === 'Escape') setEditingPrice(false); }}
              style={{ width: 90, padding: '4px 8px', fontSize: 14, borderRadius: RADII.sm, border: `1px solid ${COLORS.teal}`, outline: 'none', fontFamily: FONT.body }}
            />
            <span style={{ fontSize: 13, color: COLORS.textHint }}>{p.currency || 'ETB'}</span>
            <button onClick={savePrice} style={{ background: COLORS.teal, color: '#FFF', border: 'none', borderRadius: RADII.sm, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Check size={13} /></button>
            <button onClick={() => setEditingPrice(false)} style={{ background: COLORS.border, color: COLORS.textHint, border: 'none', borderRadius: RADII.sm, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><X size={13} /></button>
          </div>
        ) : (
          <p
            onClick={() => { setPriceVal(String(p.price ?? '')); setEditingPrice(true); }}
            title="Tap to edit price"
            style={{ fontSize: 14, color: COLORS.teal, margin: '3px 0 0', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {p.price} {p.currency || 'ETB'} <Edit2 size={11} color={COLORS.textHint} />
          </p>
        )}

        {p.description && (
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {p.description}
          </p>
        )}
      </div>

      {/* Stock controls */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        {stockInput ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <input
              autoFocus
              type="number"
              value={stockVal}
              onChange={e => setStockVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveStock(); if (e.key === 'Escape') setStockInput(false); }}
              style={{ width: 56, padding: '4px 6px', fontSize: 16, fontWeight: 700, textAlign: 'center', borderRadius: RADII.sm, border: `1px solid ${COLORS.teal}`, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={saveStock} style={{ background: COLORS.teal, color: '#FFF', border: 'none', borderRadius: RADII.sm, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}>✓</button>
              <button onClick={() => setStockInput(false)} style={{ background: COLORS.border, color: COLORS.textHint, border: 'none', borderRadius: RADII.sm, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => onStockChange(-1)}
                disabled={qty <= 0}
                style={{ width: 26, height: 26, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: COLORS.bg, cursor: qty > 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: qty > 0 ? 1 : 0.35 }}
              >
                <Minus size={12} color={COLORS.textHint} />
              </button>
              <span
                onClick={() => { setStockVal(String(qty)); setStockInput(true); }}
                title="Tap to set exact quantity"
                style={{ fontSize: 20, fontWeight: 700, color: stockColor, minWidth: 28, textAlign: 'center', cursor: 'pointer' }}
              >
                {qty}
              </span>
              <button
                onClick={() => onStockChange(1)}
                style={{ width: 26, height: 26, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: COLORS.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Plus size={12} color={COLORS.textHint} />
              </button>
            </div>
            <p style={{ fontSize: 10, color: stockColor, margin: '2px 0 0', fontWeight: outOfStock || lowStock ? 600 : 400 }}>
              {stockLabel}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ImageBlock({ url, onUpload, onRemove }) {
  const [hovered, setHovered] = useState(false);

  if (url) {
    return (
      <div
        style={{ position: 'relative', width: 64, height: 64, borderRadius: RADII.md, overflow: 'hidden', flexShrink: 0 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <button
          onClick={onRemove}
          title="Remove photo"
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'rgba(0,0,0,0.6)', color: '#FFF',
            border: 'none', borderRadius: '50%',
            width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
            padding: 0,
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    );
  }

  return (
    <label style={{
      width: 64, height: 64,
      borderRadius: RADII.md,
      border: `2px dashed ${COLORS.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    }}>
      <Camera size={20} color={COLORS.textHint} />
      <input
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => onUpload(e.target.files?.[0])}
      />
    </label>
  );
}
