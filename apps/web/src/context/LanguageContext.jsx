'use client';
/**
 * Language toggle — default: English only (MiniMe is international).
 * When the user opts in, Amharic labels appear alongside English.
 *
 * Usage:
 *   const { showAmharic, setShowAmharic } = useLanguage();
 *
 * CSS hook (globals.css):
 *   html[data-show-amharic="false"] .am { display: none; }
 *
 * Wrap inline Amharic strings in <span className="am">…</span> so they
 * auto-hide when the toggle is off.
 */
import { createContext, useContext, useEffect, useState } from 'react';

const Ctx = createContext({ showAmharic: false, setShowAmharic: () => {} });
const STORAGE_KEY = 'minime:show_amharic';

export function LanguageProvider({ children }) {
  const [showAmharic, setShowAmharicState] = useState(false);

  // Hydrate from localStorage (client-only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setShowAmharicState(true);
    } catch {}
  }, []);

  // Mirror to <html data-show-amharic>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-show-amharic', showAmharic ? 'true' : 'false');
  }, [showAmharic]);

  const setShowAmharic = (v) => {
    const next = typeof v === 'function' ? v(showAmharic) : !!v;
    setShowAmharicState(next);
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch {}
  };

  return <Ctx.Provider value={{ showAmharic, setShowAmharic }}>{children}</Ctx.Provider>;
}

export function useLanguage() {
  return useContext(Ctx);
}
