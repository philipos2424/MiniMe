'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Users, Bot, Settings, FileText, Home } from 'lucide-react';

const nav = [
  { href: '/', icon: Home, label: 'Home', labelAm: 'መነሻ' },
  { href: '/conversations', icon: MessageSquare, label: 'Chats', labelAm: 'መልዕክት' },
  { href: '/agent', icon: Bot, label: 'Agent', labelAm: 'ወኪል' },
  { href: '/documents', icon: FileText, label: 'Docs', labelAm: 'እውቀት' },
  { href: '/customers', icon: Users, label: 'Customers', labelAm: 'ደንበኞች' },
  { href: '/settings', icon: Settings, label: 'Settings', labelAm: 'ቅንብር' },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around py-2 z-50"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {nav.map(({ href, icon: Icon, label, labelAm }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] px-2 py-1 rounded-lg transition ${
              active ? 'text-gold' : 'text-muted'
            }`}
          >
            <Icon size={20} />
            <span className="text-[10px] leading-none">{label}</span>
            <span className="am text-[9px] leading-none opacity-70">{labelAm}</span>
          </Link>
        );
      })}
    </nav>
  );
}
