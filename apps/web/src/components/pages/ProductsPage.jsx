'use client';
/**
 * ProductsPage — redesigned with design tokens.
 */
import { useEffect, useState } from 'react';
import { Package, Plus, Camera, Trash2 } from 'lucide-react';
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

export default function ProductsPage() {
  const { business, initData } = useTelegram();
  const supabase = createClient();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', price: '', stock_quantity: '', name_am: '', description: '' });
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
      business_id: businessId,
    });
    setForm({ name: '', price: '', stock_quantity: '', name_am: '', description: '' });
    await fetchProducts(businessId);
    setAdding(false);
  }

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
          placeholder="Stock"
          type="number"
          inputMode="numeric"
          value={form.stock_quantity}
          onChange={e => setForm(p => ({ ...p, stock_quantity: e.target.value }))}
          style={INPUT_BASE}
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

function ProductRow({ p, onUpload, onRemoveImage }) {
  const lowStock = p.low_stock_threshold && p.stock_quantity <= p.low_stock_threshold;
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg,
      padding: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: SHADOW.card,
    }}>
      <ImageBlock url={p.image_url} onUpload={onUpload} onRemove={onRemoveImage} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.name}
          {p.name_am && (
            <span style={{ color: COLORS.textHint, marginLeft: 8, fontSize: 13, fontWeight: 400 }}>({p.name_am})</span>
          )}
        </p>
        <p style={{ fontSize: 14, color: COLORS.teal, margin: '3px 0 0', fontWeight: 600 }}>
          {p.price} {p.currency || 'ETB'}
        </p>
        {p.description && (
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {p.description}
          </p>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ fontSize: 20, fontWeight: 700, margin: 0, color: lowStock ? COLORS.red : COLORS.green }}>
          {p.stock_quantity ?? 0}
        </p>
        <p style={{ fontSize: 11, color: COLORS.textHint, margin: 0 }}>in stock</p>
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
