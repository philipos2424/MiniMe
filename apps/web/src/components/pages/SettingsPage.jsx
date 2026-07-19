'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { ChevronRight, LayoutDashboard, Sparkles, Shield, Bot, Coins, ShoppingBag, Sun, Moon, User, Users, CreditCard, GraduationCap, MessageCircle, BookOpen, Building2, AlarmClock, X, Brain, Search, LogOut, Megaphone } from 'lucide-react';
import { useToast } from '../ui/Toast';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { HowItWorks } from '../ui/HowItWorks';
import { ProLock } from '../ui/UpgradeSheet';
import { planStatus } from '../../lib/plan';

const ADMIN_IDS = [420769631, 669754127];

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK   = '#0E2823';
const PAPER = '#FFFFFF';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

// ─── Groups of settings nav items ────────────────────────────────────────────
// Three buckets matching the owner's mental model: what your business IS (Setup),
// how MiniMe BEHAVES (Your assistant), and account-level records.
//
// Personalization rows (Character / Voice / FAQ / People) are intentionally NOT
// listed here — they're all surfaced by the "Make MiniMe yours" hub
// (/settings/personalize), which is the single door into them. Keeping duplicate
// top-level rows was a big source of the "too many options" overwhelm.
const GROUPS = [
  {
    id: 'setup', title: 'Your shop',
    // Plain-language "what is this group?" shown from the "?" on the header.
    help: {
      what: 'Everything about your business itself — your name, where you are, what you sell, how you get paid, and how customers discover you.',
      why: 'The more MiniMe knows here, the better it answers customers: it can quote a price, share your address, or tell someone your opening hours without you lifting a finger.',
      eg: 'Add your hours once → when a customer asks "are you open?" at 9pm, MiniMe answers correctly on its own.',
    },
    items: [
      { href: '/settings/profile',  Icon: Building2,   label: 'Business Profile',     sub: 'Name, address, hours, social links' },
      { href: '/settings/card',     Icon: User,        label: 'Digital Business Card', sub: 'Share your info with customers' },
      { href: '/settings/bot',      Icon: Bot,         label: 'Telegram bot',         sub: 'Your bot token & username' },
      { href: '/settings/commands', Icon: BookOpen,    label: 'What you can do in the bot',   sub: 'Every command — /add, /sales, /panic…', badge: '📖' },
      { href: '/settings/payments', Icon: Coins,       label: 'Payments',             sub: 'Chapa, Telegram Stars, CBE' },
      { href: '/products',          Icon: ShoppingBag, label: 'Products & inventory', sub: 'Add, edit, delete — set prices & stock' },
      { href: '/catalog',           Icon: BookOpen,    label: 'Catalog & orders',     sub: 'Clients, orders, order history' },
      { href: '/settings/channel',  Icon: Megaphone,   label: 'Product channel',      sub: 'Auto-add products from your Telegram channel', badge: 'New' },
      { href: '/settings/hours',    Icon: Moon,        label: 'Availability',         sub: '24/7 or set quiet hours' },
      { href: '/settings/search',   Icon: Search,      label: 'MiniMe Market listing', sub: 'Your public listing — let customers discover you', badge: 'New' },
    ],
  },
  {
    id: 'assistant', title: 'Your assistant',
    help: {
      what: 'How MiniMe behaves — its personality and voice, what it\'s allowed to do on its own, who it should be careful around, and how much it does for you.',
      why: 'This is what makes MiniMe sound like YOU and not a robot. Give it a personality, teach it your prices, and decide whether it drafts replies for your OK or answers on its own.',
      eg: 'Pick a "friendly" personality and add 3 sample replies → MiniMe starts answering customers in your tone, with your emojis.',
    },
    items: [
      { href: '/settings/character',     Icon: Sparkles,     label: 'Give MiniMe a personality', sub: 'Friendly? Formal? Funny? Pick a soul or let it learn yours', badge: '✨' },
      { href: '/settings/modes',         Icon: Brain,        label: 'Secretary or bot',     sub: 'Answer from YOUR Telegram, or run a storefront bot', badge: '⚡', pro: true },
      { href: '/assistant',              Icon: MessageCircle, label: 'Chat with your assistant', sub: 'Ask anything · plan your day · send messages', badge: '💬' },
      { href: '/settings/people',        Icon: Users,        label: 'People you know',      sub: 'Family & friends — names, nicknames (gf/mom), context', badge: '💛' },
      { href: '/teach',                  Icon: GraduationCap, label: 'Teach MiniMe',        sub: 'Voice · knowledge · rules' },
      { href: '/settings/trust',         Icon: Shield,       label: 'Trust & autonomy',     sub: 'Supervised — drafts only' },
      { href: '/advisor',                Icon: Sparkles,     label: 'Advisor & Rules',      sub: 'Business advice + behavior rules', pro: true },
      { href: '/tasks',                  Icon: AlarmClock,   label: "What I'm working on",  sub: 'Scheduled outreach — approve before it sends', badge: '🗓' },
      { href: '/settings/notifications', Icon: Sun,          label: 'Morning digest',       sub: 'Daily recap in Telegram' },
    ],
  },
  {
    id: 'account', title: 'Account',
    help: {
      what: 'Your plan, your records, and your data.',
      why: 'See what you\'re paying for, keep a tamper-proof log of sensitive actions, and export everything anytime — your data is always yours.',
      eg: 'Tap "Export all data" to download every customer, order and product as a file you keep.',
    },
    items: [
      { href: '/settings/audit',        Icon: Shield,     label: 'Audit log',       sub: 'Tamper-evident record of sensitive actions', badge: '🔒' },
      { href: '/settings/billing',      Icon: CreditCard, label: 'Billing',         sub: 'Subscription and plan' },
      { href: '/api/businesses/export', Icon: Shield,     label: 'Export all data', sub: 'Download all customers, orders, products as JSON', badge: '📦' },
    ],
  },
];

