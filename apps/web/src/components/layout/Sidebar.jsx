'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, BarChart2, Users, Package, Bot, Settings, LogOut, FileText, Home } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const nav = [
  { href: '/', icon: Home, label: 'Home', labelAm: 'መነሻ' },
  { href: '/conversations', icon: MessageSquare, label: 'Conversations', labelAm: 'መልዕክቶች' },
  { href: '/agent', icon: Bot, label: 'Agent', labelAm: 'ወኪል' },
  { href: '/customers', icon: Users, label: 'Customers', labelAm: 'ደንበኞች' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics', labelAm: 'ትንታኔ' },
  { href: '/products', icon: Package, label: 'Products', labelAm: 'ምርቶች' },
  { href: '/documents', icon: FileText, label: 'Knowledge', labelAm: 'እውቀት' },
  { href: '/settings', icon: Settings, label: 'Settings', labelAm: 'ቅንብር' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { signOut } = useAuth();

  return (
    <aside className="hidden md:flex flex-col w-60 bg-card border-r border-border py-6 shrink-0">
      <div className="px-5 mb-8">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🪞</span>
          <span className="font-display text-xl text-gold-light tracking-tight">MiniMe</span>
        </div>
        <p className="text-muted text-[11px] mt-0.5">
          <span className="am">ሚኒሚ</span><span className="am-sep"> · </span>AI business concierge
        </p>
      </div>
      <nav className="flex-1 px-3 space-y-0.5">
        {nav.map(({ href, icon: Icon, label, labelAm }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition min-h-[44px] ${
                active
                  ? 'bg-card border-l-2 border-gold text-gold-light pl-[10px]'
                  : 'border-l-2 border-transparent text-muted hover:text-body hover:bg-bg/60'
              }`}
            >
              <Icon size={16} className={active ? 'text-gold' : ''} />
              <span className="flex-1 leading-tight">
                <span className="block">{label}</span>
                <span className={`am block text-[10px] leading-tight ${active ? 'text-muted' : 'text-muted/70'}`}>{labelAm}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="px-3 mt-4">
        <button
          onClick={signOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted hover:text-red-400 w-full transition min-h-[44px]"
        >
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
