'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { ChevronRight, LayoutDashboard, Sparkles, Shield, Bot, Coins, ShoppingBag, Sun, Moon, Bell, User, CreditCard, GraduationCap, MessageCircle, BookOpen, Building2, AlarmClock, Users, X, Brain, Globe, Search } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { MiniMeLogo } from '../ui/MiniMeLogo';

const ADMIN_IDS = [420769631, 669754127];

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

// ─── Groups of settings nav items ────────────────────────────────────────────
const GROUPS = [
  {
    id: 'profile', title: 'Your Business',
    items: [
      { href: '/settings/profile', Icon: Building2,    label: 'Business Profile',  sub: 'Name, address, hours, social links' },
      { href: '/settings/card',    Icon: User,         label: 'Digital Business Card', sub: 'Share your info with customers' },
    ],
  },
  {
    id: 'brain', title: 'Brain',
    items: [
      { href: '/teach',          Icon: GraduationCap, label: 'Teach MiniMe',    sub: 'Voice · knowledge · rules' },
      { href: '/settings/faq',   Icon: MessageCircle, label: 'FAQ Replies',       sub: 'Exact answers to common questions', badge: '💡' },
      { href: '/settings/trust', Icon: Shield,         label: 'Trust & autonomy', sub: 'Supervised — drafts only' },
      { href: '/advisor',        Icon: Sparkles,       label: 'Advisor & Rules',  sub: 'Business advice + behavior rules' },
    ],
  },
  {
    id: 'channels', title: 'Channels',
    items: [
      { href: '/settings/bot',      Icon: Bot,            label: 'Telegram bot',       sub: 'Your bot token & username' },
      { href: '/settings/commands', Icon: BookOpen,       label: 'Bot commands guide', sub: 'How to use your bot', badge: '📖' },
      { href: '/settings/channels', Icon: MessageCircle,  label: 'WhatsApp · IG · FB', sub: 'Connect other platforms',  badge: 'New' },
      { href: '/settings/payments', Icon: Coins,          label: 'Payments',           sub: 'Chapa, Telegram Stars, CBE' },
      { href: '/catalog',           Icon: ShoppingBag,    label: 'Catalog & orders',   sub: 'Products, clients, orders' },
      { href: '/settings/network',  Icon: Globe,          label: 'Network & B2B',      sub: 'Visibility, blocklist, negotiation limits' },
      { href: '/settings/search',   Icon: Search,         label: 'MiniMe Search',      sub: 'How many customers found you via search', badge: 'New' },
    ],
  },
  {
    id: 'rhythm', title: 'Rhythm',
    items: [
      { href: '/reminders',              Icon: AlarmClock, label: 'Reminders',        sub: 'Schedule Telegram alerts' },
      { href: '/settings/notifications', Icon: Sun,        label: 'Morning digest',  sub: 'Daily recap in Telegram' },
      { href: '/settings/hours',         Icon: Moon,       label: 'Availability',    sub: '24/7 or set quiet hours' },
      { href: '/settings/voice',         Icon: Bell, label: 'Voice & style',   sub: 'Sample replies + tone' },
    ],
  },
  {
    id: 'team', title: 'Team',
    items: [
      { href: '/settings/staff', Icon: Users, label: 'Staff access', sub: 'Let team members view orders & chats' },
      { href: '/discounts',      Icon: Coins, label: 'Discount codes', sub: 'Promo codes for customers' },
      { href: '/settings/audit', Icon: Shield, label: 'Audit log', sub: 'Tamper-evident record of sensitive actions', badge: '🔒' },
    ],
  },
  {
    id: 'account', title: 'Account',
    items: [
      { href: '/settings/billing', Icon: CreditCard, label: 'Billing',    sub: 'Subscription and plan' },
      { href: '/settings/email',   Icon: User,       label: 'Email',      sub: 'Connect Gmail or Outlook', badge: 'Soon' },
      { href: '/api/businesses/export', Icon: Shield, label: 'Export all data', sub: 'Download all customers, orders, products as JSON', badge: '📦' },
    ],
  },
];

// ─── NavRow ───────────────────────────────────────────────────────────────────
function NavRow({ href, Icon, label, sub, badge, last, dotMint }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', cursor: 'pointer' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: CREAM,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={17} color={INK} strokeWidth={1.6} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: INK }}>{label}</div>
            {dotMint && <span style={{ width: 6, height: 6, borderRadius: '50%', background: MINT, flexShrink: 0 }} />}
            {badge && <span style={{ background: 'rgba(176,138,74,.12)', color: GOLD, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 500 }}>{badge}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{sub}</div>
        </div>
        <ChevronRight size={16} color={MUTED} strokeWidth={1.5} />
      </div>
      {!last && <div style={{ height: 1, background: '#EEE9DE', marginLeft: 60 }} />}
    </Link>
  );
}

