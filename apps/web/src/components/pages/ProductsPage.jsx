'use client';
import { useEffect, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { SkeletonList } from '../ui/Skeleton';

export default function ProductsPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', price: '', stock_quantity: '', name_am: '' });
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
      stock_quantity: parseInt(form.stock_quantity),
      business_id: businessId,
    });
    setForm({ name: '', price: '', stock_quantity: '', name_am: '' });
    await fetchProducts(businessId);
    setAdding(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & Inventory"
        subtitleAm="ምርቶች"
        subtitleEn="What you sell and how much is left"
      />
      <form
        onSubmit={handleAdd}
        className="bg-card border border-border rounded-xl p-4 grid grid-cols-2 gap-3"
      >
        <input
          placeholder="Product name"
          value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
          required
        />
        <input
          placeholder="Amharic name (optional)"
          value={form.name_am}
          onChange={e => setForm(p => ({ ...p, name_am: e.target.value }))}
          className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
        />
        <input
          placeholder="Price (ETB)"
          type="number"
          value={form.price}
          onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
          className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
          required
        />
        <input
          placeholder="Stock quantity"
          type="number"
          value={form.stock_quantity}
          onChange={e => setForm(p => ({ ...p, stock_quantity: e.target.value }))}
          className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
          required
        />
        <button
          type="submit"
          disabled={adding}
          className="col-span-2 bg-gold text-bg font-semibold py-2.5 min-h-[44px] rounded-lg hover:bg-gold-light transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Plus size={16} /> {adding ? 'Adding...' : 'Add Product'}
        </button>
      </form>
      {loading ? (
        <SkeletonList rows={3} />
      ) : products.length ? (
        <div className="space-y-2">
          {products.map(p => (
            <div
              key={p.id}
              className="bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:border-gold/40 transition"
            >
              <div>
                <p className="text-gold-light font-medium">
                  {p.name}
                  {p.name_am && <span className="text-muted ml-2">({p.name_am})</span>}
                </p>
                <p className="text-gold text-sm">{p.price} ETB</p>
              </div>
              <div
                className={`text-right ${
                  p.stock_quantity <= p.low_stock_threshold ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                <p className="font-display text-xl">{p.stock_quantity}</p>
                <p className="text-xs text-muted">in stock</p>
              </div>
            </div>
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
