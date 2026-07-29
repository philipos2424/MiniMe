'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { updateBusiness } from '../../lib/updateBusiness';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { HowItWorks, HowItWorksTrigger } from '../ui/HowItWorks';
import { HomeCoach, ReplayTourPill, useHomeCoach } from '../ui/HomeCoach';
import { ReviewSheet } from '../dashboard/ReviewSheet';
import { AdvisorSheet } from '../dashboard/AdvisorSheet';
import { Plus, Users, Brain, Share2, Sparkles, CheckCircle2, ChevronRight, MessageSquare } from 'lucide-react';
import { tgAlert } from '../../lib/utils';
import { FeedbackModal } from '../layout/DashboardShell';
import { ImportPaths } from './ProductsPage';
import { planStatus } from '../../lib/plan';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = 'var(--ink)';
const PAPER  = 'var(--paper)';
const CREAM  = 'var(--cream)';
const CREAM2 = 'var(--cream-2)';
const GOLD   = 'var(--gold)';
const GOLDSF = 'var(--gold-soft)';
const MINT   = 'var(--mint)';
const MUTED  = 'var(--muted)';
const LINE   = 'var(--line)';
const LINESF = 'var(--line-soft)';
const ERROR  = 'var(--error)';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

function greeting() {
  const now = new Date();
  const h = now.getHours();
  const amharicDay = now.getDate() % 2 === 0;
  if (h < 5)  return amharicDay ? 'ሌሊቱን ሙሉ' : 'Working late';
  if (h < 12) return amharicDay ? 'እንደምን አደሩ' : 'Good morning';
  if (h < 18) return amharicDay ? 'እንደምን ዋሉ' : 'Good afternoon';
  return amharicDay ? 'እንደምን አመሹ' : 'Good evening';
}

// ─── TopBar ──────────────────────────────────────────────────────────────────
function TopBar({ businessName, ownerName, active, onToggle }) {
  return (
    <div style={{
      padding: '16px 22px 14px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: PAPER, borderBottom: `1px solid ${LINE}`,
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 12, background: INK, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <MiniMeLogo size={22} color={CREAM} accent={GOLDSF} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: INK, display: 'flex', alignItems: 'center', gap: 4 }}>
            {greeting()} 👋
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1.15, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {businessName}
          </div>
          <div style={{ fontSize: 11, color: active ? MINT : ERROR, marginTop: 1, fontWeight: 500 }}>
            {active ? 'AI is active & handling customers' : 'AI is paused'}
          </div>
        </div>
      </div>
      <button
        onClick={onToggle}
        style={{
          border: `1px solid ${LINE}`, background: 'var(--card)',
          padding: '6px 13px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', fontFamily: BODY, fontSize: 12, fontWeight: 600, flexShrink: 0,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: active ? MINT : ERROR,
          boxShadow: active ? `0 0 0 3px rgba(79,163,138,.2)` : 'none',
        }} />
        <span style={{ color: active ? MINT : ERROR }}>
          {active ? 'Active' : 'Paused'}
        </span>
      </button>
    </div>
  );
}

// ─── Hero Impact Card — "What MiniMe did for your business" ──────────────────
function HeroImpactCard({ feed, active }) {
  const handled = feed?.handled_today ?? 0;
  const hoursSaved = feed?.hours_saved_today != null
    ? (feed.hours_saved_today < 1 ? `${Math.round(feed.hours_saved_today * 60)}m` : `${feed.hours_saved_today}h`)
    : '0m';

  return (
    <div style={{
      background: INK, color: '#FFFFFF', borderRadius: 22, padding: '22px 20px',
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 14px 36px -16px rgba(14,40,35,.4)', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLDSF }}>
          <Sparkles size={14} color={GOLDSF} />
          MiniMe AI Impact
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.12)', borderRadius: 999,
          padding: '3px 10px', fontSize: 11, color: CREAM, fontWeight: 600,
        }}>
          {active ? '🟢 Live' : '⏸ Paused'}
        </div>
      </div>

      <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.25, color: PAPER, marginBottom: 8 }}>
        MiniMe handled <span style={{ color: GOLDSF, fontStyle: 'italic' }}>{handled} customer question{handled === 1 ? '' : 's'}</span> today.
      </div>

      <div style={{ fontSize: 13, color: 'rgba(244,238,225,.7)', lineHeight: 1.45 }}>
        Saved you <strong style={{ color: PAPER, fontWeight: 600 }}>{hoursSaved}</strong> of typing — answering prices, hours & product details.
      </div>
    </div>
  );
}

