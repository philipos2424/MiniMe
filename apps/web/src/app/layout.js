import './globals.css';
import Script from 'next/script';
import { LanguageProvider } from '../context/LanguageContext';

export const metadata = {
  title: 'MiniMe — AI Business Assistant',
  description: 'Your AI-powered Telegram business assistant',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-show-amharic="false">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Noto+Sans+Ethiopic:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&display=swap" rel="stylesheet" />
      </head>
      <body style={{ background: '#FBF8F1', color: '#0E2823', fontFamily: "'Geist', 'Inter', -apple-system, system-ui, sans-serif", minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        {/* Telegram WebApp SDK — afterInteractive so it doesn't block prerender,
            TelegramContext retries up to 1s for window.Telegram.WebApp to exist */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
