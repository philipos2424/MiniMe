'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import {
  ChevronRight, Bot, Sparkles, Shield, CreditCard, Users,
  MessageCircle, User, Brain, LayoutDashboard, LogOut, ShoppingBag,
  Clock, Search, BookOpen, Megaphone, Sun,
} from 'lucide-react';
import { useToast } from '../ui/Toast';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { ProLock } from '../ui/UpgradeSheet';
import { planStatus } from '../../lib/plan';

const ADMIN_IDS = [420769631, 669754127];
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const SERIF = "'Newsreader', Georgia, serif";

// ─── Full settings list — Telegram-style: icon + label only ────────────────
const ITEMS = [
  // ── Bot & AI ──
  { section: 'Bot & AI' },
  { href: '/settings/character',    Icon: Sparkles,      label: 'Personality & Voice',     pro: false },
  { href: '/settings/modes',        Icon: Bot,           label: 'Secretary or Bot Mode',    pro: true  },
  { href: '/teach',                 Icon: Brain,         label: 'Teach MiniMe',             pro: false },
  { href: '/settings/trust',        Icon: Shield,        label: 'Trust & Autonomy',         pro: false },
  { href: '/settings/people',       Icon: Users,         label: 'People You Know',          pro: false },
  { href: '/settings/notifications',Icon: Sun,           label: 'Morning Digest',           pro: false },
  { href: '/advisor',               Icon: Sparkles,      label: 'Advisor & Rules',          pro: true  },
  // ── Business ──
  { section: 'Business' },
  { href: '/settings/profile',      Icon: User,          label: 'Business Profile',         pro: false },
  { href: '/settings/bot',          Icon: Bot,           label: 'Telegram Bot',             pro: false },
  { href: '/settings/payments',     Icon: CreditCard,    label: 'Payments',                 pro: false },
  { href: '/products',              Icon: ShoppingBag,   label: 'Products & Inventory',     pro: false },
  { href: '/catalog',               Icon: BookOpen,      label: 'Catalog & Orders',         pro: false },
  { href: '/settings/hours',        Icon: Clock,         label: 'Availability Hours',       pro: false },
  { href: '/settings/channel',      Icon: Megaphone,     label: 'Product Channel',         pro: false },
  { href: '/settings/search',       Icon: Search,        label: 'MiniMe Market Listing',    pro: false },
  // ── Account ──
  { section: 'Account' },
  { href: '/settings/billing',      Icon: CreditCard,    label: 'Billing & Plan',           pro: false },
  { href: '/assistant',             Icon: MessageCircle, label: 'Chat with MiniMe',         pro: false },
  { href: '/settings/audit',        Icon: Shield,        label: 'Audit Log',                pro: false },
  { href: '/api/businesses/export', Icon: Shield,        label: 'Export My Data',           pro: false },
];

// ─── Single Telegram-style row ──────────────────────────────────────────────
function Row({ href, Icon, label, pro, isPro, last }) {
  const locked = pro && !isPro;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '13px 16px', cursor: 'pointer',
      }}>
        {/* Icon bubble */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--cream)', display: 'grid',
          placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={17} color="var(--ink)" strokeWidth={1.6} />
        </div>

        {/* Label */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {label}
          </span>
          {locked && <ProLock />}
        </div>

        <ChevronRight size={16} color="var(--muted)" strokeWidth={1.5} />
      </div>
      {!last && (
        <div style={{ height: 1, background: 'var(--line)', marginLeft: 66 }} />
      )}
    </Link>
  );
}

