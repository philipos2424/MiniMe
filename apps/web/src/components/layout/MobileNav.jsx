'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Sparkles, ShoppingBag, Settings } from 'lucide-react';
import { COLORS, FONT } from '../../lib/design-tokens';

const NAV = [
  { href: '/',              icon: Home,          label: 'Home'     },
  { href: '/conversations', icon: MessageSquare, label: 'Chats'    },
  { href: '/advisor',       icon: Sparkles,      label: 'Advisor', center: true },
  { href: '/catalog',       icon: ShoppingBag,   label: 'Catalog'  },
  { href: '/settings',      icon: Settings,      label: 'Settings' },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: 'rgba(251,248,241,0.92)',
        backdropFilter: 'saturate(150%) blur(20px)',
        WebkitBackdropFilter: 'saturate(150%) blur(20px)',
        borderTop: '1px solid #EEE9DE',
        paddingBottom: 'env(safe-area-inset-bottom)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${NAV.length}, 1fr)`, height: 64 }}>
        {NAV.map(({ href, icon: Icon, label, center }) => {
          const active = href === '/'
            ? pathname === '/'
            : pathname === href || pathname.startsWith(href + '/');

          if (center) {
            return (
              <Link
                key={href} href={href}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', gap: 4, textDecoration: 'none',
                  transform: 'translateY(-14px)',
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: active ? '#0E2823' : '#0E2823',
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
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, textDecoration: 'none',
                color: active ? '#0E2823' : '#8A9590',
                transition: 'color 0.15s ease',
              }}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.1 : 1.5}
                color={active ? '#0E2823' : '#8A9590'}
              />
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
