'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { HowItWorks } from '../ui/HowItWorks';
import { HomeCoach, useHomeCoach } from '../ui/HomeCoach';
import { ReviewSheet } from '../dashboard/ReviewSheet';
import { AdvisorSheet } from '../dashboard/AdvisorSheet';
import { CheckCircle2, ChevronRight, Plus, Users, Brain, Share2, Handshake, MessageSquare, Package, ShoppingCart, BookOpen, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { tgAlert } from '../../lib/utils';
import { FeedbackModal } from '../layout/DashboardShell';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = 'var(--ink)';
const PAPER  = 'var(--paper)';
const CREAM  = 'var(--cream)';
const CREAM2 = 'var(--cream-2)';
const MINT   = 'var(--mint)';
const MINTSF = 'rgba(46,158,126,.12)';
const MUTED  = 'var(--muted)';
const LINE   = 'var(--line)';
const LINESF = 'var(--line-soft)';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

async function shareShopLink(shareUrl) {
  if (!shareUrl) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Shop Link', url: shareUrl });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      tgAlert('Shop link copied!');
    } else {
      tgAlert('Could not share your shop link on this device.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') tgAlert('Could not share your shop link. Please try again.');
  }
}

// ─── Quick Actions Bar ────────────────────────────────────────────────────────
function QuickActionsBar({ shareUrl }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
        Quick Actions
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Link href="/products" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            minHeight: 82, padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
              <Plus size={16} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>+ Product</div>
          </div>
        </Link>

        <Link href="/teach" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            minHeight: 82, padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: CREAM, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: INK }}>
              <Brain size={15} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>Teach MiniMe</div>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => shareShopLink(shareUrl)}
          disabled={!shareUrl}
          style={{
            background: MINTSF, border: `1px solid ${MINT}`, borderRadius: 14,
            minHeight: 82, padding: '10px 4px', textAlign: 'center', cursor: shareUrl ? 'pointer' : 'not-allowed',
            fontFamily: BODY, opacity: shareUrl ? 1 : 0.55,
          }}
        >
          <div style={{ width: 28, height: 28, borderRadius: 8, background: MINTSF, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: MINT }}>
            <Share2 size={15} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>Share Link ↑</div>
        </button>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
        <Link href="/agent/team" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: MUTED, fontSize: 11.5, textDecoration: 'none' }}>
          <Users size={14} /> Invite Team
        </Link>
        <Link href="/b2b" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: MUTED, fontSize: 11.5, textDecoration: 'none' }}>
          <Handshake size={14} /> Partners
        </Link>
      </div>
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
        borderRadius: 14, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} color={MINT} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Shop setup complete</span>
        </div>
        <span style={{ fontSize: 12, color: MINT, fontWeight: 700 }}>100%</span>
      </div>
    );
  }

  const doneCount = checks.length - missing.length;
  const pct = Math.round((doneCount / checks.length) * 100);
  const next = missing[0];

  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Shop Setup
        </div>
        <div style={{ fontSize: 12, color: MINT, fontWeight: 800 }}>{pct}%</div>
      </div>
      <Link href={next.href} style={{ display: 'block', textDecoration: 'none', color: INK }}>
        <div style={{
          background: 'var(--card)', border: `1px solid ${LINESF}`,
          borderRadius: 14, padding: '11px 13px',
        }}>
          <div style={{ height: 5, background: CREAM2, borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 999,
              background: MINT,
            }} />
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>
            Next: <span style={{ color: INK, fontWeight: 600 }}>{next.label}</span> →
          </div>
        </div>
      </Link>
    </section>
  );
}
function WorkspaceSection() {
  const tools = [
    { href: '/products', icon: Package, title: 'Products', description: 'Catalog & availability' },
    { href: '/customers', icon: Users, title: 'Customers', description: 'People behind the chats' },
    { href: '/teach', icon: BookOpen, title: 'Knowledge', description: 'What MiniMe should know' },
    { href: '/settings', icon: SlidersHorizontal, title: 'Settings', description: 'Make it work your way' },
  ];

  return (
    <section style={{ marginTop: 30 }}>
      <h2 style={{
        fontFamily: SERIF, fontSize: 21, fontWeight: 600, letterSpacing: '-0.025em',
        color: INK, margin: '0 0 14px',
      }}>
        Your workspace
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {tools.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href} style={{ color: INK, textDecoration: 'none', minWidth: 0 }}>
            <div style={{
              position: 'relative', minHeight: 118, height: '100%', boxSizing: 'border-box',
              padding: '15px 14px', border: `1px solid ${LINESF}`, borderRadius: 16,
              background: 'var(--card)',
            }}>
              <Icon size={21} strokeWidth={1.8} />
              <ArrowUpRight size={16} color={MUTED} style={{ position: 'absolute', top: 15, right: 14 }} />
              <div style={{ fontSize: 14, fontWeight: 650, marginTop: 14 }}>{title}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.45, color: MUTED, marginTop: 4 }}>
                {description}
              </div>
            </div>
          </Link>
        ))}
      </div>

    </section>
  );
}