// ─── Section header ─────────────────────────────────────────────────────────
function SectionLabel({ title }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 600, color: 'var(--muted)',
      padding: '20px 16px 6px',
      letterSpacing: '0em',
    }}>
      {title}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { business: tgBusiness, telegramUser, initData } = useTelegram();
  const isAdmin = ADMIN_IDS.includes(Number(telegramUser?.id));
  const supabase = createClient();
  const { toast } = useToast();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (tgBusiness) setBusiness(tgBusiness);
  }, [tgBusiness]);

  async function handleSignOut() {
    if (signingOut) return;
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const insideTelegram = !!twa?.initData;
    let ok = false;
    if (insideTelegram && typeof twa.showConfirm === 'function') {
      ok = await new Promise(resolve => {
        try {
          twa.showConfirm(
            "Sign out? Your products and chats stay saved.",
            (confirmed) => resolve(!!confirmed)
          );
        } catch { resolve(window.confirm('Sign out of MiniMe?')); }
      });
    } else {
      ok = typeof window !== 'undefined'
        ? window.confirm("Sign out? Your data stays saved.")
        : true;
    }
    if (!ok) return;
    setSigningOut(true);
    try {
      await fetch('/api/onboarding/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
      });
    } catch {}
    try { await supabase.auth.signOut(); } catch {}
    try {
      sessionStorage.clear();
      const theme = localStorage.getItem('mm_theme');
      localStorage.clear();
      if (theme) localStorage.setItem('mm_theme', theme);
    } catch {}
    if (insideTelegram && typeof twa.close === 'function') {
      try { twa.close(); return; } catch {}
    }
    router.push('/login');
  }

  const ownerName  = business?.owner_name || tgBusiness?.owner_name || '';
  const ownerFirst = ownerName.split(' ')[0] || '';
  const { isPro }  = planStatus(business);
  const planLabel  = business?.subscription_plan || 'Free';
  const paused     = !!business?.panic_mode;

  // Render items: section headers become <SectionLabel>, objects become <Row>
  const sections = [];
  let currentGroup = [];

  ITEMS.forEach((item, idx) => {
    if (item.section) {
      if (currentGroup.length) {
        sections.push({ type: 'group', items: currentGroup });
        currentGroup = [];
      }
      sections.push({ type: 'label', title: item.section });
    } else {
      currentGroup.push(item);
    }
  });
  if (currentGroup.length) sections.push({ type: 'group', items: currentGroup });

  return (
    <div style={{
      background: 'var(--paper)', minHeight: '100vh',
      paddingBottom: 100, fontFamily: BODY, color: 'var(--ink)',
    }}>

      {/* ── Avatar + name card ── */}
      <div style={{ padding: '20px 16px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 16px',
          background: 'var(--cream)', borderRadius: 16,
        }}>
          {/* Avatar initial */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(176,138,74,0.18)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
            fontFamily: SERIF, fontSize: 22, color: 'var(--gold)',
          }}>
            {(ownerFirst || business?.name || '?').charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: SERIF, fontSize: 18,
              color: 'var(--ink)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {ownerName || business?.name || 'Your business'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {business?.name && <span>{business.name} · </span>}
              <span style={{
                color: isPro ? 'var(--gold)' : 'var(--muted)',
                fontWeight: isPro ? 600 : 400,
              }}>{planLabel} plan</span>
              {paused && <span style={{ color: 'var(--error)', marginLeft: 6 }}>· Paused</span>}
            </div>
          </div>

          <Link href="/settings/profile" style={{ color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
            <ChevronRight size={18} strokeWidth={1.5} />
          </Link>
        </div>
      </div>

      {/* ── Settings list ── */}
      {sections.map((s, si) => {
        if (s.type === 'label') return <SectionLabel key={si} title={s.title} />;
        return (
          <div key={si} style={{
            margin: '0 16px',
            background: 'var(--paper)',
            border: '1px solid var(--line)',
            borderRadius: 14, overflow: 'hidden',
          }}>
            {s.items.map((item, ii) => (
              <Row
                key={item.href}
                {...item}
                isPro={isPro}
                last={ii === s.items.length - 1}
              />
            ))}
          </div>
        );
      })}

      {/* ── Admin panel ── */}
      {isAdmin && (
        <>
          <SectionLabel title="Platform" />
          <div style={{
            margin: '0 16px',
            background: 'var(--cream)', border: '1px solid var(--line)',
            borderRadius: 14, overflow: 'hidden',
          }}>
            <Link href="/admin" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(176,138,74,.15)', display: 'grid', placeItems: 'center' }}>
                <LayoutDashboard size={17} color="var(--gold)" />
              </div>
              <span style={{ flex: 1, fontSize: 15, color: 'var(--ink)' }}>Admin Panel</span>
              <ChevronRight size={16} color="var(--muted)" strokeWidth={1.5} />
            </Link>
          </div>
        </>
      )}

      {/* ── Sign out ── */}
      <SectionLabel title="Session" />
      <div style={{
        margin: '0 16px',
        background: 'var(--paper)', border: '1px solid var(--line)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '13px 16px', width: '100%',
            background: 'transparent', border: 'none',
            textAlign: 'left', cursor: signingOut ? 'wait' : 'pointer',
            opacity: signingOut ? 0.6 : 1, fontFamily: BODY,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(185,64,64,0.08)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <LogOut size={17} color="#C0392B" strokeWidth={1.6} />
          </div>
          <span style={{ flex: 1, fontSize: 15, color: '#C0392B', fontWeight: 500 }}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </span>
        </button>
      </div>

      {/* ── Footer ── */}
      <div style={{ paddingTop: 28, paddingBottom: 12, textAlign: 'center' }}>
        <MiniMeLogo size={24} color="var(--muted)" accent="#D4B987" />
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
          your business, mirrored.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10, fontSize: 11 }}>
          {[
            { href: '/legal/privacy',      label: 'Privacy' },
            { href: '/legal/terms',         label: 'Terms' },
            { href: '/legal/refunds',       label: 'Refunds' },
            { href: '/legal/data-deletion', label: 'Data Deletion' },
          ].map(l => (
            <Link key={l.href} href={l.href} style={{ color: 'var(--muted)', textDecoration: 'none', opacity: 0.7 }}>
              {l.label}
            </Link>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, opacity: 0.5 }}>v 2.0 · made in Addis</div>
      </div>

    </div>
  );
            { href: '/legal/refunds',       label: 'Refunds' },
            { href: '/legal/data-deletion', label: 'Data Deletion' },
          ].map(l => (
            <Link key={l.href} href={l.href} style={{ color: 'var(--muted)', textDecoration: 'none', opacity: 0.7 }}>
              {l.label}
            </Link>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, opacity: 0.5 }}>v 2.0 · made in Addis</div>
      </div>

    </div>
  );
}
>>>>>>> origin/main
