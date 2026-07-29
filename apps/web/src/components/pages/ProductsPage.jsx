'use client';
/**
 * ProductsPage — redesigned for clarity.
 *
 * UX principles:
 * 1. Answer only 3 questions: how many products, how to add, how to edit.
 * 2. Progressive disclosure: Add shows only name + price. Everything else after creation.
 * 3. One primary action per screen. Green reserved for CTAs only.
 * 4. All secondary actions (Archive, Delete, Variant) hidden behind ⋮ menu.
 * 5. Compact cards — fit 5-6 on screen at once.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Package, Plus, Trash2, X, Check, ChevronLeft, Search, MoreVertical, Camera } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { tgAlert, tgConfirm } from '../../lib/utils';
import { SkeletonList } from '../ui/Skeleton';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';
import { UpgradeSheet } from '../ui/UpgradeSheet';
import { isProBusiness, FREE_LIMITS } from '../../lib/plan';

// ─── Tokens (theme-aware CSS variables) ───────────────────────────────────────
const INK   = 'var(--ink)';
const PAPER = 'var(--paper)';
const CARD  = 'var(--card)';
const MUTED = 'var(--muted)';
const LINE  = 'var(--line)';
const LINE2 = 'var(--line-soft)';
const MINT  = 'var(--mint)';
const ERROR = 'var(--error)';
const GOLD  = 'var(--gold)';
const CREAM2 = 'var(--cream-2)';
const BODY  = FONT.body;
const SERIF = FONT.serif;

const DEFAULT_LOW_THRESHOLD = 10;

const CATEGORY_SUGGESTIONS = [
  'Services', 'Perfume & Fragrance', 'Gifts', 'Flowers', 'Clothing & Fashion',
  'Electronics', 'Food & Beverage', 'Beauty & Wellness', 'Printing', 'Photography',
  'Accessories', 'Home & Living', 'Other',
];

// ─── Shared input style ────────────────────────────────────────────────────────
const INPUT = {
  width: '100%', boxSizing: 'border-box',
  background: CREAM2, border: `1.5px solid ${LINE}`,
  borderRadius: 12, padding: '13px 14px',
  fontSize: 15, fontFamily: BODY, color: INK,
  outline: 'none', transition: 'border-color 0.15s',
};

// ─── Bottom Sheet Backdrop ─────────────────────────────────────────────────────
function Sheet({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(10,18,14,.55)',
        display: 'flex', alignItems: 'flex-end',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', background: CARD,
          borderRadius: '24px 24px 0 0',
          padding: '8px 20px 36px',
          boxSizing: 'border-box',
          maxHeight: '92vh', overflowY: 'auto',
          boxShadow: '0 -8px 40px rgba(10,18,14,.2)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 16px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: LINE }} />
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Add Product Sheet ─────────────────────────────────────────────────────────
// Progressive disclosure: only name + price. That's all that's needed to start.
function AddProductSheet({ open, onClose, onAdd, adding }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    if (open) { setName(''); setPrice(''); setTimeout(() => nameRef.current?.focus(), 100); }
  }, [open]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), price: price !== '' ? parseFloat(price) : null });
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: SERIF }}>New Product</div>
        <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
          Start selling in less than 10 seconds.
        </div>
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          ref={nameRef}
          placeholder="Product name"
          value={name}
          onChange={e => setName(e.target.value)}
          style={INPUT}
          required
        />
        <input
          placeholder="Price (ETB)"
          type="number"
          inputMode="decimal"
          value={price}
          onChange={e => setPrice(e.target.value)}
          style={INPUT}
        />
        <button
          type="submit"
          disabled={adding || !name.trim()}
          style={{
            marginTop: 4,
            background: adding || !name.trim() ? MUTED : MINT,
            color: '#fff', border: 'none',
            borderRadius: 999, padding: '15px 0',
            fontSize: 15, fontWeight: 600, fontFamily: BODY,
            cursor: adding || !name.trim() ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
        >
          <Plus size={16} />
          {adding ? 'Adding…' : 'Add Product'}
        </button>
      </form>
    </Sheet>
  );
}

// ─── Edit Product Sheet ────────────────────────────────────────────────────────
// Full edit: name, price, description, category, photo — shown only after tapping Edit in ⋮
function EditProductSheet({ open, product, onClose, onSave, onUpload, onRemoveImage, initData }) {
  const [name, setName]   = useState('');
  const [price, setPrice] = useState('');
  const [desc, setDesc]   = useState('');
  const [cat, setCat]     = useState('');
  const [saving, setSaving] = useState(false);
  const [genDesc, setGenDesc] = useState(false);

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setPrice(product.price != null ? String(product.price) : '');
      setDesc(product.description || '');
      setCat(product.category || '');
    }
  }, [product]);

  async function handleSave() {
    setSaving(true);
    await onSave({
      name: name.trim() || product.name,
      price: price !== '' ? parseFloat(price) : null,
      description: desc.trim() || null,
      category: cat.trim() || null,
    });
    setSaving(false);
    onClose();
  }

  async function generateDesc() {
    if (!initData || genDesc || !product) return;
    setGenDesc(true);
    try {
      const r = await fetch(`/api/products/${product.id}/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ lang: 'english' }),
      });
      const j = await r.json();
      if (j.description) setDesc(j.description);
    } catch {}
    setGenDesc(false);
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: SERIF }}>Edit Product</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <X size={20} color={MUTED} />
        </button>
      </div>

      {/* Photo */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 8, fontWeight: 500 }}>PHOTO</div>
        {product?.image_url ? (
          <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 12, overflow: 'hidden' }}>
            <img src={product.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              onClick={() => onRemoveImage(product.id)}
              style={{
                position: 'absolute', top: 4, right: 4,
                background: 'rgba(0,0,0,0.6)', border: 'none',
                borderRadius: '50%', width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <Trash2 size={11} color="#fff" />
            </button>
          </div>
        ) : (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: CREAM2, border: `1.5px dashed ${LINE}`,
            borderRadius: 12, padding: '12px 16px', cursor: 'pointer',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: LINE,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Camera size={18} color={MUTED} />
            </div>
            <div>
              <div style={{ fontSize: 14, color: INK, fontWeight: 500 }}>Add photo</div>
              <div style={{ fontSize: 12, color: MUTED }}>JPEG or PNG</div>
            </div>
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) onUpload(product.id, e.target.files[0]); }}
            />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input placeholder="Product name" value={name} onChange={e => setName(e.target.value)} style={INPUT} />
        <input placeholder="Price (ETB)" type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} style={INPUT} />
        <input list="mm-cat-suggestions" placeholder="Category (optional)" value={cat} onChange={e => setCat(e.target.value)} style={INPUT} />
        <datalist id="mm-cat-suggestions">
          {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
        </datalist>
        <div style={{ position: 'relative' }}>
          <textarea
            placeholder="Description — helps MiniMe answer 'what is it?'"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={3}
            style={{ ...INPUT, resize: 'none' }}
          />
          <button
            type="button"
            onClick={generateDesc}
            disabled={genDesc}
            style={{
              position: 'absolute', bottom: 10, right: 10,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: MINT, fontWeight: 600, fontFamily: BODY,
              padding: 0,
            }}
          >
            {genDesc ? '✨ Writing…' : '✨ AI'}
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            marginTop: 4,
            background: saving ? MUTED : MINT,
            color: '#fff', border: 'none',
            borderRadius: 999, padding: '15px 0',
            fontSize: 15, fontWeight: 600, fontFamily: BODY,
            cursor: saving ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Check size={16} />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </Sheet>
  );
}

