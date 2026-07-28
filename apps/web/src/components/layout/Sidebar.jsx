'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, BarChart2, Users, Package, Bot, Settings, LogOut, FileText, Home, Sparkles, Workflow, Radio, Image, Handshake, Brain } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

// Grouped navigation for reduced cognitive load
const NAV_GROUPS = [
  {
    title: 'Workspace',
    items: [
      { href: '/',             icon: Home,         label: 'Home',          labelAm: 'መነሻ' },
      { href: '/conversations', icon: MessageSquare, label: 'Conversations', labelAm: 'መልዕክቶች' },
      { href: '/pipeline',     icon: Workflow,      label: 'Sales',         labelAm: 'ሽያጭ' },
    ]
  },
  {
    title: 'CRM & Engagement',
    items: [
      { href: '/customers',    icon: Users,         label: 'Customers',     labelAm: 'ደንበኞች' },
      { href: '/b2b',          icon: Handshake,     label: 'Partners',      labelAm: 'አጋሮች' },
      { href: '/broadcast',    icon: Radio,         label: 'Broadcast',     labelAm: 'ማስታወቂያ' },
    ]
  },
  {
    title: 'Management',
    items: [
      { href: '/agent',        icon: Bot,           label: 'AI Agent',      labelAm: 'ወኪል' },
      { href: '/memory',       icon: Brain,         label: 'Memory',        labelAm: 'ትውስታ' },
      { href: '/products',     icon: Package,       label: 'Products',      labelAm: 'ምርቶች' },
      { href: '/documents',    icon: Image,         label: 'Files & Media', labelAm: 'ፋይሎች' },
      { href: '/analytics',    icon: BarChart2,     label: 'Analytics',     labelAm: 'ትንታኔ' },
    ]
  },
  {
    title: 'System',
    items: [
      { href: '/settings',     icon: Settings,      label: 'Settings',      labelAm: 'ቅንብር' },
      { href: '/demo',         icon: Sparkles,      label: 'Watch Demo',    labelAm: 'ዴሞ', accent: true },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();

  return (
    <aside
      className="hidden md:flex"
      style={{
        flexDirection: 'column',
        width: 250,
        background: 'var(--paper)',
        borderRight: '1px solid var(--line)',
        padding: '24px 0',
        flexShrink: 0,
        fontFamily: FONT.body,
        overflowY: 'auto'
      }}
    >
      {/* Logo Area */}
      <div style={{ padding: '0 24px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🪞</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: COLORS.textPrimary, letterSpacing: '-0.03em' }}>MiniMe</span>
        </div>
        <p style={{ fontSize: 12, color: COLORS.textHint, marginTop: 4 }}>
          <span className="am">ሚኒሚ</span><span className="am-sep"> · </span>AI business concierge
        </p>
      </div>

      {/* Grouped Nav Items */}
      <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {NAV_GROUPS.map((group, idx) => (
          <div key={idx}>
            <h4 style={{ 
              fontSize: 11, 
              fontWeight: 700, 
              color: COLORS.textHint, 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em',
              paddingLeft: 12,
              marginBottom: 8
            }}>
              {group.title}
            </h4>
            {group.items.map(({ href, icon: Icon, label, labelAm, accent }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 12px',
                    borderRadius: RADII.md,
                    minHeight: 44,
                    textDecoration: 'none',
                    background: active ? COLORS.bg : 'transparent',
                    color: active ? COLORS.textPrimary : accent ? COLORS.teal : COLORS.textSecondary,
                    transition: 'all 0.2s ease',
                    marginBottom: 2,
                  }}
                  onMouseEnter={e => !active && (e.currentTarget.style.background = 'var(--line)')}
                  onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}
                >
                  <Icon size={18} color={active ? COLORS.teal : accent ? COLORS.teal : COLORS.textHint} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: active ? 600 : accent ? 500 : 400 }}>{label}</span>
                    <span className="am" style={{ display: 'block', fontSize: 10, color: COLORS.textHint, marginTop: 2 }}>{labelAm}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sign out */}
      <div style={{ padding: '24px 16px 0', marginTop: 'auto' }}>
        <button
          onClick={signOut}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px', width: '100%',
            borderRadius: RADII.md, border: 'none', background: 'transparent',
            fontSize: 14, fontWeight: 500, color: COLORS.textHint, cursor: 'pointer',
            fontFamily: FONT.body, transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--line)';
            e.currentTarget.style.color = COLORS.red;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = COLORS.textHint;
          }}
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
