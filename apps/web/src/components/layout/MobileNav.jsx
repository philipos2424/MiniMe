'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Sparkles, Workflow, Settings } from 'lucide-react';
import { FONT } from '../../lib/design-tokens';
import { hapticSelection } from '../../lib/hooks/useTelegramButtons';
import { useTelegram } from '../../context/TelegramContext';

const NAV = [
  { href: '/',              icon: Home,          label: 'Home'     },
  { href: '/conversations', icon: MessageSquare, label: 'Chats',    badge: 'pending' },
  { href: '/advisor',       icon: Sparkles,      label: 'Advisor', center: true },
  { href: '/pipeline',      icon: Workflow,      label: 'Pipeline' },
  { href: '/settings',      icon: Settings,      label: 'Settings' },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { pendingCount } = useTelegram() || {};

  return (
    <nav
      className="md:hidden"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
        backdropFilter: 'saturate(150%) blur(20px)',
        WebkitBackdropFilter: 'saturate(150%) blur(20px)',
        borderTop: '1px solid var(--line-soft)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${NAV.length}, 1fr)`, height: 64 }}>
        {NAV.map(({ href, icon: Icon, label, center, badge }) => {
          const active = href === '/'
            ? pathname === '/'
            : pathname === href || pathname.startsWith(href + '/');
          const showBadge = badge === 'pending' && pendingCount > 0 && !active;

          if (center) {
            return (
              <Link
                key={href} href={href}
                onClick={() => hapticSelection()}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 4, textDecoration: 'none',
                  transform: 'translateY(-14px)',
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: '#0E2823',
                  display: 'grid', placeItems: 'center',
                  boxShadow: '0 8px 24px -8px rgba(14,40,35,.4)',
                }}>
                  <Icon size={22} color="#F4EEE1" strokeWidth={1.7} />
                </div>
                <span style={{
                  fontSize: 9.5, fontWeight: 600,
                  fontFamily: FONT.body,
                  color: active ? '#0E2823' : '#8A9590',
                  letterSpacing: '0.04em',
                }}>
                  {label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={href} href={href}
              onClick={() => { sessionStorage.setItem('_navigated', '1'); if (!active) hapticSelection(); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, textDecoration: 'none',
                color: active ? '#0E2823' : '#8A9590',
                transition: 'color 0.15s ease',
                position: 'relative',
              }}
            >
              <div style={{ position: 'relative' }}>
                <Icon size={20} strokeWidth={active ? 2.1 : 1.5} color={active ? '#0E2823' : '#8A9590'} />
                {showBadge && (
                  <span style={{
                    position: 'absolute', top: -3, right: -5,
                    minWidth: pendingCount > 9 ? 16 : 12, height: 12,
                    borderRadius: 999, background: '#B08A4A',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 700, color: '#fff', fontFamily: FONT.body,
                    lineHeight: 1, padding: pendingCount > 9 ? '0 3px' : 0,
                    boxShadow: '0 0 0 2px var(--paper)',
                  }}>
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </div>
              <span style={{
                fontSize: 9.5,
                fontWeight: active ? 600 : 500,
                fontFamily: active ? "'Newsreader', Georgia, serif" : FONT.body,
                fontStyle: active ? 'italic' : 'normal',
                letterSpacing: active ? '-0.01em' : '0.04em',
              }}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