// ─── Recommended-next guidance ────────────────────────────────────────────────
// So Settings isn't just a flat wall of options: point owners at the single most
// useful thing they haven't set up yet. Mode-aware — a secretary-mode owner
// using MiniMe to answer their own Telegram doesn't need "add your address";
// they need "tell me who's family so I don't pitch your mother".
function getSettingsRecommendation(business) {
  if (!business) return null;
  const sells       = !!(business.telegram_bot_username || business.shop_code);
  const secretaryOn = !!business.telegram_biz_conn_id;
  const peopleCount = business.notification_prefs?.personal_contacts?.length || 0;

  // Secretary safety first — it's replying as the owner, so without this it can
  // pitch the business to family/friends.
  if (secretaryOn && peopleCount === 0) {
    return { label: 'Tell MiniMe who your family & friends are', hint: 'So it never pitches the business to them', href: '/settings/people' };
  }
  if (!secretaryOn && !sells) {
    return { label: 'Pick how MiniMe works for you', hint: 'Secretary (your Telegram) or Bot (storefront)', href: '/settings/modes' };
  }
  if ((business.sample_replies?.length || 0) < 3) {
    return { label: 'Teach MiniMe your voice', hint: 'Add a few real replies so it sounds like you', href: '/settings/personalize' };
  }
  // Selling-specific fields only matter for owners with a storefront.
  if (sells && !business.business_hours) return { label: 'Add your opening hours', hint: 'So MiniMe knows when you’re open', href: '/settings/hours' };
  if (sells && !business.address)        return { label: 'Add your address',        hint: 'MiniMe shares it with customers who ask', href: '/settings/profile' };
  if (sells && !business.instagram)      return { label: 'Add your Instagram link', hint: 'So MiniMe can point customers to your page', href: '/settings/profile' };
  return null;
}

function RecommendedNext({ rec }) {
  if (!rec) return null;
  return (
    <Link href={rec.href} style={{ textDecoration: 'none', display: 'block', marginBottom: 20 }}>
      <div style={{
        border: `1.5px solid ${MINT}`, borderRadius: 16,
        background: 'rgba(79,163,138,0.06)', padding: '13px 16px',
        display: 'flex', alignItems: 'center', gap: 13,
      }}>
        <div style={{ fontSize: 20, lineHeight: 1 }}>🧭</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: MINT, marginBottom: 3 }}>
            Recommended next
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{rec.label}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{rec.hint}</div>
        </div>
        <ChevronRight size={18} color={MINT} strokeWidth={1.8} />
      </div>
    </Link>
  );
}

// ─── NavRow ───────────────────────────────────────────────────────────────────
function NavRow({ href, Icon, label, sub, badge, last, dotMint, locked }) {
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
            {locked && <ProLock />}
            {badge && !locked && <span style={{ background: 'rgba(176,138,74,.12)', color: GOLD, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 500 }}>{badge}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{sub}</div>
        </div>
        <ChevronRight size={16} color={MUTED} strokeWidth={1.5} />
      </div>
      {!last && <div style={{ height: 1, background: '#EEE9DE', marginLeft: 60 }} />}
    </Link>
  );
}