// ─── Product Context Menu Sheet ────────────────────────────────────────────────
// The ⋮ menu. Hidden secondary actions only visible when needed.
function ProductMenuSheet({ open, product, onClose, onEdit, onAddVariant, onArchive, onDelete }) {
  if (!product) return null;

  const actions = [
    { label: 'Edit', icon: '✏️', color: INK, action: () => { onClose(); onEdit(); } },
    { label: 'Add Variant', icon: '🎨', color: INK, action: () => { onClose(); onAddVariant(); } },
    { label: 'Archive', icon: '📦', color: MUTED, action: () => { onClose(); onArchive(); } },
    { label: 'Delete', icon: '🗑️', color: ERROR, action: () => { onClose(); onDelete(); } },
  ];

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ fontSize: 13, color: MUTED, fontWeight: 500, marginBottom: 12 }}>
        {product.name}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {actions.map((a, i) => (
          <button
            key={a.label}
            onClick={a.action}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '14px 4px', fontFamily: BODY, fontSize: 16,
              color: a.color, textAlign: 'left',
              borderBottom: i < actions.length - 1 ? `1px solid ${LINE2}` : 'none',
            }}
          >
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ─── Add Variant Sheet ─────────────────────────────────────────────────────────
function AddVariantSheet({ open, product, onClose, onAdd }) {
  const [variantName, setVariantName] = useState('');
  const [variantStock, setVariantStock] = useState('');

  useEffect(() => { if (open) { setVariantName(''); setVariantStock(''); } }, [open]);

  async function handleAdd() {
    if (!variantName.trim()) return;
    await onAdd(variantName, variantStock);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: SERIF, marginBottom: 6 }}>
        Add Variant
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
        {product?.name?.replace(/\s*\[[^\]]+\]$/, '')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          autoFocus
          placeholder="Variant name (e.g. S, M, L, Red)"
          value={variantName}
          onChange={e => setVariantName(e.target.value)}
          style={INPUT}
        />
        <input
          type="number"
          placeholder="Stock quantity (optional)"
          value={variantStock}
          onChange={e => setVariantStock(e.target.value)}
          style={INPUT}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={handleAdd} disabled={!variantName.trim()} style={{
            flex: 2, padding: '14px', borderRadius: 999, border: 'none',
            background: variantName.trim() ? INK : LINE,
            color: variantName.trim() ? '#F4EEE1' : MUTED,
            fontSize: 15, fontWeight: 600, cursor: variantName.trim() ? 'pointer' : 'default',
            fontFamily: BODY,
          }}>
            Add Variant
          </button>
          <button onClick={onClose} style={{
            flex: 1, padding: '14px', borderRadius: 999,
            border: `1.5px solid ${LINE}`, background: 'none',
            color: MUTED, fontSize: 15, cursor: 'pointer', fontFamily: BODY,
          }}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ─── Import Sheet ──────────────────────────────────────────────────────────────
function ImportSheet({ open, business, onClose }) {
  const { initData } = useTelegram() || {};
  const [handle, setHandle] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const linked = business?.telegram_channel?.replace(/^@/, '') || business?.source_channel_username?.replace(/^@/, '') || '';
  const value = handle || linked;

  async function runImport() {
    const h = (value || '').trim().replace(/^@/, '');
    if (!initData || importing || !h) return;
    setImporting(true); setResult(null);
    try {
      const res = await fetch('/api/settings/channel/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ username: h }),
      });
      setResult(await res.json());
    } catch { setResult({ ok: false, reason: 'fetch_failed' }); }
    finally { setImporting(false); }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: SERIF, marginBottom: 6 }}>
        Import from Telegram
      </div>
      <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginBottom: 20 }}>
        Pull recent posts from your channel directly into the catalog. No re-posting needed. Works with public channels.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', flex: 1,
          background: CREAM2, border: `1.5px solid ${LINE}`,
          borderRadius: 12, padding: '0 14px',
        }}>
          <span style={{ color: MUTED, fontSize: 15 }}>@</span>
          <input
            value={value}
            onChange={e => setHandle(e.target.value.replace(/^@/, ''))}
            placeholder="your_channel"
            style={{
              flex: 1, border: 0, outline: 'none', background: 'transparent',
              padding: '13px 8px', fontSize: 15, color: INK, fontFamily: BODY,
            }}
          />
        </div>
        <button
          onClick={runImport}
          disabled={importing || !value.trim()}
          style={{
            background: importing || !value.trim() ? MUTED : MINT,
            color: '#fff', border: 0, borderRadius: 12,
            padding: '0 20px', fontSize: 14, fontWeight: 600, fontFamily: BODY,
            cursor: importing || !value.trim() ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
      {result && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6,
          color: result.ok && (result.added || result.updated) ? MINT : MUTED }}>
          {result.ok
            ? (result.added || result.updated)
              ? `✓ Imported ${result.added} new${result.updated ? ` and updated ${result.updated}` : ''} product${(result.added + result.updated) === 1 ? '' : 's'} from your last ${result.scanned} posts.`
              : `Scanned your last ${result.scanned} posts but found nothing priced to add.`
            : result.reason === 'private_or_empty'
              ? 'That channel has no public preview — it may be private.'
              : result.reason === 'no_channel'
                ? 'Enter your channel @username first.'
                : 'Could not read that channel. Check the @username and try again.'}
        </div>
      )}
    </Sheet>
  );
}

