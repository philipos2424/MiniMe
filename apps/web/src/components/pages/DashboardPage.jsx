'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { HowItWorks } from '../ui/HowItWorks';
import { HomeCoach, useHomeCoach } from '../ui/HomeCoach';
import { ReviewSheet } from '../dashboard/ReviewSheet';
import { AdvisorSheet } from '../dashboard/AdvisorSheet';
import { WhatsNewCard } from '../dashboard/WhatsNewCard';
import { CheckCircle2, ChevronRight, Plus, Users, Brain, Share2, Handshake, MessageSquare, Package, ShoppingCart } from 'lucide-react';
import { tgAlert } from '../../lib/utils';
import { customerShopLink } from '../../lib/shopLink';
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
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Quick Actions
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: MINT }}>
          1-Tap Shortcuts
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Link href="/products" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            minHeight: 84, padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: '#0E2C24', display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: '#FFFFFF' }}>
              <Plus size={16} strokeWidth={2.4} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>+ Product</div>
            <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>New Item</div>
          </div>
        </Link>

        <Link href="/teach" style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
            minHeight: 84, padding: '10px 4px', textAlign: 'center', cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: 'rgba(245, 158, 11, 0.15)', display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: '#B45309' }}>
              <Brain size={16} strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>Train Bot</div>
            <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>Teach FAQs</div>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => shareShopLink(shareUrl)}
          disabled={!shareUrl}
          style={{
            background: MINTSF, border: `1px solid ${MINT}`, borderRadius: 14,
            minHeight: 84, padding: '10px 4px', textAlign: 'center', cursor: shareUrl ? 'pointer' : 'not-allowed',
            fontFamily: BODY, opacity: shareUrl ? 1 : 0.55,
            boxShadow: '0 2px 8px rgba(46,158,126,0.1)',
          }}
        >
          <div style={{ width: 30, height: 30, borderRadius: 10, background: MINT, display: 'grid', placeItems: 'center', margin: '0 auto 4px', color: '#FFFFFF' }}>
            <Share2 size={15} strokeWidth={2.2} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>Share Link</div>
          <div style={{ fontSize: 9.5, color: MINT, marginTop: 1, fontWeight: 600 }}>Copy Link</div>
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
        borderRadius: 14, padding: '10px 14px', marginBottom: 18,
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
    <section style={{ marginBottom: 18 }}>
      <Link href={next.href} style={{ display: 'block', textDecoration: 'none', color: '#FFFFFF' }}>
        <div style={{
          background: 'linear-gradient(135deg, #0B2A22 0%, #0E362C 60%, #124236 100%)',
          border: '1px solid rgba(197, 155, 39, 0.35)',
          borderRadius: 18,
          padding: '14px 16px',
          boxShadow: '0 8px 24px -4px rgba(11, 42, 34, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Subtle decorative glow */}
          <div style={{
            position: 'absolute', right: -20, bottom: -20, width: 100, height: 100,
            borderRadius: '50%', background: 'rgba(197, 155, 39, 0.12)', filter: 'blur(20px)', pointerEvents: 'none',
          }} />

          {/* Top header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                background: '#F59E0B', color: '#0B2A22', fontSize: 9.5, fontWeight: 800,
                letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6,
              }}>
                ★ Priority Step
              </span>
              <span style={{ fontSize: 11, color: '#A7F3D0', fontWeight: 600 }}>Shop Setup</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#FCD34D', fontWeight: 800, fontSize: 12 }}>
              <span>{pct}%</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>({doneCount}/{checks.length})</span>
            </div>
          </div>

          {/* Action text */}
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#FFFFFF', marginTop: 4, lineHeight: 1.35 }}>
            {next.label}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', marginTop: 2, lineHeight: 1.35 }}>
            Complete your setup so MiniMe can accurately guide customers.
          </div>

          {/* High-visibility glowing progress track */}
          <div style={{ height: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 999, overflow: 'hidden', marginTop: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 999,
              background: 'linear-gradient(90deg, #F59E0B, #FCD34D)',
              boxShadow: '0 0 8px rgba(245, 158, 11, 0.5)',
              transition: 'width 0.4s ease',
            }} />
          </div>

          {/* Primary Action Button */}
          <div style={{
            marginTop: 12, width: '100%', background: '#FFFFFF', color: '#0B2A22',
            borderRadius: 12, padding: '9px 12px', fontSize: 12, fontWeight: 750,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)', boxSizing: 'border-box',
          }}>
            <span>Complete Step Now ({checks.length - doneCount} left)</span>
            <span style={{ fontSize: 14 }}>→</span>
          </div>
        </div>
      </Link>
    </section>
  );
}

// ─── Today's Performance Pulse Component ─────────────────────────────────────
function TodayPulse({ feed }) {
  const handled = feed?.handled_today ?? 0;
  const inbound = feed?.inbound_today ?? 0;
  const orders = feed?.orders_today ?? 0;
  const revenue = feed?.revenue_today ?? 0;
  const currency = feed?.revenue_currency || 'ETB';
  const hoursSaved = feed?.hours_saved_today ?? 0;

  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
        Today's Performance
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <div style={{
          background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: MUTED }}>
            <span>Customer Chats</span>
            {handled > 0 && <span style={{ color: MINT, fontWeight: 700, fontSize: 9.5 }}>AI active</span>}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: INK, marginTop: 4 }}>
            {inbound || handled || 0}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {handled > 0 ? `${handled} auto-replied` : hoursSaved > 0 ? `${hoursSaved}h saved today` : 'Ready to answer'}
          </div>
        </div>

        <div style={{
          background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: MUTED }}>
            <span>Orders Today</span>
            {orders > 0 && <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 9.5 }}>Active</span>}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: INK, marginTop: 4 }}>
            {orders} <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>orders</span>
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {revenue > 0 ? `${currency} ${revenue.toLocaleString()}` : 'Tracking orders'}
          </div>
        </div>
      </div>
    </section>
  );
}

function AttentionRow({ href, icon: Icon, title, detail, count, tone = 'mint' }) {
  const isAmber = tone === 'amber';
  const bg = isAmber ? 'rgba(245, 158, 11, 0.12)' : MINTSF;
  const col = isAmber ? '#B45309' : MINT;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block', marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: 58, padding: '9px 12px',
        background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 14,
        boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
          background: bg, color: col, flexShrink: 0,
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
          background: bg, color: col, fontSize: 12, fontWeight: 700, flexShrink: 0,
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
  const totalCount = (stockCount > 0 ? 1 : 0) + (conversations.length > 0 ? conversations.length : 0) + (newOrders > 0 ? 1 : 0) + (awaitingPayments > 0 ? 1 : 0);

  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED }}>
          Action Queue {totalCount > 0 ? `(${totalCount})` : ''}
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
          tone="amber"
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

  const shareUrl = customerShopLink(business);

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      {/* NO duplicate TopBar here — DashboardShell already provides the sticky top bar! */}

      <div style={{ padding: '14px 16px 0' }}>
        {/* SECTION 1: Priority Setup Task (High-Contrast Milestone) */}
        <SetupProgressCard business={business} />
        {/* SECTION 2: Quick Actions (1-Tap Shortcuts) */}
        <QuickActionsBar shareUrl={shareUrl} />

        {/* SECTION 3: Action Queue (Needs Attention Alerts) */}
        <NextActions feed={feed} />

        {/* SECTION 4: Today's Performance Pulse */}
        <TodayPulse feed={feed} />

        {/* What's New Announcement */}
        <WhatsNewCard business={business} />

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
