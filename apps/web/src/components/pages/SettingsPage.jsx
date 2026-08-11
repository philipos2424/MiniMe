'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import {
  ChevronRight, Bot, Sparkles, Shield, CreditCard, Users,
  MessageCircle, User, Brain, LayoutDashboard, LogOut, ShoppingBag,
  Clock, Search, BookOpen, Megaphone, Sun, Lock, FileText,
} from 'lucide-react';
import { useToast } from '../ui/Toast';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { ProLock } from '../ui/UpgradeSheet';
import { planStatus } from '../../lib/plan';

const ADMIN_IDS = [420769631, 669754127];
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const SERIF = "'Newsreader', Georgia, serif";

// ─── Section + item definitions ──────────────────────────────────────────────
// Each section: { section, emoji, desc }
// Each item:    { href, Icon, label, sub, pro, accent }
// accent: 'gold' | 'mint' | 'ink' — gives the icon a tinted background
const ITEMS = [
  // ── AI Assistant ──
  { section: 'AI Assistant', emoji: '🤖', desc: 'Customize how MiniMe works' },
  { href: '/settings/character',     Icon: Sparkles,      label: 'Personality & Voice',    sub: 'Set tone, style & greeting language',         pro: false, accent: 'gold' },
  // Secretary is a Free feature now (capped monthly, see lib/plan.js) — no PRO badge.
  { href: '/settings/modes',         Icon: Bot,           label: 'Secretary Mode',          sub: 'Auto-handle messages when you\'re busy',       pro: false, accent: 'mint' },
  { href: '/teach',                  Icon: Brain,         label: 'Knowledge Base',          sub: 'View & edit facts, prices & documents (Teach)',pro: false, accent: 'ink'  },
  { href: '/settings/trust',         Icon: Shield,        label: 'Trust & Autonomy',        sub: 'Control what MiniMe can do on its own',        pro: false },
  { href: '/settings/notifications', Icon: Sun,           label: 'Morning Digest',          sub: 'Daily AI summary, sent every morning',         pro: false },

  // ── Business ──
  { section: 'Business', emoji: '🏪', desc: 'Manage your company details' },
  { href: '/settings/profile',       Icon: User,          label: 'Business Profile',        sub: 'Name, address, photo & contact info',          pro: false },
  { href: '/settings/bot',           Icon: Bot,           label: 'Telegram Connection',     sub: 'Connect and configure your Telegram bot',      pro: false },
  { href: '/agent/team',             Icon: Users,         label: 'Team & Roles',            sub: 'Invite teammates, set roles & delegation',     pro: false },
  { href: '/settings/hours',         Icon: Clock,         label: 'Availability Hours',      sub: 'When MiniMe is active and when it rests',      pro: false },
  { href: '/settings/people',        Icon: Users,         label: 'People You Know',         sub: 'VIPs, staff & trusted contacts',               pro: false },

  // ── Commerce ──
  { section: 'Commerce', emoji: '🛒', desc: 'Payments & storefront settings' },
  { href: '/settings/payments',      Icon: CreditCard,    label: 'Payments',                sub: 'Configure payment methods & bank accounts',     pro: false },
  { href: '/settings/channel',       Icon: Megaphone,     label: 'Product Channel',         sub: 'Auto-post new products to a Telegram channel', pro: false },
  { href: '/settings/search',        Icon: Search,        label: 'MiniMe Market Listing',   sub: 'How your shop appears on MiniMe Market',       pro: false },

  // ── Privacy ──
  { section: 'Privacy', emoji: '🔒', desc: 'Your data & security' },
  { href: '/settings/audit',         Icon: FileText,      label: 'Audit Log',               sub: 'See every action MiniMe has taken',            pro: false },
  { href: '/api/businesses/export',  Icon: Shield,        label: 'Export My Data',          sub: 'Download all your business data',              pro: false },

  // ── Support ──
  { section: 'Support', emoji: '💳', desc: 'Billing & help' },
  { href: '/settings/billing',       Icon: CreditCard,    label: 'Billing & Plan',          sub: 'Manage your subscription',                     pro: false },
  { href: '/assistant',              Icon: MessageCircle, label: 'Support & Help',          sub: 'Ask questions about your account or features', pro: false },
];