// ─── Compact Image Block ───────────────────────────────────────────────────────
function ImageBlock({ url, productId, onUpload, onRemove }) {
  const fileRef = useRef(null);

  if (url) {
    return (
      <div style={{ position: 'relative', width: 60, height: 60, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <label style={{
      width: 60, height: 60, borderRadius: 12,
      border: `1.5px dashed ${LINE}`, background: CREAM2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', flexShrink: 0,
    }}>
      <span style={{ fontSize: 22, color: MUTED, lineHeight: 1 }}>+</span>
      <input
        type="file" accept="image/*"
        style={{ display: 'none' }}
        onChange={e => onUpload(productId, e.target.files?.[0])}
      />
    </label>
  );
}

// ─── Compact Product Row ───────────────────────────────────────────────────────
// Answers: what is it, how much, how many. Nothing else.
function CompactProductRow({ p, onUpload, onStockChange, onFieldUpdate, onOpenMenu }) {
  const tracked = p.stock_quantity != null;
  const qty = p.stock_quantity ?? 0;
  const threshold = p.low_stock_threshold ?? DEFAULT_LOW_THRESHOLD;
  const outOfStock = tracked && qty <= 0;
  const lowStock   = tracked && !outOfStock && qty <= threshold;

  const stockColor = !tracked ? MUTED : outOfStock ? ERROR : lowStock ? GOLD : MINT;
  const stockLabel = !tracked
    ? 'Stock: Unlimited'
    : outOfStock
      ? 'Out of stock'
      : `Stock: ${qty}`;

  return (
    <div style={{
      background: CARD,
      border: `1px solid ${outOfStock ? 'rgba(184,84,80,.3)' : LINE2}`,
      borderRadius: 16,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: '0 1px 0 rgba(14,40,35,.03)',
    }}>
      {/* Image */}
      <ImageBlock
        url={p.image_url}
        productId={p.id}
        onUpload={onUpload}
        onRemove={() => {}}
      />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: INK, fontFamily: SERIF,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {p.name}
          {p.name_am && <span style={{ color: MUTED, fontSize: 12, fontWeight: 400, marginLeft: 6 }}>({p.name_am})</span>}
        </div>
        <div style={{ fontSize: 14, color: MINT, fontWeight: 600, marginTop: 2 }}>
          {p.price != null ? `${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : 'Price on request'}
        </div>
        <div style={{ fontSize: 12, color: stockColor, marginTop: 2, fontWeight: outOfStock || lowStock ? 600 : 400 }}>
          {stockLabel}
        </div>
      </div>

      {/* Quantity control */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => {
              if (!tracked) { onFieldUpdate('stock_quantity', 0); return; }
              if (qty > 0) onStockChange(-1);
            }}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: `1.5px solid ${LINE}`,
              background: 'none',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: MUTED, lineHeight: 1,
              opacity: tracked && qty <= 0 ? 0.35 : 1,
            }}
          >
            −
          </button>
          <span style={{
            fontSize: 17, fontWeight: 700, color: stockColor,
            minWidth: 36, textAlign: 'center', cursor: 'pointer',
          }}>
            {tracked ? qty : '∞'}
          </span>
          <button
            onClick={() => tracked ? onStockChange(1) : onFieldUpdate('stock_quantity', 1)}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              border: `1.5px solid ${MINT}`,
              background: 'none',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: MINT, lineHeight: 1,
            }}
          >
            +
          </button>
        </div>

        {/* ⋮ menu trigger */}
        <button
          onClick={onOpenMenu}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4,
          }}
        >
          <MoreVertical size={16} color={MUTED} />
        </button>
      </div>
    </div>
  );
}

// ─── Floating Action Button ────────────────────────────────────────────────────
function FAB({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Add product"
      style={{
        position: 'fixed', bottom: 88, right: 20, zIndex: 100,
        width: 52, height: 52, borderRadius: '50%',
        background: INK, color: '#F4EEE1',
        border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(14,40,35,.3)',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <Plus size={22} />
    </button>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ProductsPage() {
  const { business, initData } = useTelegram();
  const supabase = createClient();

  const [products, setProducts]             = useState([]);
  const [archivedProducts, setArchived]     = useState([]);
  const [loading, setLoading]               = useState(true);
  const [adding, setAdding]                 = useState(false);
  const [search, setSearch]                 = useState('');
  const [activeFilter, setActiveFilter]     = useState('All');
  const [showArchived, setShowArchived]     = useState(false);

  // Sheet states
  const [showAdd, setShowAdd]               = useState(false);
  const [showImport, setShowImport]         = useState(false);
  const [menuProduct, setMenuProduct]       = useState(null);
  const [editProduct, setEditProduct]       = useState(null);
  const [variantProduct, setVariantProduct] = useState(null);
  const [upgradeOpen, setUpgradeOpen]       = useState(false);

  const businessId = business?.id;

  useEffect(() => {
    if (businessId) fetchProducts(businessId);
  }, [businessId]);

  async function fetchProducts(bizId) {
    setLoading(true);
    const [{ data: active }, { data: archived }] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', bizId).eq('is_active', true).order('name'),
      supabase.from('products').select('*').eq('business_id', bizId).eq('is_active', false).order('name').limit(20),
    ]);
    setProducts(active || []);
    setArchived(archived || []);
    setLoading(false);
  }

  async function handleAdd({ name, price }) {
    if (!businessId) return;
    if (!isProBusiness(business) && products.length >= FREE_LIMITS.products) {
      setUpgradeOpen(true);
      return;
    }
    setAdding(true);
    await supabase.from('products').insert({
      name, price: price ?? null,
      stock_quantity: null, // untracked by default — "Stock: Unlimited"
      business_id: businessId, is_active: true,
    });
    setShowAdd(false);
    await fetchProducts(businessId);
    setAdding(false);
  }

  async function handleSaveEdit(productId, fields) {
    await supabase.from('products').update(fields).eq('id', productId);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, ...fields } : p));
  }

  const handleStockChange = useCallback(async (productId, delta) => {
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

  const handleDelete = useCallback(async (productId, name) => {
    const ok = await tgConfirm(`Delete "${name}"? This can't be undone.`);
    if (!ok) return;
    await supabase.from('products').delete().eq('id', productId);
    setProducts(prev => prev.filter(p => p.id !== productId));
    setArchived(prev => prev.filter(p => p.id !== productId));
  }, [supabase]);

  async function handleArchive(productId) {
    await supabase.from('products').update({ is_active: false }).eq('id', productId);
    await fetchProducts(businessId);
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
    await fetch(`/api/products/${productId}/image`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    await fetchProducts(businessId);
  }

  async function addVariant(variantName, variantStock) {
    if (!variantProduct || !variantName.trim()) return;
    const baseName = variantProduct.name.replace(/\s*\[[^\]]+\]$/, '').trim();
    await supabase.from('products').insert({
      business_id: businessId,
      name: `${baseName} [${variantName.trim()}]`,
      price: variantProduct.price,
      currency: variantProduct.currency,
      stock_quantity: variantStock !== '' ? parseInt(variantStock) : null,
      description: variantProduct.description || null,
      is_active: true,
    });
    setVariantProduct(null);
    await fetchProducts(businessId);
  }

  // ── Filtering ──
  const allCategories = [...new Set(products.filter(p => p.category).map(p => p.category))].sort();
  const filterPills   = ['All', ...allCategories, 'Archived'];

  const q = search.trim().toLowerCase();
  let shown = products;
  if (q) {
    shown = products.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.name_am || '').toLowerCase().includes(q)
    );
  } else if (activeFilter !== 'All' && activeFilter !== 'Archived') {
    shown = products.filter(p => p.category === activeFilter);
  }

  // Group by category when not searching/filtering
  const groupByCategory = !q && (activeFilter === 'All') && products.some(p => p.category);
  let groups = {};
  if (groupByCategory) {
    for (const p of shown) {
      const cat = p.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
  }

  const isStorePaused = business?.paused || business?.bot_paused;
  const storeName     = business?.name || 'Store';

  return (
    <div style={{ background: PAPER, minHeight: '100vh', fontFamily: BODY, color: INK, paddingBottom: 120 }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: INK, fontFamily: SERIF, letterSpacing: '-0.01em' }}>
              {storeName}
            </div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>
              {loading ? '…' : `${products.length} Product${products.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          {isStorePaused && (
            <div style={{
              background: 'rgba(184,84,80,.1)', color: ERROR,
              borderRadius: 999, padding: '4px 12px',
              fontSize: 12, fontWeight: 600,
            }}>
              Store Paused
            </div>
          )}
        </div>
      </div>

      {/* ── Upgrade gate ── */}
      <UpgradeSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature="unlimited_products" />

      {/* ── Search ── */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={16} color={MUTED}
            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          />
          <input
            placeholder="Search products…"
            value={search}
            onChange={e => { setSearch(e.target.value); setActiveFilter('All'); }}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: CARD, border: `1px solid ${LINE}`,
              borderRadius: 12, padding: '11px 14px 11px 38px',
              fontSize: 14, fontFamily: BODY, color: INK, outline: 'none',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              }}
            >
              <X size={14} color={MUTED} />
            </button>
          )}
        </div>

        {/* Filter pills — auto-generated from real categories */}
        {filterPills.length > 1 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginTop: 10, scrollbarWidth: 'none' }}>
            {filterPills.map(f => {
              const active = activeFilter === f && !search;
              return (
                <button
                  key={f}
                  onClick={() => { setActiveFilter(f); setSearch(''); if (f === 'Archived') setShowArchived(true); }}
                  style={{
                    flexShrink: 0,
                    background: active ? INK : CARD,
                    color: active ? '#F4EEE1' : MUTED,
                    border: `1px solid ${active ? INK : LINE}`,
                    borderRadius: 999, padding: '6px 14px',
                    fontSize: 13, fontWeight: 500, fontFamily: BODY,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {f}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Primary CTA (shown only when products exist to avoid empty-state confusion) ── */}
      {!loading && products.length > 0 && !search && activeFilter !== 'Archived' && (
        <div style={{ padding: '16px 20px 0' }}>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              width: '100%', background: MINT, color: '#fff', border: 'none',
              borderRadius: 14, padding: '14px 0',
              fontSize: 15, fontWeight: 600, fontFamily: BODY,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Plus size={17} />
            Add Product
          </button>
        </div>
      )}

      {/* ── Compact import link ── */}
      {!loading && products.length > 0 && !search && activeFilter !== 'Archived' && (
        <div style={{ padding: '10px 20px 0' }}>
          <button
            onClick={() => setShowImport(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, color: MUTED, fontFamily: BODY, padding: 0,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            Already have products? Import from Telegram →
          </button>
        </div>
      )}

      {/* ── Divider ── */}
      {!loading && products.length > 0 && (
        <div style={{ margin: '16px 20px 0', height: 1, background: LINE2 }} />
      )}

      {/* ── Product list ── */}
      <div style={{ padding: '16px 20px 0' }}>
        {loading ? (
          <SkeletonList rows={4} />
        ) : shown.length === 0 && !search && activeFilter === 'All' ? (
          // ── Empty state ──
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
            <div style={{ fontFamily: SERIF, fontSize: 22, color: INK, fontWeight: 600 }}>No products yet</div>
            <div style={{ fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 1.6, maxWidth: 240, margin: '8px auto 0' }}>
              Add your first product and MiniMe will quote prices automatically.
            </div>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                marginTop: 24,
                background: MINT, color: '#fff', border: 'none',
                borderRadius: 999, padding: '14px 28px',
                fontSize: 15, fontWeight: 600, fontFamily: BODY,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              <Plus size={16} />
              Add Product
            </button>
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setShowImport(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 13, color: MUTED, fontFamily: BODY,
                }}
              >
                Already have products? Import from Telegram →
              </button>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 14, color: MUTED }}>
            No products matching "{search || activeFilter}"
          </div>
        ) : groupByCategory ? (
          // Grouped by category
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {Object.entries(groups).map(([cat, prods]) => (
              <div key={cat}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: MUTED,
                  marginBottom: 10, paddingLeft: 2,
                  letterSpacing: '0.01em',
                }}>
                  {cat} ({prods.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {prods.map(p => (
                    <CompactProductRow
                      key={p.id} p={p}
                      onUpload={uploadImage}
                      onStockChange={delta => handleStockChange(p.id, delta)}
                      onFieldUpdate={(field, val) => handleFieldUpdate(p.id, field, val)}
                      onOpenMenu={() => setMenuProduct(p)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Flat list (search / filter / no categories)
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map(p => (
              <CompactProductRow
                key={p.id} p={p}
                onUpload={uploadImage}
                onStockChange={delta => handleStockChange(p.id, delta)}
                onFieldUpdate={(field, val) => handleFieldUpdate(p.id, field, val)}
                onOpenMenu={() => setMenuProduct(p)}
              />
            ))}
          </div>
        )}

        {/* ── Archived section ── */}
        {(activeFilter === 'Archived' || archivedProducts.length > 0) && activeFilter !== 'All' && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, marginBottom: 10 }}>
              Archived ({archivedProducts.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {archivedProducts.map(p => (
                <div key={p.id} style={{
                  background: CARD, border: `1px solid ${LINE2}`,
                  borderRadius: 16, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{p.price} {p.currency || 'ETB'} · archived</div>
                  </div>
                  <button
                    onClick={async () => { await supabase.from('products').update({ is_active: true }).eq('id', p.id); fetchProducts(businessId); }}
                    style={{ border: `1px solid ${LINE}`, borderRadius: 999, background: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: BODY, color: INK }}
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    style={{ border: `1px solid ${ERROR}`, borderRadius: 999, background: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: BODY, color: ERROR }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Also show archived when filter is All (collapsed toggle) */}
        {activeFilter === 'All' && !search && archivedProducts.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <button
              onClick={() => setShowArchived(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: MUTED, fontWeight: 500, padding: '6px 0',
                fontFamily: BODY, display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {showArchived ? '▾' : '▸'} Archived ({archivedProducts.length})
            </button>
            {showArchived && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {archivedProducts.map(p => (
                  <div key={p.id} style={{
                    background: CARD, border: `1px solid ${LINE2}`,
                    borderRadius: 16, padding: '12px 14px',
                    display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{p.price} {p.currency || 'ETB'} · archived</div>
                    </div>
                    <button
                      onClick={async () => { await supabase.from('products').update({ is_active: true }).eq('id', p.id); fetchProducts(businessId); }}
                      style={{ border: `1px solid ${LINE}`, borderRadius: 999, background: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: BODY, color: INK }}
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      style={{ border: `1px solid ${ERROR}`, borderRadius: 999, background: 'none', padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: BODY, color: ERROR }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Floating Add Button ── */}
      <FAB onClick={() => setShowAdd(true)} />

      {/* ── Sheets ── */}
      <AddProductSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={handleAdd}
        adding={adding}
      />

      <ImportSheet
        open={showImport}
        business={business}
        onClose={() => setShowImport(false)}
      />

      <ProductMenuSheet
        open={!!menuProduct}
        product={menuProduct}
        onClose={() => setMenuProduct(null)}
        onEdit={() => { setEditProduct(menuProduct); setMenuProduct(null); }}
        onAddVariant={() => { setVariantProduct(menuProduct); setMenuProduct(null); }}
        onArchive={() => handleArchive(menuProduct.id)}
        onDelete={() => handleDelete(menuProduct.id, menuProduct.name)}
      />

      <EditProductSheet
        open={!!editProduct}
        product={editProduct}
        onClose={() => setEditProduct(null)}
        onSave={(fields) => handleSaveEdit(editProduct.id, fields)}
        onUpload={uploadImage}
        onRemoveImage={removeImage}
        initData={initData}
      />

      <AddVariantSheet
        open={!!variantProduct}
        product={variantProduct}
        onClose={() => setVariantProduct(null)}
        onAdd={addVariant}
      />
    </div>
  );
}

// Keep ImportPaths exported for any legacy usage
export function ImportPaths({ business }) {
  return null; // replaced by compact ImportSheet above
}