function AttentionRow({ href, icon: Icon, title, detail, count }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block', marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 58, padding: '9px 12px',
        background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
          background: MINTSF, color: MINT, flexShrink: 0,
        }}>
          <Icon size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, lineHeight: 1.3 }}>{title}</div>
          <div style={{
            fontSize: 11, color: MUTED, lineHeight: 1.35, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {detail}
          </div>
        </div>
        <span style={{
          minWidth: 26, height: 26, padding: '0 7px', borderRadius: 999, display: 'grid', placeItems: 'center',
          background: MINTSF, color: MINT, fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
          {count}
        </span>
        <ChevronRight size={15} color={MUTED} />
      </div>
    </Link>
  );
}

function NextActions({ feed }) {
  const stockCount = (feed?.out_of_stock_count ?? 0) + (feed?.low_stock_count ?? 0);
  const conversations = feed?.needs_reply ?? [];
  const newOrders = feed?.new_orders_count ?? 0;
  const awaitingPayments = feed?.awaiting_payment_count ?? 0;
  const hasActions = stockCount > 0 || conversations.length > 0 || newOrders > 0 || awaitingPayments > 0;
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Needs Attention
        </div>
        <Link href="/conversations?filter=needs_reply" style={{ color: MINT, fontSize: 11.5, fontWeight: 600, textDecoration: 'none' }}>
          View all →
        </Link>
      </div>
      {feed && stockCount > 0 && (
        <AttentionRow
          href="/products"
          icon={Package}
          title="Update inventory"
          detail={`${stockCount} product${stockCount === 1 ? '' : 's'} need a stock update`}
          count={stockCount}
        />
      )}
      {feed && conversations.slice(0, 3).map(conversation => (
        <AttentionRow
          key={conversation.conversation_id}
          href={`/conversations/${conversation.conversation_id}`}
          icon={MessageSquare}
          title="New customer message"
          detail={`${conversation.client_name}: ${conversation.preview || 'Open conversation'}`}
          count={1}
        />
      ))}
      {feed && conversations.length > 3 && (
        <Link href="/conversations?filter=needs_reply" style={{
          display: 'block', margin: '-2px 0 8px', padding: '2px 0',
          color: MINT, fontSize: 11.5, fontWeight: 600, textDecoration: 'none',
        }}>
          View {conversations.length - 3} more customer conversations →
        </Link>
      )}
      {feed && newOrders > 0 && (
        <AttentionRow
          href="/pipeline"
          icon={Package}
          title="New order"
          detail={`${newOrders} order${newOrders === 1 ? '' : 's'} need processing`}
          count={newOrders}
        />
      )}
      {feed && awaitingPayments > 0 && (
        <AttentionRow
          href="/pipeline"
          icon={ShoppingCart}
          title="Payment awaiting"
          detail={`${awaitingPayments} order${awaitingPayments === 1 ? '' : 's'} awaiting payment`}
          count={awaitingPayments}
        />
      )}
      {feed && !hasActions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', color: MINT, fontSize: 12.5, fontWeight: 600 }}>
          <CheckCircle2 size={17} /> You're all caught up
        </div>
      )}
      {!feed && <div style={{ padding: '8px 2px', color: MUTED, fontSize: 12 }}>Loading alerts…</div>}
    </section>
  );
}



// ─── Main Dashboard Page Component ────────────────────────────────────────────
export default function DashboardPage() {
  const { business, setBusiness, initData } = useTelegram() || {};

  const [feed, setFeed] = useState(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackPromptToken, setFeedbackPromptToken] = useState(null);

  const homeCoach = useHomeCoach();

  // A scheduled outreach feedback prompt (see cron/outreach-rules) deep-links
  // here with ?feedback_prompt=<token> so tapping the Telegram message opens
  // this same modal pre-attributed to what asked for it, instead of a
  // separate feedback surface.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('feedback_prompt');
    if (token) { setFeedbackPromptToken(token); setShowFeedback(true); }
  }, []);

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

  const _base = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
  const shareUrl = business?.telegram_bot_username
    ? `https://t.me/${business.telegram_bot_username}`
    : business?.shop_code ? `${_base}/shop/${business.shop_code}` : null;

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      {/* NO duplicate TopBar here — DashboardShell already provides the sticky top bar! */}

      <div style={{ padding: '16px 20px 0' }}>
        <NextActions feed={feed} />
        <QuickActionsBar shareUrl={shareUrl} />
        <SetupProgressCard business={business} />
        <WorkspaceSection />

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

      {showFeedback && <FeedbackModal promptToken={feedbackPromptToken} onClose={() => { setShowFeedback(false); setFeedbackPromptToken(null); }} />}
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
