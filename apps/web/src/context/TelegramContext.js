'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const TelegramContext = createContext(null);

export function TelegramProvider({ children }) {
  const [telegramUser, setTelegramUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [initData, setInitData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function authenticate() {
      const twa = window.Telegram?.WebApp;

      // Signal ready + expand FIRST — on iOS this is what causes Telegram to
      // populate initData. Calling ready() after the null check means iOS
      // never initialises properly on the first open.
      if (twa) {
        try { twa.ready(); } catch {}
        try { twa.expand(); } catch {}
        // Bot API 8.0+: true fullscreen (covers status bar + nav bar)
        try { if (typeof twa.requestFullscreen === 'function') twa.requestFullscreen(); } catch {}
      }

      if (!twa) {
        setError('Not running inside Telegram');
        setLoading(false);
        return;
      }

      // iOS can return empty initData immediately after ready() — wait up to
      // ~1.2 s in 300 ms increments for it to populate (3 retries).
      let initDataStr = twa.initData;
      if (!initDataStr) {
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 300));
          initDataStr = window.Telegram?.WebApp?.initData;
          if (initDataStr) break;
        }
      }

      if (!initDataStr) {
        setError('Not running inside Telegram');
        setLoading(false);
        return;
      }

      setInitData(initDataStr);

      try {
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: initDataStr }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Auth failed');
        setTelegramUser(data.telegramUser);
        setBusiness(data.business);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    authenticate();
  }, []);

  return (
    <TelegramContext.Provider value={{ telegramUser, business, setBusiness, initData, loading, error }}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram() {
  const ctx = useContext(TelegramContext);
  if (!ctx) throw new Error('useTelegram must be used inside TelegramProvider');
  return ctx;
}

export function useTelegramWebApp() {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp || null;
}
