'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const COLORS = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-gold',
};

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message, { variant = 'info', duration = 3000 } = {}) => {
      const id = ++idCounter;
      setToasts((t) => [...t, { id, message, variant }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const Icon = ICONS[t.variant] || Info;
          return (
            <div
              key={t.id}
              className="flex items-start gap-2 bg-card border border-border rounded-xl p-3 shadow-lg animate-in"
              role="status"
            >
              <Icon size={16} className={`shrink-0 mt-0.5 ${COLORS[t.variant] || COLORS.info}`} />
              <p className="text-body text-sm flex-1">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="text-muted hover:text-body shrink-0"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Graceful fallback if provider is missing
    return {
      toast: (msg) => {
        if (typeof window !== 'undefined') console.log('[toast]', msg);
      },
      dismiss: () => {},
    };
  }
  return ctx;
}
