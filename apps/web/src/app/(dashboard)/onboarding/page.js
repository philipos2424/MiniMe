'use client';
import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTelegram } from '../../../context/TelegramContext';
import { isOnboarded } from '../../../lib/onboarding-status';
import GuidedOnboarding from '../../../components/onboarding/GuidedOnboarding';

function Onboarding() {
  const context = useTelegram();
  const router = useRouter();
  const params = useSearchParams();
  const preview = params.get('preview') === '1';
  const arrived = useRef(false);
  useEffect(() => {
    if (context.loading || arrived.current) return;
    arrived.current = true;
    // Lock the initial check: activation must not interrupt the success screen.
    if (!preview && isOnboarded(context.business)) router.replace('/');
  }, [context.loading, context.business, preview, router]);
  if (context.loading) return <p role="status">Opening MiniMe…</p>;
  const start = typeof window !== 'undefined' ? window.Telegram?.WebApp?.initDataUnsafe?.start_param || '' : '';
  const referralCode = /^ref_([a-z0-9]{4,32})$/i.exec(start)?.[1] || params.get('ref');
  return <GuidedOnboarding {...context} preview={preview} referralCode={referralCode} onExit={() => router.replace('/')} />;
}
export default function OnboardingPage() {
  return <Suspense fallback={<p role="status">Opening MiniMe…</p>}><Onboarding /></Suspense>;
}
