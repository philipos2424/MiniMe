'use client';
import { useEffect } from 'react';

/**
 * useBackButton — shows Telegram's native top-left BackButton while
 * this component is mounted. Tapping it calls `onBack`.
 *
 * Example:
 *   useBackButton(() => router.back());
 */
export function useBackButton(onBack) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tg = window.Telegram?.WebApp;
    const bb = tg?.BackButton;
    if (!bb) return;
    bb.onClick(onBack);
    bb.show();
    return () => {
      try { bb.offClick(onBack); } catch {}
      try { bb.hide(); } catch {}
    };
  }, [onBack]);
}

/**
 * useMainButton — shows Telegram's native MainButton at the bottom
 * of the Mini App with `text`. Tapping it calls `onClick`.
 *
 * Pass `show: false` to hide it conditionally (e.g. disabled state).
 *
 * Example:
 *   useMainButton({
 *     text: replyText ? 'Send' : '',
 *     onClick: send,
 *     show: !!replyText.trim(),
 *   });
 */
export function useMainButton({ text, onClick, color, textColor, show = true, progress = false }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const tg = window.Telegram?.WebApp;
    const mb = tg?.MainButton;
    if (!mb) return;

    if (!show || !text) {
      try { mb.hide(); } catch {}
      return;
    }

    try {
      mb.setText(text);
      if (color)     mb.color     = color;
      if (textColor) mb.textColor = textColor;
      if (progress)  mb.showProgress?.(false); else mb.hideProgress?.();
      mb.onClick(onClick);
      mb.show();
    } catch {}

    return () => {
      try { mb.offClick(onClick); } catch {}
      try { mb.hide(); } catch {}
    };
  }, [text, onClick, color, textColor, show, progress]);
}

/**
 * useHaptic — returns a stable callback that triggers Telegram haptic feedback.
 * Types: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' (impact)
 *        Use `selection()` or `notification()` separately if needed.
 */
export function haptic(type = 'light') {
  if (typeof window === 'undefined') return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
  } catch {}
}

export function hapticSelection() {
  if (typeof window === 'undefined') return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
  } catch {}
}

export function hapticNotification(type = 'success') {
  if (typeof window === 'undefined') return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
  } catch {}
}
