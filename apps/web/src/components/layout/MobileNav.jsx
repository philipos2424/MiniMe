'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Users, Bot, Settings } from 'lucide-react';
import { COLORS } from '../../lib/design-tokens';

const NAV = [
  { href: '/',              icon: Home,          label: 'Home' },
  { href: '/conversations', icon: MessageSquare, label: 'Chats' },
  { href: '/customers',     icon: Users,         label: 'Clients' },
  { href: '/agent',         icon: Bot,           label: 'Agent' },
  { href: '/settings',      icon: Settings,      label: 'Settings' },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: COLORS.surface,
        borderTop: `1px solid ${COLORS.border}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        height: 'calc(64px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${NAV.length}, 1fr)`, height: 64 }}>
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = href === '/'
            ? pathname === '/'
            : pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href} href={href}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 3, textDecoration: 'none',
                color: active ? COLORS.teal : COLORS.textSecondary,
                transition: 'color 0.15s ease',
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{
                fontSize: 9.5,
                fontWeight: active ? 600 : 500,
                fontStyle: active ? 'italic' : 'normal',
                fontFamily: active ? "'Fraunces', Georgia, serif" : 'inherit',
                letterSpacing: active ? '-0.01em' : '0.01em',
              }}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
