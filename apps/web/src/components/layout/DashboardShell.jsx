'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { ToastProvider } from '../ui/Toast';
import { COLORS, FONT } from '../../lib/design-tokens';

export default function DashboardShell({ children }) {
  const { loading, error, telegramUser, business } = useTelegram();
  const router = useRouter();
  const pathname = usePathname();
  const onOnboarding = pathname?.startsWith('/onboarding');

  // startapp=demo deep link → show the demo page inside Telegram.
  // Uses sessionStorage so navigating back from /demo doesn't loop.
  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const startParam = twa?.initDataUnsafe?.start_param;
    if (startParam === 'demo' && !sessionStorage.getItem('_demo_seen')) {
      sessionStorage.setItem('_demo_seen', '1');
      router.replace('/demo');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // New owners: redirect into the onboarding wizard.
  useEffect(() => {
    if (loading || error || !telegramUser) return;
    const needsOnboarding = !business || !business.telegram_bot_username;
    if (needsOnboarding && !onOnboarding) router.replace('/onboarding');
  }, [loading, error, telegramUser, business, onOnboarding, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.bg, fontFamily: FONT.body }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🪞</div>
          <p className="animate-pulse" style={{ color: COLORS.teal, fontSize: 14 }}>Loading MiniMe…</p>
        </div>
      </div>
    );
  }

  if (error || !telegramUser) {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const debug = {
      hasTelegram: !!window.Telegram,
      hasWebApp: !!twa,
      hasInitData: !!twa?.initData,
      initDataLength: twa?.initData?.length || 0,
      version: twa?.version,
      platform: twa?.platform,
      error: error || '(no error)',
    };
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', background: COLORS.bg, fontFamily: FONT.body }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24, maxWidth: 384, width: '100%' }}>
          <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
          <p style={{ fontWeight: 600, color: COLORS.textPrimary, textAlign: 'center', margin: '0 0 8px', fontSize: 15 }}>Open in Telegram</p>
          <p style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', margin: '0 0 16px' }}>
            MiniMe must be opened through your Telegram bot.
          </p>
          <pre style={{ fontSize: 11, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, color: COLORS.textHint, overflow: 'auto' }}>
            {JSON.stringify(debug, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  // While onboarding (no business yet OR no bot linked), render wizard without chrome.
  const needsOnboarding = !business || !business.telegram_bot_username;
  if (needsOnboarding) {
    return (
      <ToastProvider>
        <main style={{ minHeight: '100vh', padding: '16px 16px 40px', fontFamily: FONT.body }}>{children}</main>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: FONT.body, width: '100vw', position: 'fixed', left: 0, top: 0 }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
          <DashboardTopBar business={business} telegramUser={telegramUser} />
          <main style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 96px', width: '100%', boxSizing: 'border-box' }}>{children}</main>
        </div>
        <MobileNav />
      </div>
    </ToastProvider>
  );
}

function DashboardTopBar({ business, telegramUser }) {
  return (
    <header style={{
      height: 56,
      borderBottom: `1px solid ${COLORS.border}`,
      background: COLORS.surface,
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 12,
      flexShrink: 0,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {business.name}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{telegramUser.username || telegramUser.first_name}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {business.panic_mode && (
          <span style={{ fontSize: 11, background: COLORS.redLight, color: COLORS.red, border: `1px solid ${COLORS.red}40`, borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
            PANIC
          </span>
        )}
        <span
          className="animate-pulse"
          style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.green, display: 'inline-block' }}
          title="MiniMe active"
        />
      </div>
    </header>
  );
}