// ─── Quick Actions Bar ────────────────────────────────────────────────────────
function QuickActionsBar({ shareUrl, shareLabel }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
        Quick Actions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <Link href="/products" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '12px 6px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 6px', color: INK }}>
              <Plus size={18} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>+ Product</div>
          </div>
        </Link>

        <Link href="/agent/team" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '12px 6px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 6px', color: INK }}>
              <Users size={17} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Invite Team</div>
          </div>
        </Link>

        <Link href="/teach" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '12px 6px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 6px', color: INK }}>
              <Brain size={17} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Train AI</div>
          </div>
        </Link>

        <button
          onClick={() => {
            if (shareUrl && navigator.share) {
              navigator.share({ title: 'Shop Link', url: shareUrl });
            } else if (shareUrl && navigator.clipboard) {
              navigator.clipboard.writeText(shareUrl).then(() => tgAlert('Shop link copied!'));
            }
          }}
          style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '12px 6px', textAlign: 'center', cursor: 'pointer', fontFamily: BODY,
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 10, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 6px', color: INK }}>
            <Share2 size={17} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Share Link</div>
        </button>
      </div>
    </div>
  );
}

// ─── Today's Activity Metrics Grid ─────────────────────────────────────────────
function TodayActivityMetrics({ feed }) {
  const inbound     = feed?.inbound_today ?? feed?.handled_today ?? 0;
  const handled     = feed?.handled_today ?? 0;
  const orders      = feed?.orders_today ?? 0;
  const revenue     = feed?.revenue_today ? `${Number(feed.revenue_today).toLocaleString()} ETB` : '0 ETB';

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Today's Activity
        </div>
        <Link href="/analytics" style={{ fontSize: 12, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>
          Full Analytics →
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Messages Received</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, color: INK, lineHeight: 1 }}>{inbound}</div>
          <div style={{ fontSize: 11, color: MINT, marginTop: 4 }}>From customer chats</div>
        </div>

        <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>AI Replies Sent</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, color: INK, lineHeight: 1 }}>{handled}</div>
          <div style={{ fontSize: 11, color: MINT, marginTop: 4 }}>Instant automated replies</div>
        </div>

        <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Orders Today</div>
          <div style={{ fontFamily: SERIF, fontSize: 28, color: INK, lineHeight: 1 }}>{orders}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Active order queue</div>
        </div>

        <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Revenue Today</div>
          <div style={{ fontFamily: SERIF, fontSize: 22, color: INK, lineHeight: 1.2 }}>{revenue}</div>
          <div style={{ fontSize: 11, color: GOLD, marginTop: 4 }}>Paid & fulfilled</div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Insight Box ───────────────────────────────────────────────────────────
function AiInsightBox() {
  return (
    <div style={{
      background: 'rgba(176,138,74,.08)', border: '1px solid rgba(176,138,74,.25)',
      borderRadius: 16, padding: '14px 16px', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
        💡 MiniMe AI Insight
      </div>
      <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.45, marginBottom: 10 }}>
        Customers mostly ask about <strong style={{ fontWeight: 600 }}>delivery zones</strong>, <strong style={{ fontWeight: 600 }}>pricing</strong>, and <strong style={{ fontWeight: 600 }}>opening hours</strong> today.
      </div>
      <Link href="/teach" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, fontWeight: 600, color: GOLD, textDecoration: 'none',
      }}>
        Add more delivery details to Teach MiniMe →
      </Link>
    </div>
  );
}

// ─── Setup Progress Banner (shrunken when 100% complete) ─────────────────────
function SetupProgressCard({ business }) {
  if (!business) return null;
  const checks = [
    { label: 'Add a shop photo',        done: !!business.logo_url,       href: '/settings/profile' },
    { label: 'Add your address',        done: !!business.address,        href: '/settings/profile' },
    { label: 'Add your phone number',   done: !!business.owner_phone,    href: '/settings/profile' },
    { label: 'Add your opening hours',  done: !!business.business_hours, href: '/settings/profile' },
    { label: 'Add your Instagram link', done: !!business.instagram,      href: '/settings/profile' },
  ];
  const missing = checks.filter(c => !c.done);

  // If 100% complete — compact quiet banner
  if (missing.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: `1px solid ${LINESF}`,
        borderRadius: 14, padding: '10px 14px', marginBottom: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} color={MINT} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Setup Complete — 100%</span>
        </div>
        <Link href="/settings/profile" style={{ fontSize: 12, color: MUTED, textDecoration: 'none' }}>
          View Profile →
        </Link>
      </div>
    );
  }

  const doneCount = checks.length - missing.length;
  const pct = Math.round((doneCount / checks.length) * 100);
  const next = missing[0];

  return (
    <Link href={next.href} style={{ textDecoration: 'none', display: 'block', marginBottom: 20 }}>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 16, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15 }}>⚡</span>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Shop Setup</div>
          </div>
          <div style={{ fontSize: 13, color: pct >= 80 ? MINT : GOLD, fontWeight: 800 }}>{pct}%</div>
        </div>
        <div style={{ height: 7, background: CREAM2, borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999, transition: 'width .5s ease',
            background: `linear-gradient(90deg, ${GOLD}, ${MINT})`,
          }} />
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
          background: 'rgba(176,138,74,.1)', color: GOLD, borderRadius: 999,
          padding: '5px 11px', fontSize: 12, fontWeight: 600,
        }}>
          Next: {next.label} →
        </div>
      </div>
    </Link>
  );
}

