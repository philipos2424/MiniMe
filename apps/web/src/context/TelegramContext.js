'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const TelegramContext = createContext(null);

export function TelegramProvider({ children }) {
  const [telegramUser, setTelegramUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function authenticate() {
      const twa = window.Telegram?.WebApp;
      if (!twa?.initData) {
        setError('Not running inside Telegram');
        setLoading(false);
        return;
      }

      twa.ready();
      twa.expand();

      try {
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: twa.initData }),
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
    <TelegramContext.Provider value={{ telegramUser, business, setBusiness, loading, error }}>
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