// ─── ActionRow (button-styled like NavRow, for in-line actions like Sign Out)
function ActionRow({ onClick, Icon, label, sub, danger, disabled, last }) {
  const color = danger ? '#B22222' : INK;
  return (
    <>
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '13px 14px', width: '100%',
          background: 'transparent', border: 'none',
          textAlign: 'left', cursor: disabled ? 'wait' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          fontFamily: BODY,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: danger ? 'rgba(178,34,34,0.08)' : CREAM,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon size={17} color={color} strokeWidth={1.6} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color }}>{label}</div>
          {sub && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{sub}</div>}
        </div>
      </button>
      {!last && <div style={{ height: 1, background: '#EEE9DE', marginLeft: 60 }} />}
    </>
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

// ─── Group explainer bottom-sheet ────────────────────────────────────────────
// Tapping the "?" on a group header opens this — a plain-language "what is this,
// why it matters, one example" card, the same teaching tone as the walkthrough.
function ExplainerSheet({ group, onClose }) {
  if (!group) return null;
  const { title, help } = group;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(14,40,35,.5)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: PAPER, borderRadius: '24px 24px 0 0', width: '100%',
          boxSizing: 'border-box', padding: '18px 22px 28px',
          animation: 'mm-sheet-up .28s cubic-bezier(.2,.7,.2,1) both',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: '#E0D8C6', margin: '0 auto 16px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD }}>What this is</div>
            <div style={{ fontFamily: SERIF, fontSize: 22, color: INK, marginTop: 2 }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: MUTED, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 14, color: '#4A5E5A', lineHeight: 1.55, margin: '0 0 14px' }}>{help.what}</p>
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: MINT, marginBottom: 5 }}>Why it matters</div>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.5 }}>{help.why}</div>
        </div>
        <div style={{ background: CREAM, borderRadius: 14, padding: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: GOLD, marginBottom: 5 }}>For example</div>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.5 }}>{help.eg}</div>
        </div>
        <button onClick={onClose} style={{
          width: '100%', marginTop: 18, padding: 14, borderRadius: 999, border: 'none',
          background: INK, color: PAPER, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
        }}>Got it</button>
      </div>
      <style>{`@keyframes mm-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─── Secretary highlight ──────────────────────────────────────────────────────
// The single most under-used, most-magical feature: MiniMe answering from the
// owner's OWN Telegram account. Emphasised with its own card so owners notice it.
// ─── Search visibility ────────────────────────────────────────────────────────
// Mirrors EXACTLY the gate in /api/directory/search (and directory/page.js):
//   b2b_discoverable = true
//   AND (telegram_bot_username IS NOT NULL
//        OR (shop_code IS NOT NULL AND onboarding_completed = true))
// Without this card a shop can be invisible in MiniMe Search with no error and
// no signal — the owner just silently never gets found. Keep in sync with the
// API if that gate ever changes.
function searchVisibility(business) {
  if (!business) return null;
  const discoverable = business.b2b_discoverable !== false;
  const reachable = !!business.telegram_bot_username
    || (!!business.shop_code && !!business.onboarding_completed);

  if (!discoverable) {
    return { ok: false, title: 'Hidden from MiniMe Search',
      sub: 'You turned discovery off — turn it on to get found by shoppers.',
      href: '/settings/network' };
  }
  if (!reachable) {
    return { ok: false, title: 'Not visible in MiniMe Search yet',
      sub: 'Finish connecting your bot so shoppers can reach you.',
      href: '/settings/bot' };
  }
  return { ok: true, title: 'Visible in MiniMe Search',
    sub: 'Shoppers can find your shop and message you.',
    href: '/directory' };
}

function SearchVisibilityCard({ business }) {
  const v = searchVisibility(business);
  if (!v) return null;
  const accent = v.ok ? MINT : '#B85450';
  return (
    <Link href={v.href} style={{ textDecoration: 'none', display: 'block', marginBottom: 22 }}>
      <div style={{
        border: `1px solid ${v.ok ? 'rgba(79,163,138,.35)' : 'rgba(184,84,80,.35)'}`,
        borderRadius: 16,
        background: v.ok ? 'rgba(79,163,138,.06)' : 'rgba(184,84,80,.05)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 13,
      }}>
        <div style={{ fontSize: 20, flexShrink: 0 }}>{v.ok ? '🔎' : '⚠️'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{v.title}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{v.sub}</div>
        </div>
        <ChevronRight size={16} color={accent} strokeWidth={1.8} />
      </div>
    </Link>
  );
}

function SecretaryCard({ business }) {
  const on = !!business?.telegram_biz_conn_id;
  const { isPro } = planStatus(business);
  return (
    <Link href="/settings/modes" style={{ textDecoration: 'none', display: 'block', marginBottom: 22 }}>
      <div style={{
        position: 'relative', overflow: 'hidden',
        border: `1px solid #1E3A35`, borderRadius: 16, background: INK,
        padding: '18px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'rgba(212,185,135,0.16)', display: 'grid', placeItems: 'center',
        }}>
          <User size={20} color="#D4B987" strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: '#D4B987' }}>
              {on ? 'Secretary is on' : 'Secretary mode'}
            </div>
            {!isPro && !on && <ProLock />}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 18, color: PAPER, letterSpacing: '-0.01em' }}>
            Answer from <span style={{ fontStyle: 'italic', color: '#D4B987' }}>your own</span> account
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(244,238,225,0.6)', marginTop: 3, lineHeight: 1.45 }}>
            {on
              ? 'MiniMe is replying to customers from your personal Telegram. Tap to manage.'
              : 'Let MiniMe reply to customers from your personal Telegram — as you. Set it up in 4 taps.'}
          </div>
        </div>
        <ChevronRight size={18} color="rgba(244,238,225,0.5)" strokeWidth={1.8} />
      </div>
    </Link>
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
  const [query, setQuery] = useState('');
  const [howOpen, setHowOpen] = useState(false);
  const [helpGroup, setHelpGroup] = useState(null); // group whose "?" explainer is open

  async function handleSignOut() {
    if (signingOut) return;
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const insideTelegram = !!twa?.initData;

    // Use Telegram's native confirmation when we can — feels native, no broken
    // browser confirm() in the mini-app.
    let ok = false;
    if (insideTelegram && typeof twa.showConfirm === 'function') {
      ok = await new Promise(resolve => {
        try {
          twa.showConfirm(
            "Sign out and start fresh? Next time you open MiniMe you'll go through setup again — your products and chats stay saved.",
            (confirmed) => resolve(!!confirmed)
          );
        } catch { resolve(window.confirm('Sign out of MiniMe?')); }
      });
    } else {
      ok = typeof window !== 'undefined'
        ? window.confirm("Sign out and start fresh? You'll go through setup again next time — your data stays saved.")
        : true;
    }
    if (!ok) return;
    setSigningOut(true);

    // Reopen the onboarding gate so the next open starts a brand-new signup.
    // NON-DESTRUCTIVE — products, chats, orders and settings are all kept.
    try {
      await fetch('/api/onboarding/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
      });
    } catch (e) { console.warn('reset error', e); }

    // Clear every trace of session/cached data so reopening starts clean.
    try { await supabase.auth.signOut(); } catch (e) { console.warn('signOut error', e); }
    try {
      sessionStorage.clear();
      // localStorage may have Supabase tokens + theme preference — drop the lot
      // EXCEPT user's manual theme so it persists across sessions.
      const theme = localStorage.getItem('mm_theme');
      localStorage.clear();
      if (theme) localStorage.setItem('mm_theme', theme);
    } catch {}

    // Inside Telegram: closing the WebApp IS the sign-out. There's no real
    // "logged-out state" in a mini-app — the identity IS your Telegram account,
    // and reopening the bot is how you sign back in.
    if (insideTelegram && typeof twa.close === 'function') {
      try { twa.close(); return; } catch {}
    }
    // Browser fallback (rare): go to the login page.
    router.push('/login');
    setTimeout(() => {
      try { window.location.href = '/login'; } catch {}
    }, 200);
  }

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

  // Live filter across all groups by label + description — the redesign's
  // answer to "20 rows with no guidance": type to jump straight to a row
  // instead of scanning three groups by eye.
  const q = query.trim().toLowerCase();
  const filteredGroups = q
    ? GROUPS.map(g => ({ ...g, items: g.items.filter(it => (it.label + ' ' + it.sub).toLowerCase().includes(q)) }))
        .filter(g => g.items.length > 0)
    : GROUPS;
  const noResults = q.length > 0 && filteredGroups.length === 0;
  const { isPro } = planStatus(business);

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 100, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <div style={{ padding: '20px 22px 12px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>Account</div>
        <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>Settings</div>
      </div>

      {/* Live search — filters every row below by label + description */}
      <div style={{ padding: '2px 22px 4px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} color={MUTED} strokeWidth={1.8} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search settings…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 40px',
              borderRadius: 12, border: `1px solid ${LINE}`, background: '#fff',
              fontFamily: BODY, fontSize: 14, color: INK, outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ padding: '14px 22px 0' }}>

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

        {/* Recommended next — guides owners to the most useful unconfigured area
            so the settings list isn't just a flat wall. Self-hides when done. */}
        <RecommendedNext rec={getSettingsRecommendation(business)} />

        {/* Am I findable? Same gate as the search API — no silent invisibility. */}
        <SearchVisibilityCard business={business} />

        {/* Secretary — emphasised: MiniMe answering from the owner's own account */}
        <SecretaryCard business={business} />

        {/* Hero card — "Make MiniMe yours": a single landing surface that
            shows every personalization knob in one place (voice, personality,
            rules, FAQ, people). Solves discoverability — owners no longer
            have to dive into 8 submenus to find what they've personalized. */}
        <Link href="/settings/personalize" style={{ textDecoration: 'none', display: 'block', marginBottom: 22 }}>
          <div style={{
            position: 'relative',
            border: `1.5px solid ${MINT}`, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(79,163,138,0.08) 0%, rgba(79,163,138,0.02) 100%)',
            padding: '18px 18px 18px 18px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'rgba(79,163,138,0.15)',
              display: 'grid', placeItems: 'center',
            }}>
              <Sparkles size={20} color={MINT} strokeWidth={1.8} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, color: INK, letterSpacing: '-0.01em' }}>
                Make MiniMe <span style={{ fontStyle: 'italic' }}>yours</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#4A5E5A', marginTop: 3, lineHeight: 1.45 }}>
                Everything personalizable in one place — voice, personality, rules, people.
              </div>
            </div>
            <ChevronRight size={18} color={MINT} strokeWidth={1.8} />
          </div>
        </Link>

        {/* Setting groups — filtered live by the search box above */}
        {filteredGroups.map(({ id, title, items, help }) => (
          <div key={id} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
                {title}
              </div>
              {help && !q && (
                <button
                  onClick={() => setHelpGroup({ title, help })}
                  aria-label={`What is ${title}?`}
                  style={{
                    width: 16, height: 16, borderRadius: '50%', border: `1px solid ${LINE}`,
                    background: '#fff', color: MUTED, fontSize: 10, fontWeight: 700,
                    cursor: 'pointer', display: 'grid', placeItems: 'center', lineHeight: 1, padding: 0,
                  }}
                >?</button>
              )}
            </div>
            <div style={{ background: '#fff', border: `1px solid #EEE9DE`, borderRadius: 16, overflow: 'hidden' }}>
              {items.map((it, i) => (
                <NavRow key={it.href}
                  href={it.href} Icon={it.Icon} label={it.label} sub={it.sub}
                  badge={it.badge}
                  locked={it.pro && !isPro}
                  dotMint={it.href === '/settings/bot' && botConnected}
                  last={id === 'account' ? false : i === items.length - 1}
                />
              ))}
              {/* Replay the "How MiniMe works" walkthrough — the same short,
                  accurate 6-step explainer shown from Home, not the full
                  re-signup wizard. Only shown when not filtering. */}
              {id === 'account' && !q && (
                <ActionRow
                  onClick={() => setHowOpen(true)}
                  Icon={Sparkles}
                  label="Replay walkthrough"
                  sub="See how MiniMe works again"
                />
              )}
              {/* Sign Out lives inside the Account group so people find it where they expect */}
              {id === 'account' && !q && (
                <ActionRow
                  onClick={handleSignOut}
                  Icon={LogOut}
                  label={signingOut ? 'Signing out…' : 'Sign out'}
                  sub="Sign out and start fresh — your data is kept"
                  danger
                  disabled={signingOut}
                  last
                />
              )}
            </div>
          </div>
        ))}

        {noResults && (
          <div style={{ textAlign: 'center', padding: '34px 10px', color: MUTED }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 14 }}>Nothing matches "{query}".</div>
          </div>
        )}

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
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginTop: 12, fontSize: 12 }}>
            {[
              { href: '/legal/privacy', label: 'Privacy' },
              { href: '/legal/terms', label: 'Terms' },
              { href: '/legal/refunds', label: 'Refunds' },
              { href: '/legal/data-deletion', label: 'Data Deletion' },
            ].map((l, i) => (
              <span key={l.href} style={{ display: 'inline-flex', gap: 6 }}>
                {i > 0 && <span style={{ color: MUTED, opacity: 0.4 }}>·</span>}
                <Link href={l.href} style={{ color: MUTED, textDecoration: 'none', opacity: 0.85 }}>{l.label}</Link>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 10, opacity: 0.7 }}>v 2.0 · made in Addis</div>
        </div>

      </div>

      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} />
      <ExplainerSheet group={helpGroup} onClose={() => setHelpGroup(null)} />
    </div>
  );
}
