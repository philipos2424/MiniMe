'use client';
import { createContext, useContext, useEffect, useState } from 'react';

const TelegramContext = createContext(null);

export function TelegramProvider({ children }) {
  const [telegramUser, setTelegramUser] = useState(null);
  const [business, setBusiness] = useState(null);
  const [initData, setInitData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 'light' | 'dark' — follows the user's Telegram theme, overridable via toggle
  const [theme, setTheme] = useState('light');
  const [themeParams, setThemeParams] = useState({});
  // Pending count — updated by DashboardPage when feed loads, read by MobileNav for badge dots
  const [pendingCount, setPendingCount] = useState(0);

  // Apply a theme to the html element and persist user preference
  const applyAndSave = (scheme) => {
    setTheme(scheme);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = scheme;
    }
  };

  // Manual toggle — stored in localStorage so it survives re-opens
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('mm_theme', next); } catch {}
    applyAndSave(next);
  };

  useEffect(() => {
    // ── Dev-only preview mode ────────────────────────────────────────────────
    // Set NEXT_PUBLIC_MOCK_TELEGRAM_AUTH=1 to render the full dashboard in a
    // plain browser (no Telegram, no bot token). Lets you eyeball the UI and
    // click through interactions. Saves are short-circuited in updateBusiness.
    // The flag is inlined at build time, so this branch is dead in any normal
    // build and has zero effect on production.
    if (process.env.NEXT_PUBLIC_MOCK_TELEGRAM_AUTH === '1') {
      applyAndSave((() => { try { return localStorage.getItem('mm_theme'); } catch { return null; } })() || 'light');
      setTelegramUser({ id: 1, first_name: 'Sara', username: 'sara_preview' });
      setBusiness({
        id: 'mock-business',
        name: 'Selam Boutique',
        owner_name: 'Sara Tesfaye',
        subscription_plan: 'Free',
        onboarding_completed: true,
        telegram_bot_username: 'SelamBoutiqueBot',
        telegram_biz_conn_id: 'mock-conn-123',
        shop_code: 'selam',
        trust_level: 1,
        panic_mode: false,
        business_hours: 'Mon–Sat 9am–8pm',
        address: 'Bole Road, Addis Ababa',
        instagram: '@selamboutique',
        sample_replies: [],
        notification_prefs: {
          personal_contacts: [],
          secretary_mode: 'ask_first',
          confirm_before_send: true,
          ai_identity_mode: {},
          owner_facts: [],
        },
      });
      setInitData('mock');
      setLoading(false);
      return;
    }

    async function authenticate() {
      // SDK loads with strategy="beforeInteractive" so it's available immediately.
      // The retry loop below handles edge cases (slow devices, iOS timing).
      let twa = window.Telegram?.WebApp;
      if (!twa) {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 100));
          twa = window.Telegram?.WebApp;
          if (twa) break;
        }
      }

      // Signal ready + expand FIRST — on iOS this is what causes Telegram to
      // populate initData. Calling ready() after the null check means iOS
      // never initialises properly on the first open.
      if (twa) {
        try { twa.ready(); } catch {}
        try { twa.expand(); } catch {}
        // NOTE: intentionally NOT calling requestFullscreen(). Telegram's 8.0+
        // fullscreen REMOVES the native header — which is the only place the
        // BackButton renders — so fullscreen leaves the whole app with no
        // visible back button, and it shifts the safe-area insets (which threw
        // off the in-page chevron and made inputs feel like they "zoom").
        // expand() gives the tall view while keeping the header + working Back
        // button. Do NOT re-add requestFullscreen without first building a
        // reliable in-app back affordance for every screen.

        // Theme: respect manual override first, then Telegram's colorScheme
        const storedTheme = (() => { try { return localStorage.getItem('mm_theme'); } catch { return null; } })();
        const applyTheme = () => {
          const scheme = storedTheme || twa.colorScheme || 'light';
          setThemeParams(twa.themeParams || {});
          applyAndSave(scheme);
        };
        applyTheme();
        // Only update on Telegram theme change if user hasn't manually overridden
        try {
          twa.onEvent?.('themeChanged', () => {
            const stored = (() => { try { return localStorage.getItem('mm_theme'); } catch { return null; } })();
            if (!stored) applyAndSave(twa.colorScheme || 'light');
          });
        } catch {}
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
    <TelegramContext.Provider value={{ telegramUser, business, setBusiness, initData, loading, error, theme, themeParams, toggleTheme, pendingCount, setPendingCount }}>
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
