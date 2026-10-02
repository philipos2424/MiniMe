'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { HomeCoach, useHomeCoach } from '../ui/HomeCoach';
import { FeedbackModal } from '../layout/DashboardShell';
import HomeOverview from '../dashboard/HomeOverview';
import GettingStarted from '../dashboard/GettingStarted';

export default function DashboardPage() {
  const { business, initData } = useTelegram() || {};

  const [feed, setFeed] = useState(null);
  const [feedError, setFeedError] = useState(false);
  const [retry, setRetry] = useState(0);

  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackPromptToken, setFeedbackPromptToken] = useState(null);

  const homeCoach = useHomeCoach({ autoOpen: false });

  // A scheduled outreach feedback prompt (see cron/outreach-rules) deep-links
  // here with ?feedback_prompt=<token> so tapping the Telegram message opens
  // this same modal pre-attributed to what asked for it, instead of a
  // separate feedback surface.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('feedback_prompt');
    if (token) { setFeedbackPromptToken(token); setShowFeedback(true); }
  }, []);

  // Load feed
  useEffect(() => {
    if (!initData) return;
    let off = false;
    setFeed(null);
    setFeedError(false);
    async function loadFeed() {
      try {
        const r = await fetch('/api/home/feed', {
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        if (r.ok) {
          const j = await r.json();
          if (!off) { setFeed(j); setFeedError(false); }
        } else if (!off) setFeedError(true);
      } catch { if (!off) setFeedError(true); }
    }
    loadFeed();
    const timer = setInterval(loadFeed, 30000);
    return () => { off = true; clearInterval(timer); };
  }, [initData, business?.id, retry]);

  return <>
    <GettingStarted business={business} initData={initData} />
    <HomeOverview business={business} feed={feed} error={feedError} onRetry={() => setRetry(n => n + 1)} onFeedback={() => setShowFeedback(true)} />
    {showFeedback && <FeedbackModal promptToken={feedbackPromptToken} onClose={() => { setShowFeedback(false); setFeedbackPromptToken(null); }} />}
    <HomeCoach open={homeCoach.open} onClose={homeCoach.close} shopName={business?.name} />
  </>;
}
