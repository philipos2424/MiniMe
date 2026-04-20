'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import WeeklyChart from '../analytics/WeeklyChart';
import MetricCard from '../analytics/MetricCard';
import TopCustomers from '../analytics/TopCustomers';
import PageHeader from '../ui/PageHeader';
import { SkeletonGrid, SkeletonCard } from '../ui/Skeleton';

export default function AnalyticsPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [weekly, setWeekly] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!business?.id) return;
    async function load() {
      setLoading(true);
      const end = new Date().toISOString().split('T')[0];
      const start = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const { data: w } = await supabase
        .from('daily_analytics')
        .select('*')
        .eq('business_id', business.id)
        .gte('date', start)
        .lte('date', end)
        .order('date');
      setWeekly(w || []);

      const { data: c } = await supabase
        .from('customers')
        .select('*')
        .eq('business_id', business.id)
        .order('total_spent', { ascending: false })
        .limit(5);
      setTopCustomers(c || []);
      setLoading(false);
    }
    load();
  }, [business?.id]);

  const totals = weekly.reduce(
    (acc, d) => ({
      messages: acc.messages + d.total_messages,
      revenue: acc.revenue + Number(d.revenue),
      aiSent: acc.aiSent + d.ai_auto_sent,
      newCustomers: acc.newCustomers + d.new_customers,
    }),
    { messages: 0, revenue: 0, aiSent: 0, newCustomers: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitleAm="ትንታኔ"
        subtitleEn="Last 7 days at a glance"
      />
      {loading ? (
        <>
          <SkeletonGrid cols={4} />
          <SkeletonCard className="h-48" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Messages" value={totals.messages} />
            <MetricCard label="Revenue" value={`${totals.revenue.toFixed(0)} ETB`} />
            <MetricCard label="AI Auto-Sent" value={totals.aiSent} />
            <MetricCard label="New Customers" value={totals.newCustomers} />
          </div>
          <WeeklyChart data={weekly} />
          <TopCustomers customers={topCustomers} />
        </>
      )}
    </div>
  );
}
