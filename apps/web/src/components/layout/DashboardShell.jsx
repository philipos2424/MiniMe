'use client';
import { useTelegram } from '../../context/TelegramContext';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { ToastProvider } from '../ui/Toast';

export default function DashboardShell({ children }) {
  const { loading, error, telegramUser, business } = useTelegram();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🪞</div>
          <p className="text-gold animate-pulse">Loading MiniMe…</p>
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
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full">
          <div className="text-3xl mb-3 text-center">⚠️</div>
          <p className="text-gold-light font-semibold mb-2 text-center">Open in Telegram</p>
          <p className="text-muted text-sm mb-4 text-center">
            MiniMe must be opened through your Telegram bot.
          </p>
          <pre className="text-xs bg-bg border border-border rounded p-3 text-muted overflow-auto">
            {JSON.stringify(debug, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-2xl p-6 text-center max-w-sm w-full">
          <div className="text-3xl mb-3">🏪</div>
          <p className="text-gold-light font-semibold mb-2">No business found</p>
          <p className="text-muted text-sm">
            Send <span className="text-gold font-mono">/start</span> to your MiniMe bot on Telegram to set up your business first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <DashboardTopBar business={business} telegramUser={telegramUser} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">{children}</main>
        </div>
        <MobileNav />
      </div>
    </ToastProvider>
  );
}

function DashboardTopBar({ business, telegramUser }) {
  return (
    <header className="h-14 border-b border-border bg-card/50 flex items-center px-4 gap-3 shrink-0">
      <div className="flex-1 min-w-0">
        <p className="text-gold-light text-sm font-semibold truncate">{business.name}</p>
        <p className="text-muted text-xs truncate">@{telegramUser.username || telegramUser.first_name}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {business.panic_mode && (
          <span className="text-xs bg-red-900/40 text-red-400 border border-red-800 rounded-full px-2 py-0.5">PANIC</span>
        )}
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="MiniMe active" />
      </div>
    </header>
  );
}
