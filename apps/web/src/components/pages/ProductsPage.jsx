'use client';
/**
 * ProductsPage — redesigned with design tokens.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
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
  const [archivedProducts, setArchivedProducts] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', price: '', stock_quantity: '', name_am: '', description: '', low_stock_threshold: '' });
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [variantParent, setVariantParent] = useState(null); // product to add variant for
  const [variantName, setVariantName] = useState('');
  const [variantStock, setVariantStock] = useState('');
  const [importing, setImporting] = useState(false);
  const [bulkDescribing, setBulkDescribing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bulkDescProgress, setBulkDescProgress] = useState('');
  const csvRef = useRef(null);
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
    setArchivedProducts(archived || []);
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

  async function importCSV(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !businessId) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (!lines.length) return;
      // Skip header row if it looks like one
      const start = lines[0].toLowerCase().includes('name') ? 1 : 0;
      let imported = 0;
      for (const line of lines.slice(start)) {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const name = cols[0]; if (!name) continue;
        const price = parseFloat(cols[1]) || null;
        const stock = parseInt(cols[2]) || 0;
        const description = cols[3] || null;
        await supabase.from('products').insert({
          business_id: businessId, name, price, stock_quantity: stock,
          description, is_active: true,
        });
        imported++;
      }
      alert(`Imported ${imported} products!`);
      await fetchProducts(businessId);
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally { setImporting(false); }
  }

  async function generateAllDescriptions() {
    const needsDesc = products.filter(p => !p.description);
    if (!needsDesc.length || !initData) return;
    setBulkDescribing(true);
    let done = 0;
    for (const p of needsDesc) {
      setBulkDescProgress(`${done}/${needsDesc.length} — ${p.name}`);
      try {
        const r = await fetch(`/api/products/${p.id}/describe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ lang: 'english' }),
        });
        const j = await r.json();
        if (j.description) {
          await supabase.from('products').update({ description: j.description }).eq('id', p.id);
        }
      } catch {}
      done++;
      await new Promise(r => setTimeout(r, 300)); // rate limit
    }
    setBulkDescribing(false);
    setBulkDescProgress('');
    await fetchProducts(businessId);
  }

  async function addVariant() {
    if (!variantParent || !variantName.trim()) return;
    // Strip any existing [variant] from parent name to get the base
    const baseName = variantParent.name.replace(/\s*\[[^\]]+\]$/, '').trim();
    const newName = `${baseName} [${variantName.trim()}]`;
    await supabase.from('products').insert({
      business_id: businessId,
      name: newName,
      price: variantParent.price,
      currency: variantParent.currency,
      stock_quantity: parseInt(variantStock || '0'),
      description: variantParent.description || null,
      is_active: true,
    });
    setVariantParent(null); setVariantName(''); setVariantStock('');
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
    if (!confirm('Remove the photo?')) return;
    await fetch(`/api/products/${productId}/image`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    await fetchProducts(businessId);
  }

  function sharePriceList() {
    const lines = [`🛍️ *${business?.name || 'Our Products'} — Price List*\n`];
    for (const p of products.filter(p => p.price != null)) {
      const price = `${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}`;
      const stock = (p.stock_quantity ?? 0) <= 0 ? ' _(out of stock)_' : '';
      lines.push(`• *${p.name}* — ${price}${stock}`);
    }
    if (business?.address) lines.push(`\n📍 ${business.address}`);
    if (business?.telegram_bot_username) {
      lines.push(`\n💬 Order via Telegram: t.me/${business.telegram_bot_username}`);
    } else if (business?.shop_code) {
      lines.push(`\n💬 Order via Telegram: t.me/MiniMeAgentBot?start=shop_${business.shop_code}`);
    }
    const text = lines.join('\n');
    if (navigator.share) {
      navigator.share({ text });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => alert('Price list copied to clipboard!'));
    }
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageHeader
          title="Products & Inventory"
          subtitleAm="ምርቶች"
          subtitleEn="What you sell — MiniMe quotes prices and shows photos"
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Bulk AI descriptions */}
          {products.filter(p => !p.description).length > 0 && (
            <button onClick={generateAllDescriptions} disabled={bulkDescribing} style={{
              border: `1px solid rgba(79,163,138,.3)`, borderRadius: RADII.md,
              background: 'rgba(79,163,138,.08)', padding: '7px 12px', fontSize: 12,
              fontWeight: 600, cursor: bulkDescribing ? 'default' : 'pointer',
              fontFamily: FONT.body, color: COLORS.teal, height: 36,
            }}>
              {bulkDescribing ? `✨ ${bulkDescProgress}` : `✨ Auto-describe (${products.filter(p => !p.description).length})`}
            </button>
          )}
          {/* CSV import */}
          <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={importCSV} />
          <button onClick={() => csvRef.current?.click()} disabled={importing} style={{
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
            background: COLORS.surface, padding: '7px 12px', fontSize: 12,
            fontWeight: 600, cursor: importing ? 'default' : 'pointer', fontFamily: FONT.body,
            color: COLORS.textSecondary, flexShrink: 0, height: 36,
          }}>
            {importing ? 'Importing…' : '↑ Import CSV'}
          </button>
          {/* Share price list */}
          {products.length > 0 && (
            <button onClick={sharePriceList} style={{
              border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
              background: COLORS.surface, padding: '7px 12px', fontSize: 12,
              fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
              color: COLORS.textSecondary, flexShrink: 0, height: 36,
            }}>
              📤 Share
            </button>
          )}
        </div>
      </div>

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
        {/* Required: name + price */}
        <input
          placeholder="Product name *"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
          required
          autoFocus={products.length === 0}
        />
        <input
          placeholder="Price (ETB) *"
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

        {/* Toggle advanced fields */}
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          style={{
            gridColumn: '1 / -1', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: FONT.body, fontSize: 12,
            color: COLORS.textHint, textAlign: 'left', padding: '0 2px',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {showAdvanced ? '▾ Fewer options' : '▸ More options (Amharic name, description, low-stock alert)'}
        </button>

        {showAdvanced && (
          <>
            <input
              placeholder="Amharic name (optional)"
              value={form.name_am}
              onChange={e => setForm(p => ({ ...p, name_am: e.target.value }))}
              style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
            />
            <textarea
              placeholder="Short description — helps MiniMe answer 'what is it?'"
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={2}
              style={{ ...INPUT_BASE, resize: 'none', gridColumn: '1 / -1' }}
            />
            <input
              placeholder="Low-stock alert at (default: 10)"
              type="number"
              inputMode="numeric"
              value={form.low_stock_threshold}
              onChange={e => setForm(p => ({ ...p, low_stock_threshold: e.target.value }))}
              style={{ ...INPUT_BASE, gridColumn: '1 / -1' }}
            />
          </>
        )}

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
          You can add a photo and description to each product after creating it.
        </p>
      </form>

      {/* Power tools — only after first product added, or when explicitly useful */}
      {(products.length > 0 || importing) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {products.filter(p => !p.description).length > 0 && (
            <button onClick={generateAllDescriptions} disabled={bulkDescribing} style={{
              border: `1px solid rgba(79,163,138,.3)`, borderRadius: RADII.md,
              background: 'rgba(79,163,138,.08)', padding: '7px 12px', fontSize: 12,
              fontWeight: 600, cursor: bulkDescribing ? 'default' : 'pointer',
              fontFamily: FONT.body, color: COLORS.teal, height: 36,
            }}>
              {bulkDescribing ? `✨ ${bulkDescProgress}` : `✨ Auto-describe (${products.filter(p => !p.description).length})`}
            </button>
          )}
          <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={importCSV} />
          <button onClick={() => csvRef.current?.click()} disabled={importing} style={{
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
            background: COLORS.surface, padding: '7px 12px', fontSize: 12,
            fontWeight: 600, cursor: importing ? 'default' : 'pointer', fontFamily: FONT.body,
            color: COLORS.textSecondary, height: 36,
          }}>
            {importing ? 'Importing…' : '↑ Import CSV'}
          </button>
          {products.length > 0 && (
            <button onClick={sharePriceList} style={{
              border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
              background: COLORS.surface, padding: '7px 12px', fontSize: 12,
              fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
              color: COLORS.textSecondary, height: 36,
            }}>
              📤 Share price list
            </button>
          )}
        </div>
      )}

      {/* Search */}
      {products.length > 4 && (
        <div style={{ marginBottom: 12 }}>
          <input
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: COLORS.surface, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, padding: '10px 14px',
              fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
              outline: 'none',
            }}
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : products.length ? (() => {
        const q = search.trim().toLowerCase();
        const shown = q
          ? products.filter(p =>
              (p.name || '').toLowerCase().includes(q) ||
              (p.name_am || '').toLowerCase().includes(q) ||
              (p.description || '').toLowerCase().includes(q)
            )
          : products;

        // Group by category if products have categories and no search active
        const hasCategories = !q && products.some(p => p.category);
        const renderRow = p => (
          <ProductRow
            key={p.id}
            p={p}
            onUpload={f => uploadImage(p.id, f)}
            onRemoveImage={() => removeImage(p.id)}
            onStockChange={delta => handleStockChange(p.id, delta)}
            onFieldUpdate={(field, value) => handleFieldUpdate(p.id, field, value)}
            onAddVariant={() => { setVariantParent(p); setVariantName(''); setVariantStock(''); }}
          />
        );

        if (hasCategories) {
          const groups = {};
          for (const p of shown) {
            const cat = p.category || 'Other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(p);
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {Object.entries(groups).map(([cat, prods]) => (
                <div key={cat}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 2 }}>
                    {cat} ({prods.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {prods.map(renderRow)}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: COLORS.textHint, fontSize: 14 }}>No products matching "{search}"</div>}
          {shown.map(renderRow)}
        </div>
        );
      })() : (
        <EmptyState
          icon={Package}
          title="ምርቶች ይጨምሩ / Add your first product"
          description="Use the form above to add what you sell. MiniMe will quote prices and check stock automatically."
        />
      )}

      {/* Archived products */}
      {/* Variant add modal */}
      {variantParent && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(14,40,35,.5)', display: 'flex', alignItems: 'flex-end',
        }} onClick={() => setVariantParent(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px',
            width: '100%', boxSizing: 'border-box',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8A9590', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              Add variant to
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#0E2823', marginBottom: 18 }}>
              {variantParent.name.replace(/\s*\[[^\]]+\]$/, '')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#8A9590', display: 'block', marginBottom: 4 }}>Variant name (e.g. S, M, L, Red, Blue)</label>
                <input
                  autoFocus
                  value={variantName}
                  onChange={e => setVariantName(e.target.value)}
                  placeholder="e.g. Medium / Navy Blue / 42"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #E4DED1', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#0E2823', outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#8A9590', display: 'block', marginBottom: 4 }}>Stock quantity</label>
                <input
                  type="number"
                  value={variantStock}
                  onChange={e => setVariantStock(e.target.value)}
                  placeholder="0"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #E4DED1', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#0E2823', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={addVariant} disabled={!variantName.trim()} style={{
                  flex: 2, padding: '12px', borderRadius: 999, border: 'none',
                  background: variantName.trim() ? '#0E2823' : '#E4DED1',
                  color: variantName.trim() ? '#FBF8F1' : '#8A9590',
                  fontSize: 14, fontWeight: 600, cursor: variantName.trim() ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                }}>Add variant</button>
                <button onClick={() => setVariantParent(null)} style={{
                  flex: 1, padding: '12px', borderRadius: 999, border: '1px solid #E4DED1',
                  background: '#fff', color: '#8A9590', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {archivedProducts.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowArchived(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: COLORS.textHint, fontWeight: 600,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '6px 0', fontFamily: FONT.body,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {showArchived ? '▾' : '▸'} Archived ({archivedProducts.length})
          </button>
          {showArchived && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {archivedProducts.map(p => (
                <div key={p.id} style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.lg, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: COLORS.textHint }}>{p.price} {p.currency || 'ETB'} · archived</div>
                  </div>
                  <button
                    onClick={async () => {
                      await supabase.from('products').update({ is_active: true }).eq('id', p.id);
                      fetchProducts(businessId);
                    }}
                    style={{
                      border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
                      background: COLORS.bg, padding: '5px 12px', fontSize: 12,
                      cursor: 'pointer', fontFamily: FONT.body, color: COLORS.textPrimary,
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProductRow({ p, onUpload, onRemoveImage, onStockChange, onFieldUpdate, onAddVariant }) {
  const { initData } = useTelegram();
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceVal, setPriceVal] = useState(String(p.price ?? ''));
  const [stockInput, setStockInput] = useState(false);
  const [stockVal, setStockVal] = useState(String(p.stock_quantity ?? 0));
  const [generatingDesc, setGeneratingDesc] = useState(false);

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

        {p.description ? (
          <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {p.description}
          </p>
        ) : (
          <button
            onClick={async () => {
              if (!initData || generatingDesc) return;
              setGeneratingDesc(true);
              try {
                const r = await fetch(`/api/products/${p.id}/describe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
                  body: JSON.stringify({ lang: 'english' }),
                });
                const j = await r.json();
                if (j.description) onFieldUpdate('description', j.description);
              } catch {}
              setGeneratingDesc(false);
            }}
            style={{
              background: 'none', border: 'none', cursor: generatingDesc ? 'default' : 'pointer',
              fontSize: 11, color: COLORS.teal, padding: '2px 0', fontFamily: FONT.body,
              fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {generatingDesc ? '✨ Writing…' : '✨ Generate description'}
          </button>
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
            {/* Add variant */}
            {onAddVariant && (
              <button
                onClick={onAddVariant}
                title="Add a variant (size, color, etc.)"
                style={{
                  marginTop: 4, border: 'none', background: 'none',
                  cursor: 'pointer', fontSize: 10, color: COLORS.teal,
                  padding: '2px 0', fontFamily: FONT.body, fontWeight: 600,
                }}
              >
                + Variant
              </button>
            )}
            {/* Quick deactivate toggle */}
            <button
              onClick={() => onFieldUpdate('is_active', false)}
              title="Archive this product (hide from catalog)"
              style={{
                marginTop: 2, border: 'none', background: 'none',
                cursor: 'pointer', fontSize: 10, color: COLORS.textHint,
                padding: '2px 0', fontFamily: FONT.body,
              }}
            >
              Archive
            </button>
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
