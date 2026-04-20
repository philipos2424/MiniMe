'use client';
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import CustomerCard from '../customers/CustomerCard';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { SkeletonList } from '../ui/Skeleton';

export default function CustomersPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ vip: 0, regular: 0, new: 0 });

  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);
    supabase
      .from('customers')
      .select('*')
      .eq('business_id', business.id)
      .order('last_active_at', { ascending: false })
      .then(({ data }) => {
        const c = data || [];
        setCustomers(c);
        setCounts({
          vip: c.filter(x => x.tier === 'vip').length,
          regular: c.filter(x => x.tier === 'regular').length,
          new: c.filter(x => x.tier === 'new').length,
        });
        setLoading(false);
      });
  }, [business?.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitleAm="ደንበኞች"
        subtitleEn="People who've messaged your business"
      />
      <div className="grid grid-cols-3 gap-4">
        {[
          ['VIP', counts.vip, '#7C3AED'],
          ['Regular', counts.regular, '#059669'],
          ['New', counts.new, '#D97706'],
        ].map(([label, count, color]) => (
          <div
            key={label}
            className="bg-card border border-border rounded-xl p-4 text-center hover:border-gold/40 transition"
          >
            <div className="font-display text-3xl" style={{ color }}>
              {count}
            </div>
            <div className="text-muted text-xs uppercase tracking-wide mt-1">{label}</div>
          </div>
        ))}
      </div>
      {loading ? (
        <SkeletonList rows={4} />
      ) : customers.length ? (
        <div className="grid gap-3">
          {customers.map(c => (
            <CustomerCard key={c.id} customer={c} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="ገና ምንም ደንበኛ የለም / No customers yet"
          description="As people message your bot, their profiles will appear here."
        />
      )}
    </div>
  );
}