// ─── Icon accent colors ───────────────────────────────────────────────────────
const ACCENT_BG = {
  gold: 'rgba(176,138,74,.15)',
  mint: 'rgba(79,163,138,.13)',
  ink:  'rgba(14,40,35,.1)',
};
const ACCENT_COLOR = {
  gold: 'var(--gold)',
  mint: 'var(--mint)',
  ink:  'var(--ink)',
};

// ─── Single settings row ──────────────────────────────────────────────────────
function Row({ href, Icon, label, sub, pro, isPro, accent, last }) {
  const locked = pro && !isPro;
  const bgColor  = accent ? ACCENT_BG[accent]   : 'var(--cream)';
  const iconColor = accent ? ACCENT_COLOR[accent] : 'var(--ink)';
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', cursor: 'pointer',
      }}>
        {/* Icon bubble */}
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          background: bgColor,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={17} color={iconColor} strokeWidth={1.6} />
        </div>

        {/* Label + subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15, fontWeight: accent ? 500 : 400, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
              {label}
            </span>
            {locked && <ProLock />}
          </div>
          {sub && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1.5, lineHeight: 1.35 }}>
              {sub}
            </div>
          )}
        </div>

        <ChevronRight size={15} color="var(--muted)" strokeWidth={1.5} />
      </div>
      {!last && (
        <div style={{ height: 1, background: 'var(--line-soft)', marginLeft: 68 }} />
      )}
    </Link>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionLabel({ emoji, title, desc }) {
  return (
    <div style={{ padding: '22px 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {emoji && <span style={{ fontSize: 14 }}>{emoji}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {title}
        </span>
      </div>
      {desc && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', paddingLeft: emoji ? 20 : 0 }}>
          {desc}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
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
  const planLabel  = isPro ? 'Pro' : (business?.subscription_plan || 'Free');
  const paused     = !!business?.panic_mode;

  // Build section groups
  const sections = [];
  let currentLabel = null;
  let currentGroup = [];

  ITEMS.forEach(item => {
    if (item.section) {
      if (currentGroup.length) {
        sections.push({ type: 'group', label: currentLabel, items: currentGroup });
        currentGroup = [];
      }
      currentLabel = { title: item.section, emoji: item.emoji, desc: item.desc };
    } else {
      currentGroup.push(item);
    }
  });
  if (currentGroup.length) sections.push({ type: 'group', label: currentLabel, items: currentGroup });

  return (
    <div style={{
      background: 'var(--paper)', minHeight: '100vh',
      paddingBottom: 100, fontFamily: BODY, color: 'var(--ink)',
    }}>

      {/* ── Profile card ── */}
      <div style={{ padding: '20px 16px 0' }}>
        <Link href="/settings/profile" style={{ textDecoration: 'none', display: 'block' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 16px',
            background: 'var(--cream)', borderRadius: 18,
            border: '1px solid var(--line-soft)',
          }}>
            {/* Avatar */}
            <div style={{
              width: 58, height: 58, borderRadius: '50%',
              background: 'rgba(176,138,74,0.18)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              fontFamily: SERIF, fontSize: 24, color: 'var(--gold)',
            }}>
              {(ownerFirst || business?.name || '?').charAt(0).toUpperCase()}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Name */}
              <div style={{
                fontFamily: SERIF, fontSize: 19, lineHeight: 1.15,
                color: 'var(--ink)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {ownerName || business?.name || 'Your business'}
              </div>
              {/* Business name */}
              {business?.name && ownerName && (
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>
                  {business.name}
                </div>
              )}
              {/* Plan + status badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
                  padding: '2px 9px', borderRadius: 999,
                  background: isPro ? 'rgba(176,138,74,.15)' : 'var(--cream-2)',
                  color: isPro ? 'var(--gold)' : 'var(--muted)',
                  border: isPro ? '1px solid rgba(176,138,74,.3)' : '1px solid var(--line)',
                }}>
                  {isPro ? '⭐ Pro Plan' : `${planLabel} Plan`}
                </span>
                {paused
                  ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'rgba(192,57,43,.1)', color: '#C0392B', border: '1px solid rgba(192,57,43,.2)' }}>⏸ Paused</span>
                  : <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: 'rgba(79,163,138,.1)', color: 'var(--mint)', border: '1px solid rgba(79,163,138,.2)' }}>● Active</span>
                }
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              <ChevronRight size={18} color="var(--muted)" strokeWidth={1.5} />
              <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>View Profile</span>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Settings sections ── */}
      {sections.map((s, si) => (
        <div key={si}>
          {s.label && (
            <SectionLabel emoji={s.label.emoji} title={s.label.title} desc={s.label.desc} />
          )}
          <div style={{
            margin: '0 16px',
            background: 'var(--card)',
            border: '1px solid var(--line-soft)',
            borderRadius: 16, overflow: 'hidden',
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
        </div>
      ))}

      {/* ── Admin panel ── */}
      {isAdmin && (
        <>
          <SectionLabel emoji="⚙️" title="Platform" desc="Internal admin tools" />
          <div style={{
            margin: '0 16px',
            background: 'var(--card)', border: '1px solid var(--line-soft)',
            borderRadius: 16, overflow: 'hidden',
          }}>
            <Link href="/admin" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(176,138,74,.15)', display: 'grid', placeItems: 'center' }}>
                <LayoutDashboard size={17} color="var(--gold)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, color: 'var(--ink)' }}>Admin Panel</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>Platform-wide controls</div>
              </div>
              <ChevronRight size={15} color="var(--muted)" strokeWidth={1.5} />
            </Link>
          </div>
        </>
      )}

      {/* ── Sign out ── */}
      <SectionLabel emoji="🚪" title="Session" desc="" />
      <div style={{
        margin: '0 16px',
        background: 'var(--card)', border: '1px solid var(--line-soft)',
        borderRadius: 16, overflow: 'hidden',
      }}>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 16px', width: '100%',
            background: 'transparent', border: 'none',
            textAlign: 'left', cursor: signingOut ? 'wait' : 'pointer',
            opacity: signingOut ? 0.6 : 1, fontFamily: BODY,
          }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(192,57,43,.1)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <LogOut size={17} color="#C0392B" strokeWidth={1.6} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, color: '#C0392B', fontWeight: 600 }}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(192,57,43,.6)', marginTop: 1 }}>
              Your products and chats stay saved
            </div>
          </div>
        </button>
      </div>

      {/* ── Footer ── */}
      <div style={{ padding: '36px 20px 16px', textAlign: 'center' }}>
        <MiniMeLogo size={28} color="var(--muted)" accent="#D4B987" />
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', marginTop: 8, color: 'var(--muted)', fontSize: 13, letterSpacing: '-0.01em' }}>
          Your business, mirrored.
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, opacity: 0.55 }}>
          Version 2.0 · Made in Addis
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11.5 }}>
          {[
            { href: '/legal/privacy',      label: 'Privacy' },
            { href: '/legal/terms',        label: 'Terms' },
            { href: '/legal/refunds',      label: 'Refunds' },
            { href: '/legal/data-deletion',label: 'Data Deletion' },
          ].map((l, i, arr) => (
            <>
              <Link key={l.href} href={l.href} style={{ color: 'var(--muted)', textDecoration: 'none', opacity: 0.75 }}>
                {l.label}
              </Link>
              {i < arr.length - 1 && <span style={{ color: 'var(--muted)', opacity: 0.35 }}>·</span>}
            </>
          ))}
        </div>
      </div>

    </div>
  );
}
