'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { updateBusiness } from '../../lib/updateBusiness';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { HowItWorks } from '../ui/HowItWorks';
import { HomeCoach, ReplayTourPill, useHomeCoach } from '../ui/HomeCoach';
import { ReviewSheet } from '../dashboard/ReviewSheet';
import { AdvisorSheet } from '../dashboard/AdvisorSheet';
import { Plus, Users, Brain, Share2, Sparkles, CheckCircle2, ChevronRight } from 'lucide-react';
import { tgAlert } from '../../lib/utils';
import { FeedbackModal } from '../layout/DashboardShell';

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

// ─── Hero Impact Card — "What MiniMe did for your business" ──────────────────
function HeroImpactCard({ feed, active }) {
  const handled = feed?.handled_today ?? 0;
  const hoursSaved = feed?.hours_saved_today != null
    ? (feed.hours_saved_today < 1 ? `${Math.round(feed.hours_saved_today * 60)}m` : `${feed.hours_saved_today}h`)
    : '0m';

  return (
    <div style={{
      background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 20, padding: '18px 18px',
      position: 'relative', overflow: 'hidden',
      boxShadow: 'var(--shadow-1)', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: GOLD }}>
          <Sparkles size={13} color={GOLD} />
          MiniMe AI Impact
        </div>
        <div style={{
          background: 'rgba(79,163,138,0.15)', borderRadius: 999,
          padding: '2px 9px', fontSize: 10.5, color: MINT, fontWeight: 600,
        }}>
          {active ? '🟢 Live' : '⏸ Paused'}
        </div>
      </div>

      <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1.25, color: INK, marginBottom: 6 }}>
        MiniMe handled <span style={{ color: GOLD, fontStyle: 'italic', fontWeight: 600 }}>{handled} customer question{handled === 1 ? '' : 's'}</span> today.
      </div>

      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.4 }}>
        Saved you <strong style={{ color: INK, fontWeight: 600 }}>{hoursSaved}</strong> of typing — answering prices, hours & product details.
      </div>
    </div>
  );
}

// ─── Quick Actions Bar ────────────────────────────────────────────────────────
function QuickActionsBar({ shareUrl }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
        Quick Actions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <Link href="/products" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
              <Plus size={16} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>+ Product</div>
          </div>
        </Link>

        <Link href="/agent/team" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
              <Users size={15} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Invite Team</div>
          </div>
        </Link>

        <Link href="/teach" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
              <Brain size={15} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Train AI</div>
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
            padding: '10px 4px', textAlign: 'center', cursor: 'pointer', fontFamily: BODY,
          }}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
            <Share2 size={15} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Share Link</div>
        </button>
      </div>
    </div>
  );
}

// ─── Compact Today's Activity Metrics Bar (1-row horizontal layout) ───────────
function TodayActivityMetrics({ feed }) {
  const inbound     = feed?.inbound_today ?? feed?.handled_today ?? 0;
  const handled     = feed?.handled_today ?? 0;
  const orders      = feed?.orders_today ?? 0;
  const revenue     = feed?.revenue_today ? `${Number(feed.revenue_today).toLocaleString()} ETB` : '0 ETB';

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Today's Activity
        </div>
        <Link href="/analytics" style={{ fontSize: 11.5, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>
          Full Analytics →
        </Link>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
        background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, padding: '12px 4px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, color: INK, lineHeight: 1.1 }}>{inbound}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>Messages</div>
        </div>

        <div style={{ textAlign: 'center', borderLeft: `1px solid ${LINESF}` }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, color: INK, lineHeight: 1.1 }}>{handled}</div>
          <div style={{ fontSize: 10, color: MINT, marginTop: 4 }}>AI Replies</div>
        </div>

        <div style={{ textAlign: 'center', borderLeft: `1px solid ${LINESF}` }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, color: INK, lineHeight: 1.1 }}>{orders}</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>Orders</div>
        </div>

        <div style={{ textAlign: 'center', borderLeft: `1px solid ${LINESF}` }}>
          <div style={{ fontFamily: SERIF, fontSize: 15, color: INK, lineHeight: 1.2, fontWeight: 600 }}>{revenue}</div>
          <div style={{ fontSize: 10, color: GOLD, marginTop: 4 }}>Revenue</div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Insight Box (rendered ONLY when there is activity) ─────────────────────
function AiInsightBox({ feed }) {
  if (!feed || (!feed.handled_today && !feed.has_any_messages)) return null;

  return (
    <div style={{
      background: 'rgba(176,138,74,.08)', border: '1px solid rgba(176,138,74,.25)',
      borderRadius: 16, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
        💡 MiniMe AI Insight
      </div>
      <div style={{ fontSize: 13, color: INK, lineHeight: 1.45, marginBottom: 8 }}>
        Customers mostly ask about <strong style={{ fontWeight: 600 }}>delivery zones</strong>, <strong style={{ fontWeight: 600 }}>pricing</strong>, and <strong style={{ fontWeight: 600 }}>opening hours</strong>.
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

// ─── Setup Progress Banner ───────────────────────────────────────────────────
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

  if (missing.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: `1px solid ${LINESF}`,
        borderRadius: 14, padding: '10px 14px', marginBottom: 16,
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
    <Link href={next.href} style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}>
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
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
        Manage Your Shop
      </div>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 16, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <Link key={r.href} href={r.href} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${LINESF}`,
            }}>
              <span style={{ fontSize: 19, width: 22, textAlign: 'center', flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: INK }}>{r.label}</div>
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

  const _base = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
  const shareUrl = business?.telegram_bot_username
    ? `https://t.me/${business.telegram_bot_username}`
    : business?.shop_code ? `${_base}/shop/${business.shop_code}` : null;

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      {/* NO duplicate TopBar here — DashboardShell already provides the sticky top bar! */}

      <div style={{ padding: '16px 20px 0' }}>
        {/* ── 1. Hero Impact Card ── */}
        <HeroImpactCard feed={feed} active={active} />

        {/* ── 2. Quick Actions Bar ── */}
        <QuickActionsBar shareUrl={shareUrl} />

        {/* ── 3. Compact Today's Activity Metrics Bar (1-row horizontal layout) ── */}
        <TodayActivityMetrics feed={feed} />

        {/* ── 4. AI Insight Box (only rendered when there is activity) ── */}
        <AiInsightBox feed={feed} />

        {/* ── 5. Setup Progress Card ── */}
        <SetupProgressCard business={business} />

        {/* ── 6. Manage List ── */}
        <ManageList />

        {/* Beta feedback */}
        <div style={{ marginTop: 32, textAlign: 'center' }}>
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
