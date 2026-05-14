/**
 * Reusable platform icons used across MiniMe.
 * - WhatsApp: custom SVG (not in lucide-react)
 * - Instagram, Facebook: lucide-react re-exports wrapped with brand color
 * - Telegram: custom paper-plane SVG matching the others' style
 */
import { Instagram, Facebook } from 'lucide-react';

export const PLATFORM_COLORS = {
  telegram:  '#0088CC',
  whatsapp:  '#25D366',
  instagram: '#E1306C',
  facebook:  '#1877F2',
};

export function WhatsAppIcon({ size = 20, color = PLATFORM_COLORS.whatsapp }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.89L4 20l4.2-1.1A7.93 7.93 0 0 0 12.05 20h.01a7.94 7.94 0 0 0 7.94-7.94 7.88 7.88 0 0 0-2.4-5.74Zm-5.55 12.21h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.49.66.67-2.43-.16-.25a6.6 6.6 0 0 1 10.27-8.16 6.55 6.55 0 0 1 1.93 4.66 6.6 6.6 0 0 1-6.61 6.58Zm3.62-4.93c-.2-.1-1.17-.58-1.35-.64-.18-.07-.31-.1-.45.1-.13.2-.51.64-.62.77-.11.13-.23.15-.43.05a5.42 5.42 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.37c-.12-.2-.01-.31.09-.4.09-.1.2-.23.3-.34.1-.12.13-.2.2-.33.07-.14.04-.25-.02-.35-.05-.1-.45-1.08-.61-1.48-.17-.39-.34-.34-.46-.34l-.4-.01a.76.76 0 0 0-.55.26 2.3 2.3 0 0 0-.72 1.71c0 1.01.73 1.98.83 2.12.1.13 1.43 2.19 3.47 3.07.48.21.86.34 1.16.43.5.16.94.13 1.3.08.4-.06 1.22-.5 1.39-.98.17-.48.17-.9.12-.98-.05-.09-.18-.13-.38-.23Z"/>
    </svg>
  );
}

export function InstagramIcon({ size = 20, color = PLATFORM_COLORS.instagram }) {
  return <Instagram size={size} color={color} strokeWidth={1.6} />;
}

export function FacebookIcon({ size = 20, color = PLATFORM_COLORS.facebook }) {
  return <Facebook size={size} color={color} strokeWidth={1.6} />;
}

export function TelegramIcon({ size = 20, color = PLATFORM_COLORS.telegram }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
      <path d="M21.5 4.5L2.5 11.5c-.5.2-.5.6 0 .8l4.5 1.5 1.7 5.4c.2.6.7.7 1.2.2l2.4-2.3 4.6 3.4c.6.4 1.1.2 1.3-.6L21.7 5.4c.2-.7-.2-1.1-.2-.9zM18.4 8L10 14.5l-.4 4-1.4-4.6 9.7-5.7c.3-.2.6.1.5.3z"/>
    </svg>
  );
}

/** Generic dispatcher — by platform name string */
export function PlatformIcon({ platform, size = 20, color }) {
  switch (platform) {
    case 'whatsapp':  return <WhatsAppIcon size={size} color={color} />;
    case 'instagram': return <InstagramIcon size={size} color={color} />;
    case 'facebook':  return <FacebookIcon size={size} color={color} />;
    case 'telegram':  return <TelegramIcon size={size} color={color} />;
    default: return null;
  }
}

export const PLATFORM_LABELS = {
  telegram:  'Telegram',
  whatsapp:  'WhatsApp',
  instagram: 'Instagram',
  facebook:  'Facebook',
};
