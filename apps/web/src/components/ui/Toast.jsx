'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const ToastContext = createContext(null);

const ICON_COLOR = {
  success: COLORS.green,
  error:   COLORS.red,
  info:    COLORS.teal,
};

const ICONS = {
  success: CheckCircle2,
  error:   AlertCircle,
  info:    Info,
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
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 384, fontFamily: FONT.body }}>
        {toasts.map((t) => {
          const Icon = ICONS[t.variant] || Info;
          const iconColor = ICON_COLOR[t.variant] || COLORS.teal;
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: 12,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              <Icon size={16} color={iconColor} style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 14, color: COLORS.textPrimary, flex: 1, margin: 0 }}>{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.textHint, flexShrink: 0, padding: 0, display: 'flex' }}
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
    return {
      toast: (msg) => {
        if (typeof window !== 'undefined') console.log('[toast]', msg);
      },
      dismiss: () => {},
    };
  }
  return ctx;
}
