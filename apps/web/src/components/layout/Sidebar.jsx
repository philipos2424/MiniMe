'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, BarChart2, Users, Package, Bot, Settings, LogOut, FileText, Home, Sparkles } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

const nav = [
  { href: '/',             icon: Home,         label: 'Home',          labelAm: 'መነሻ' },
  { href: '/conversations', icon: MessageSquare, label: 'Conversations', labelAm: 'መልዕክቶች' },
  { href: '/agent',        icon: Bot,           label: 'Agent',         labelAm: 'ወኪል' },
  { href: '/customers',    icon: Users,         label: 'Customers',     labelAm: 'ደንበኞች' },
  { href: '/analytics',    icon: BarChart2,     label: 'Analytics',     labelAm: 'ትንታኔ' },
  { href: '/products',     icon: Package,       label: 'Products',      labelAm: 'ምርቶች' },
  { href: '/documents',    icon: FileText,      label: 'Knowledge',     labelAm: 'እውቀት' },
  { href: '/settings',     icon: Settings,      label: 'Settings',      labelAm: 'ቅንብር' },
  { href: '/demo',         icon: Sparkles,      label: 'Watch Demo',    labelAm: 'ዴሞ', accent: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();

  return (
    // Keep "hidden md:flex" for responsive breakpoint — shows only on desktop
    <aside
      className="hidden md:flex"
      style={{
        flexDirection: 'column',
        width: 240,
        background: COLORS.surface,
        borderRight: `1px solid ${COLORS.border}`,
        padding: '24px 0',
        flexShrink: 0,
        fontFamily: FONT.body,
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 20px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 24 }}>🪞</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: COLORS.textPrimary, letterSpacing: '-0.02em' }}>MiniMe</span>
        </div>
        <p style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
          <span className="am">ሚኒሚ</span><span className="am-sep"> · </span>AI business concierge
        </p>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '0 12px' }}>
        {nav.map(({ href, icon: Icon, label, labelAm, accent }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', paddingLeft: active ? 10 : 12,
                borderRadius: RADII.md,
                minHeight: 44,
                textDecoration: 'none',
                borderLeft: active ? `2px solid ${COLORS.teal}` : '2px solid transparent',
                background: active ? COLORS.bg : 'transparent',
                color: active ? COLORS.textPrimary : accent ? COLORS.teal : COLORS.textSecondary,
                transition: 'background 0.15s, color 0.15s',
                marginBottom: 2,
              }}
            >
              <Icon size={16} color={active ? COLORS.teal : accent ? COLORS.teal : COLORS.textSecondary} />
              <span style={{ flex: 1, lineHeight: 1.2 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: active ? 600 : accent ? 500 : 400 }}>{label}</span>
                <span className="am" style={{ display: 'block', fontSize: 10, color: COLORS.textHint, lineHeight: 1.2 }}>{labelAm}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div style={{ padding: '0 12px', marginTop: 16 }}>
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 12px', width: '100%', minHeight: 44,
            borderRadius: RADII.md, border: 'none', background: 'transparent',
            fontSize: 13, color: COLORS.textHint, cursor: 'pointer',
            fontFamily: FONT.body, transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = COLORS.red}
          onMouseLeave={e => e.currentTarget.style.color = COLORS.textHint}
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