// ─── Manage List ─────────────────────────────────────────────────────────────
function ManageList() {
  const rows = [
    { href: '/products', icon: '📦', label: 'Products & Inventory', sub: 'Add items & update stock' },
    { href: '/customers', icon: '👤', label: 'Customers & Loyalty', sub: 'Client history & tiers' },
    { href: '/broadcast', icon: '📢', label: 'Broadcast', sub: 'Send messages to customers' },
    { href: '/pipeline', icon: '📋', label: 'Sales Pipeline', sub: 'Orders grouped by stage' },
    { href: '/analytics', icon: '📊', label: 'Analytics', sub: 'Business insights & reports' },
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
        Manage Your Shop
      </div>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 18, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <Link key={r.href} href={r.href} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${LINESF}`,
            }}>
              <span style={{ fontSize: 20, width: 24, textAlign: 'center', flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>{r.label}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{r.sub}</div>
              </div>
              <ChevronRight size={16} color="var(--muted)" strokeWidth={1.5} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard Page Component ────────────────────────────────────────────
export default function DashboardPage() {
  const { business, setBusiness, initData } = useTelegram() || {};
  const router = useRouter();

  const [feed, setFeed] = useState(null);
  const [productCount, setProductCount] = useState(null);
  const [paused, setPaused] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('mm_splash_shown');
  });

  const homeCoach = useHomeCoach();

  // Load feed
  useEffect(() => {
    if (!initData) return;
    let off = false;
    async function loadFeed() {
      try {
        const r = await fetch('/api/home/feed', {
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        if (r.ok) {
          const j = await r.json();
          if (!off) setFeed(j);
        }
      } catch {}
    }
    loadFeed();
    const timer = setInterval(loadFeed, 30000);
    return () => { off = true; clearInterval(timer); };
  }, [initData, business?.id]);

  useEffect(() => {
    if (!business?.id) return;
    let off = false;
    (async () => {
      try {
        const { count } = await createClient()
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .eq('is_active', true);
        if (!off) setProductCount(count ?? 0);
      } catch {}
    })();
    return () => { off = true; };
  }, [business?.id]);

  const active = paused !== null ? !paused : !business?.panic_mode;

  async function togglePause() {
    if (!business?.id) return;
    const next = !active;
    setPaused(next);
    try {
      await updateBusiness(initData, { panic_mode: next });
    } catch { setPaused(!next); }
  }

  const _base = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
  const shareUrl = business?.telegram_bot_username
    ? `https://t.me/${business.telegram_bot_username}`
    : business?.shop_code ? `${_base}/shop/${business.shop_code}` : null;
  const shareLabel = business?.telegram_bot_username
    ? `t.me/${business.telegram_bot_username}`
    : business?.shop_code ? `${_base.replace(/^https?:\/\//, '')}/shop/${business.shop_code}` : null;

  const needsReply = feed?.needs_reply?.length || 0;

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      <TopBar
        businessName={business?.name || 'Your Business'}
        ownerName={business?.owner_name}
        active={active}
        onToggle={togglePause}
      />

      <div style={{ padding: '16px 20px 0' }}>
        {/* ── 1. Hero Impact Card ── */}
        <HeroImpactCard feed={feed} active={active} />

        {/* ── 2. Quick Actions Bar ── */}
        <QuickActionsBar shareUrl={shareUrl} shareLabel={shareLabel} />

        {/* ── 3. Today's Activity Metrics ── */}
        <TodayActivityMetrics feed={feed} />

        {/* ── 4. AI Insight Box ── */}
        <AiInsightBox />

        {/* ── 5. Setup Progress Card ── */}
        <SetupProgressCard business={business} />

        {/* ── 6. Manage List ── */}
        <ManageList />

        {/* Beta feedback */}
        <div style={{ marginTop: 36, textAlign: 'center' }}>
          <button
            onClick={() => setShowFeedback(true)}
            style={{
              border: `1px solid ${LINE}`, background: 'var(--card)', color: 'var(--ink-soft)',
              borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: BODY,
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            💬 Share feedback
          </button>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 8, lineHeight: 1.4 }}>
            MiniMe is in active development · Tell us what you think
          </div>
        </div>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      <ReviewSheet open={reviewOpen} drafts={feed?.needs_reply || []} onClose={() => setReviewOpen(false)} />
      <AdvisorSheet
        open={advisorOpen}
        business={business}
        feed={feed}
        onClose={() => setAdvisorOpen(false)}
        onBusinessUpdate={setBusiness}
      />
      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} />
      <HomeCoach open={homeCoach.open} onClose={homeCoach.close} shopName={business?.name} />
    </div>
  );
}
