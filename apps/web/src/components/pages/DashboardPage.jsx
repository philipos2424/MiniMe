'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import MetricsGrid from '../dashboard/MetricsGrid';
import LiveFeed from '../dashboard/LiveFeed';
import TrustLevelCard from '../dashboard/TrustLevelCard';
import PanicButton from '../dashboard/PanicButton';
import { SkeletonGrid, SkeletonCard } from '../ui/Skeleton';

export default function DashboardPage() {
  const { business, setBusiness, telegramUser } = useTelegram();
  const [todayStats, setTodayStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!business?.id) return;
    const today = new Date().toISOString().split('T')[0];
    setLoadingStats(true);
    supabase
      .from('daily_analytics')
      .select('*')
      .eq('business_id', business.id)
      .eq('date', today)
      .single()
      .then(({ data }) => {
        setTodayStats(data);
        setLoadingStats(false);
      });
  }, [business?.id]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greetingAm = hour < 12 ? 'እንደምን አደሩ' : hour < 17 ? 'እንደምን ዋሉ' : 'እንደምን አመሹ';
  const displayName = telegramUser?.first_name || business?.owner_name || 'Owner';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-gold-light tracking-tight">
            {greeting}, {displayName}
          </h1>
          <p className="text-muted text-sm mt-1">
            {greetingAm}{business?.name ? ` · ${business.name}` : ''}
          </p>
        </div>
        {business && <PanicButton business={business} onUpdate={setBusiness} />}
      </div>

      {business && <TrustLevelCard business={business} onUpdate={setBusiness} />}
      {loadingStats ? <SkeletonGrid cols={4} /> : todayStats ? <MetricsGrid stats={todayStats} /> : null}
      {business ? <LiveFeed businessId={business.id} /> : <SkeletonCard className="h-40" />}
    </div>
  );
}