// ─── OwnerFactsCard ───────────────────────────────────────────────────────────
function OwnerFactsCard({ business, supabase, toast }) {
  const [facts, setFacts] = useState(null);       // null = loading
  const [deleting, setDeleting] = useState(null); // index being deleted

  useEffect(() => {
    if (!business?.id) return;
    const raw = business.notification_prefs?.owner_facts;
    setFacts(Array.isArray(raw) ? raw : []);
  }, [business]);

  async function deleteFact(idx) {
    if (deleting != null) return;
    setDeleting(idx);
    const next = facts.filter((_, i) => i !== idx);

    // Optimistic update
    setFacts(next);

    const currentPrefs = business.notification_prefs || {};
    const { error } = await supabase
      .from('businesses')
      .update({ notification_prefs: { ...currentPrefs, owner_facts: next } })
      .eq('id', business.id);

    setDeleting(null);
    if (error) {
      // Rollback
      setFacts(facts);
      toast('Could not remove fact.', { variant: 'error' });
    }
  }

  if (facts === null) return null; // still loading

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: MUTED, marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Brain size={12} color={MUTED} strokeWidth={2} />
        What MiniMe knows about you
      </div>

      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 16 }}>
        {facts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              MiniMe hasn't learned your preferences yet.<br />
              <span style={{ fontSize: 12, opacity: 0.7 }}>Keep chatting — facts appear here after a day of use.</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {facts.map((fact, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: CREAM, border: `1px solid ${LINE}`,
                borderRadius: 999, padding: '6px 10px 6px 13px',
                fontSize: 12.5, color: INK, lineHeight: 1.3,
                opacity: deleting === i ? 0.4 : 1,
                transition: 'opacity .15s',
              }}>
                <span style={{ flex: 1 }}>{fact}</span>
                <button
                  onClick={() => deleteFact(i)}
                  disabled={deleting != null}
                  style={{
                    appearance: 'none', border: 'none', background: 'none',
                    padding: 2, cursor: 'pointer', display: 'grid', placeItems: 'center',
                    borderRadius: '50%', color: MUTED, flexShrink: 0,
                  }}
                  title="Remove this fact"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: MUTED, marginTop: 12, lineHeight: 1.5, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
          These preferences are automatically extracted from your conversations and used to help MiniMe act without asking you every time.
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { business: tgBusiness, telegramUser } = useTelegram();
  const isAdmin = ADMIN_IDS.includes(Number(telegramUser?.id));
  const supabase = createClient();
  const { toast } = useToast();
  const [business, setBusiness] = useState(null);

  useEffect(() => {
    if (tgBusiness) setBusiness(tgBusiness);
  }, [tgBusiness]);

  const ownerName = business?.owner_name || tgBusiness?.owner_name || '';
  const ownerFirst = ownerName.split(' ')[0] || '';
  const botConnected = !!(
    business?.telegram_bot_username || tgBusiness?.telegram_bot_username ||
    ((business?.onboarding_completed || tgBusiness?.onboarding_completed) &&
     (business?.shop_code || tgBusiness?.shop_code))
  );

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 100, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <div style={{ padding: '20px 22px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>Account</div>
        <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>Settings</div>
      </div>

      <div style={{ padding: '0 22px' }}>

        {/* Profile header card — links to dedicated profile page */}
        <Link href="/settings/profile" style={{ textDecoration: 'none', display: 'block', marginBottom: 20 }}>
          <div style={{
            border: `1px solid ${LINE}`, borderRadius: 16, background: CREAM, padding: 16,
            display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: '0 1px 0 rgba(14,40,35,.04)',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#E8D3A6',
              display: 'grid', placeItems: 'center', flexShrink: 0,
              fontFamily: SERIF, fontSize: 22, color: '#5C4520',
            }}>
              {(ownerFirst || business?.name || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, color: INK }}>{ownerName || business?.name || 'Your business'}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                {business?.name} · {business?.subscription_plan || 'Free'} plan
              </div>
            </div>
            <ChevronRight size={18} color={MUTED} strokeWidth={1.5} />
          </div>
        </Link>

        {/* Setting groups */}
        {GROUPS.map(({ id, title, items }) => (
          <div key={id} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
              {title}
            </div>
            <div style={{ background: '#fff', border: `1px solid #EEE9DE`, borderRadius: 16, overflow: 'hidden' }}>
              {items.map((it, i) => (
                <NavRow key={it.href}
                  href={it.href} Icon={it.Icon} label={it.label} sub={it.sub}
                  badge={it.badge}
                  dotMint={it.href === '/settings/bot' && botConnected}
                  last={i === items.length - 1}
                />
              ))}
            </div>
          </div>
        ))}

        {/* What MiniMe knows about you */}
        {business && (
          <OwnerFactsCard business={business} supabase={supabase} toast={toast} />
        )}

        {/* Admin */}
        {isAdmin && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>Platform</div>
            <div style={{ background: INK, border: `1px solid #1E3A35`, borderRadius: 16, overflow: 'hidden' }}>
              <Link href="/admin" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(176,138,74,.15)', display: 'grid', placeItems: 'center' }}>
                  <LayoutDashboard size={17} color={GOLD} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: PAPER }}>Admin Panel</div>
                  <div style={{ fontSize: 12.5, color: 'rgba(244,238,225,0.5)', marginTop: 2 }}>All businesses, platform health</div>
                </div>
                <ChevronRight size={16} color="rgba(244,238,225,0.4)" strokeWidth={1.5} />
              </Link>
            </div>
          </div>
        )}

        {/* Footer mark */}
        <div style={{ paddingTop: 8, paddingBottom: 12, textAlign: 'center' }}>
          <MiniMeLogo size={28} color={MUTED} accent="#D4B987" />
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', marginTop: 8, color: MUTED, fontSize: 13 }}>
            your business, mirrored.
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4, opacity: 0.7 }}>v 2.0 · made in Addis</div>
        </div>

      </div>
    </div>
  );
}
