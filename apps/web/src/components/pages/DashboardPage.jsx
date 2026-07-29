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
import { Mic, BookOpen, Compass, MessageSquare } from 'lucide-react';
import { tgAlert } from '../../lib/utils';
import { FeedbackModal } from '../layout/DashboardShell';
import { ImportPaths } from './ProductsPage';
import { planStatus } from '../../lib/plan';

// ─── Tokens ──────────────────────────────────────────────────────────────────
// Theme-aware — resolve live from globals.css so the home page follows dark mode.
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
  // Mix in Amharic on alternating days — the app should feel like it's from
  // here, not translated. Deterministic by date so it doesn't flicker.
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
      padding: '14px 22px 12px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: PAPER, borderBottom: `1px solid ${LINE}`,
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: INK, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <MiniMeLogo size={20} color={CREAM} accent={GOLDSF} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED }}>
            {greeting()}{ownerName ? `, ${ownerName}` : ''}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.1, color: INK }}>{businessName}</div>
        </div>
      </div>
      <button
        onClick={onToggle}
        style={{
          border: `1px solid ${LINE}`, background: 'var(--card)',
          padding: '5px 12px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', fontFamily: BODY, fontSize: 12, fontWeight: 600, flexShrink: 0,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: active ? MINT : ERROR,
          boxShadow: active ? `0 0 0 3px rgba(79,163,138,.2)` : 'none',
          animation: active ? 'pulse 2s infinite' : 'none',
        }} />
        <span style={{ color: active ? MINT : ERROR }}>
          {active ? 'Active' : 'Paused'}
        </span>
      </button>
    </div>
  );
}

// ─── Focus card — "Do this next" (or "All caught up") ──────────────────────
// This is the single card the redesign is built around: instead of a stack
// of competing cards, one thing tells the owner what to do right now.
function FocusCard({ needsReply, onReview, onHow }) {
  if (needsReply > 0) {
    return (
      <div className="fade-up" style={{
        background: INK, color: PAPER, borderRadius: 26, padding: '26px 24px',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 16px 40px -18px rgba(14,40,35,.5)',
      }}>
        <div className="grain" />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: GOLDSF }}>
          Do this next
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 29, lineHeight: 1.15, marginTop: 11 }}>
          {needsReply} repl{needsReply === 1 ? 'y is' : 'ies are'} waiting for your <span style={{ fontStyle: 'italic', color: GOLDSF }}>OK</span>.
        </div>
        <div style={{ fontSize: 13.5, color: 'rgba(244,238,225,.6)', marginTop: 11, lineHeight: 1.5 }}>
          MiniMe drafted them in your voice. Review and send in one tap.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={onReview} style={{
            background: PAPER, color: INK, padding: '13px 20px', borderRadius: 999,
            fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7,
            cursor: 'pointer', border: 'none', fontFamily: BODY,
          }}>
            Review replies
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </button>
          <HowItWorksTrigger onClick={onHow} variant="dark" />
        </div>
      </div>
    );
  }
  return (
    <div className="fade-up" style={{
      background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 18, padding: '13px 15px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(79,163,138,.12)', display: 'grid', placeItems: 'center', color: MINT, fontSize: 16, flexShrink: 0 }}>✓</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.2, color: INK }}>All caught up.</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>MiniMe is handling everything else.</div>
      </div>
      <HowItWorksTrigger onClick={onHow} variant="light" />
    </div>
  );
}

// ─── Shop power — the gamified anti-dropoff nudge ──────────────────────────
// Same setup checks as before, but framed as a "power" score owners want to max
// out, with an honest persuasive reason to finish. A fuller shop genuinely does
// answer more questions on its own and surfaces better in MiniMe Market.
function SetupProgressCard({ business }) {
  if (!business) return null;
  const checks = [
    { label: 'Add a shop photo',        done: !!business.logo_url,       href: '/settings/profile' },
    { label: 'Add your address',        done: !!business.address,        href: '/settings/profile' },
    { label: 'Add your phone number',   done: !!business.owner_phone,    href: '/settings/profile' },
    { label: 'Add your opening hours',  done: !!business.business_hours, href: '/settings/profile' },
    { label: 'Add your Instagram link', done: !!business.instagram,      href: '/settings/profile' },
    { label: 'Add 3 sample replies',    done: (business.sample_replies?.length || 0) >= 3, href: '/settings/voice' },
  ];
  const missing = checks.filter(c => !c.done);
  if (missing.length === 0) return null;

  const doneCount = checks.length - missing.length;
  const pct = Math.round((doneCount / checks.length) * 100);
  const next = missing[0];
  // Persuasive, honest line that scales with how far along they are.
  const pitch = pct >= 80
    ? 'Almost there — a complete shop answers more on its own.'
    : pct >= 40
      ? 'A fuller shop replies to more customers without you.'
      : 'Power up your shop so MiniMe can sell while you sleep.';

  return (
    <Link href={next.href} style={{ textDecoration: 'none', display: 'block', marginTop: 14 }}>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 16, padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 15 }}>⚡</span>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Shop power</div>
          </div>
          <div style={{ fontSize: 13, color: pct >= 80 ? MINT : GOLD, fontWeight: 800 }}>{pct}%</div>
        </div>
        <div style={{ height: 7, background: '#EDE6D6', borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999, transition: 'width .5s ease',
            background: `linear-gradient(90deg, ${GOLD}, ${MINT})`,
          }} />
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.45 }}>
          {pitch}
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

// ─── Plan nudge — trial countdown / upgrade prompt ─────────────────────────
// A quiet, closable upsell. Shows when the trial is ending (value moment) or
// once a shop has dropped to Free — never blocks anything, just offers Pro.
function PlanNudge({ business }) {
  const { isPro, onTrial, trialDaysLeft, expired } = planStatus(business);
  // On trial with plenty of time, or already a paying Pro → nothing to nudge.
  if (isPro && (!onTrial || trialDaysLeft > 3)) return null;

  const ending = onTrial && trialDaysLeft <= 3;
  const title = ending
    ? `Your free month ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}`
    : expired ? 'You’re on MiniMe Free' : 'Unlock MiniMe Pro';
  const sub = ending
    ? 'MiniMe keeps answering — but Advisor, Broadcast & Secretary will lock.'
    : expired
      ? 'MiniMe still answers customers. Unlock Advisor, Broadcast & Secretary.'
      : 'Get Advisor, Broadcast, Secretary & unlimited products.';

  return (
    <Link href="/settings/billing" style={{ textDecoration: 'none', display: 'block', marginTop: 14 }}>
      <div style={{
        background: INK, borderRadius: 16, padding: '15px 16px',
        display: 'flex', alignItems: 'center', gap: 13, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 22, flexShrink: 0 }}>⭐</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#F4EEE1' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: 'rgba(244,238,225,.6)', marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
        </div>
        <span style={{
          flexShrink: 0, background: GOLDSF, color: INK, borderRadius: 999,
          padding: '7px 13px', fontSize: 12.5, fontWeight: 700,
        }}>Upgrade</span>
      </div>
    </Link>
  );
}

// ─── Today so far — one calm stat strip ────────────────────────────────────
function TodayStrip({ feed }) {
  const hoursSaved = feed.hours_saved_today != null
    ? (feed.hours_saved_today < 1 ? `${Math.round(feed.hours_saved_today * 60)}m` : `${feed.hours_saved_today}h`)
    : null;
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 13 }}>
        <div style={{ fontFamily: SERIF, fontSize: 21, color: INK }}>Today so far</div>
        <Link href="/analytics" style={{ fontSize: 12, color: GOLD, fontWeight: 600, textDecoration: 'none' }}>
          Full analytics →
        </Link>
      </div>
      <Link href="/analytics" style={{ textDecoration: 'none', display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 20, padding: '18px 4px' }}>
          <Cell n={Number(feed.revenue_today || 0).toLocaleString()} label={feed.revenue_currency || 'ETB'} />
          <Divider />
          <Cell n={feed.orders_today ?? 0} label="orders" />
          <Divider />
          <Cell n={feed.handled_today ?? 0} label="replies sent" />
          {hoursSaved && (<><Divider /><Cell n={hoursSaved} label="saved" /></>)}
        </div>
      </Link>
    </div>
  );
}
function Cell({ n, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: SERIF, fontSize: 22, lineHeight: 1, color: INK }}>{n}</div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>{label}</div>
    </div>
  );
}
function Divider() { return <div style={{ width: 1, background: LINESF }} />; }

// ─── Team Delegation Card — Quick access card on Home Page ───────────────
function TeamDelegationCard() {
  return (
    <Link href="/agent/team" style={{ textDecoration: 'none', display: 'block', marginTop: 24 }}>
      <div style={{
        background: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)',
        borderRadius: 20, padding: '18px 20px', color: '#FFFFFF',
        boxShadow: '0 8px 24px -10px rgba(30, 58, 138, 0.35)',
        position: 'relative', overflow: 'hidden',
        transition: 'transform 0.15s ease',
      }}>
        <div style={{
          position: 'absolute', top: -15, right: -15, width: 90, height: 90,
          borderRadius: '50%', background: 'rgba(255, 255, 255, 0.1)', pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14, background: 'rgba(255, 255, 255, 0.2)',
            display: 'grid', placeItems: 'center', fontSize: 22, flexShrink: 0,
            backdropFilter: 'blur(4px)',
          }}>
            👥
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Team Delegation</div>
              <span style={{
                background: 'rgba(255, 255, 255, 0.25)', borderRadius: 999,
                padding: '2px 8px', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>Active</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.85)', marginTop: 2, lineHeight: 1.4 }}>
              Assign work to your team & let MiniMe follow up
            </div>
          </div>
          <div style={{
            background: '#FFFFFF', color: '#1E3A8A', borderRadius: 999,
            padding: '7px 13px', fontSize: 12, fontWeight: 700, flexShrink: 0,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 4
          }}>
            Open →
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Manage your shop — quiet list, replaces the quick-access grid ─────────
function ManageList() {
  const rows = [
    { href: '/agent/team', icon: '👥', label: 'Team Delegation', sub: 'Assign work & contact your team' },
    { href: '/products', icon: '📦', label: 'Products', sub: 'Add items & update stock' },
    { href: '/customers', icon: '👤', label: 'Customers', sub: 'Clients & loyalty' },
    { href: '/broadcast', icon: '📢', label: 'Broadcast', sub: 'Message customers' },
    { href: '/analytics', icon: '📊', label: 'Analytics', sub: 'Business insights' },
    { href: '/documents', icon: '📁', label: 'Files & Media', sub: 'Upload & send files' },
  ];
  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontFamily: SERIF, fontSize: 21, color: INK, marginBottom: 13 }}>Manage your shop</div>
      <div style={{ background: 'var(--card)', border: `1px solid ${LINESF}`, borderRadius: 20, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <Link key={r.href} href={r.href} style={{ textDecoration: 'none' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '15px 16px',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${LINESF}`,
            }}>
              <span style={{ fontSize: 20, width: 24, textAlign: 'center', flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500, color: INK }}>{r.label}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{r.sub}</div>
              </div>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#C7CEC9" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Advisor card — opens the Advisor sheet ────────────────────────────────
function AdvisorCard({ onOpen }) {
  return (
    <button onClick={onOpen} style={{
      all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', cursor: 'pointer',
    }}>
      <div style={{
        background: CREAM, border: `1px solid ${LINE}`, borderRadius: 16,
        padding: '16px', display: 'flex', gap: 14, alignItems: 'center',
        boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)',
      }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--card)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, color: INK }}>Ask MiniMe anything</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>"Should I run a promo this weekend?"</div>
        </div>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      </div>
    </button>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ kicker, title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
      <div>
        {kicker && <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 2 }}>{kicker}</div>}
        <div style={{ fontFamily: SERIF, fontSize: 20, color: INK }}>{title}</div>
      </div>
      {action}
    </div>
  );
}

// ─── Teach grid ───────────────────────────────────────────────────────────────
const TEACH_CARDS = [
  { href: '/teach?tab=voice',     Icon: Mic,           title: 'Voice',     sub: 'Sample replies' },
  { href: '/teach?tab=knowledge', Icon: BookOpen,      title: 'Knowledge', sub: 'Add a fact or URL' },
  { href: '/teach?tab=rules',     Icon: Compass,       title: 'Rules',     sub: "Do's & don'ts" },
  { href: '/teach?tab=examples',  Icon: MessageSquare, title: 'Examples',  sub: 'Paste an exchange' },
];

function TeachGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {TEACH_CARDS.map(({ href, Icon, title, sub }) => (
        <Link key={href} href={href} style={{ textDecoration: 'none' }}>
          <div style={{
            background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 16,
            padding: 14, display: 'flex', flexDirection: 'column', gap: 18, cursor: 'pointer',
            boxShadow: '0 1px 0 rgba(14,40,35,.04)',
          }}>
            <Icon size={20} color={MUTED} strokeWidth={1.6} />
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 16, color: INK }}>{title}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{sub}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── New-user empty state ─────────────────────────────────────────────────────
// ─── New-user empty state ─────────────────────────────────────────────────────
function EmptyState({ botUsername, shopCode, initData }) {
  const [checklist, setChecklist] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkShared, setLinkShared] = useState(() => {
    try { return localStorage.getItem('minime_link_shared') === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (!initData) return;
    fetch('/api/onboarding/checklist', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) setChecklist(j); })
      .catch(() => {});
  }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the customer-facing link: custom bot > branded shared storefront > null.
  const _webBase = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
  const shareLink = botUsername
    ? `https://t.me/${botUsername}`
    : shopCode
      ? `${_webBase}/shop/${shopCode}`
      : null;
  const shareLinkLabel = botUsername
    ? `t.me/${botUsername}`
    : shopCode
      ? `${_webBase.replace(/^https?:\/\//, '')}/shop/${shopCode}`
      : null;

  function copyLink(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink).then(() => {
      setLinkCopied(true);
      setLinkShared(true);
      try { localStorage.setItem('minime_link_shared', '1'); } catch {}
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {});
  }

  const steps = [
    {
      id: 'products',
      done: checklist?.products === true,
      icon: '📦',
      title: 'Add Your First Product',
      sub: 'Customers ask MiniMe for prices instantly.',
      href: '/products',
      cta: 'Add →',
    },
    {
      id: 'business',
      done: checklist?.taught === true,
      icon: '🏪',
      title: 'Teach MiniMe About Business',
      sub: 'Hours, location, delivery & payment methods.',
      href: '/teach',
      cta: 'Start →',
      doneCta: 'Edit →',
    },
    {
      id: 'share',
      done: linkShared,
      icon: '🔗',
      title: 'Share Customer Link',
      sub: shareLinkLabel
        ? `Put ${shareLinkLabel} in Instagram or WhatsApp bio.`
        : 'Share your link wherever customers find you.',
      href: '#',
      cta: linkCopied ? '✓ Copied!' : 'Copy →',
      doneCta: linkCopied ? '✓ Copied!' : 'Copy →',
      onClick: copyLink,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const firstIncompleteIndex = steps.findIndex(s => !s.done);

  return (
    <div className="fade-up">
      {/* Sleek Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: SERIF, fontSize: 25, color: INK, letterSpacing: '-0.015em', fontWeight: 600 }}>
          You're live. <span style={{ fontStyle: 'italic', color: GOLD }}>Let's set up.</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.45 }}>
          {doneCount === steps.length
            ? 'All 3 completed! Your dashboard is active.'
            : `${doneCount} of ${steps.length} completed — finish setup so MiniMe can handle customers.`}
        </p>
      </div>

      {/* Grouped Apple Settings / Stripe List Container */}
      <div style={{
        background: 'var(--card)', border: `1px solid ${LINE}`,
        borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 4px rgba(14,40,35,0.04)'
      }}>
        {/* Progress Header inside container */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${LINE}`,
          background: 'rgba(0,0,0,0.015)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: INK, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Complete Setup
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: doneCount === steps.length ? MINT : GOLD }}>
              {pct}%
            </div>
          </div>
          <div style={{ height: 6, background: CREAM2, borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%', borderRadius: 999,
              transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              background: `linear-gradient(90deg, ${GOLD}, ${MINT})`,
            }} />
          </div>
        </div>

        {/* Grouped Rows */}
        <div>
          {steps.map((s, i) => {
            const isNext = i === firstIncompleteIndex;
            const isLast = i === steps.length - 1;

            return (
              <Link
                key={s.id}
                href={s.href || '#'}
                onClick={s.onClick}
                target={s.external ? '_blank' : undefined}
                rel={s.external ? 'noopener noreferrer' : undefined}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{
                  padding: '16px 18px',
                  display: 'flex', alignItems: 'center', gap: 14,
                  borderBottom: isLast ? 'none' : `1px solid ${LINE}`,
                  background: isNext ? 'rgba(176,138,74,0.06)' : 'transparent',
                  transition: 'background 0.15s ease',
                  cursor: 'pointer',
                }}>
                  {/* Left Focal Icon — no bulky bounding box, large clean + or ✓ */}
                  <div style={{
                    width: 32, height: 32, flexShrink: 0,
                    display: 'grid', placeItems: 'center',
                    fontSize: s.done ? 20 : isNext ? 26 : 20,
                    color: s.done ? MINT : isNext ? GOLD : MUTED,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}>
                    {s.done ? '✓' : isNext ? '+' : s.icon}
                  </div>

                  {/* Middle Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 14.5, fontWeight: isNext ? 700 : 600,
                        color: s.done ? MINT : INK
                      }}>
                        {s.title}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 12.5, color: s.done ? MUTED : 'var(--ink-soft)',
                      marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {s.sub}
                    </div>
                  </div>

                  {/* Right Action Text CTA */}
                  <div style={{
                    fontSize: 13, fontWeight: 700,
                    color: s.done
                      ? MINT
                      : (linkCopied && s.onClick)
                        ? MINT
                        : GOLD,
                    background: 'transparent',
                    padding: '4px 8px',
                    borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'all 0.2s ease',
                  }}>
                    {s.done ? (s.doneCta || 'Edit →') : s.cta}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 18, lineHeight: 1.5 }}>
        Once customers start messaging, this screen becomes your live dashboard.
      </p>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function Skeleton() {
  const bar = (w, h = 16, mt = 0) => (
    <div style={{ height: h, background: CREAM2, borderRadius: 8, width: w, marginTop: mt, animation: 'pulse 1.5s infinite' }} />
  );
  return (
    <div>
      <div style={{ height: 160, background: INK, borderRadius: 26, marginBottom: 24, opacity: 0.7, animation: 'pulse 1.5s infinite' }} />
      {bar('60%', 12)}
      {bar('100%', 90, 10)}
      {bar('100%', 90, 10)}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { business, setBusiness, telegramUser, loading, initData, setPendingCount } = useTelegram() || {};
  const [feed, setFeed] = useState(null);
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('mm_splash_shown');
  });
  const [paused, setPaused] = useState(null);
  const [showFirstSale, setShowFirstSale] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  // First-run coach tour — plays on the real Home once, right after signup.
  const homeCoach = useHomeCoach();
  // null = still loading; a number once known. Drives the empty-catalog nag —
  // a connected bot with 0 products can't do its one job (quote prices), which
  // is the single biggest activation leak in the funnel.
  const [productCount, setProductCount] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!business || (!business.telegram_bot_username && !business.onboarding_completed)) router.replace('/onboarding');
  }, [loading, business, router]);

  useEffect(() => {
    if (!initData || !business?.id) return;
    let off = false;
    async function loadFeed() {
      try {
        const r = await fetch('/api/home/feed', {
          headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
        });
        if (!r.ok || off) return;
        const j = await r.json();
        if (!off) {
          setFeed(j);
          // Push pending count to nav badge
          setPendingCount?.(j.needs_reply?.length || 0);
          // Show first-sale banner if this is the first payment and hasn't been dismissed
          if (j.first_payment && !sessionStorage.getItem('mm_first_sale_seen')) {
            setShowFirstSale(true);
          }
        }
      } catch {}
    }
    loadFeed();
    // Poll every 30s so new orders/messages appear while the owner is on the dashboard
    const timer = setInterval(loadFeed, 30000);
    return () => { off = true; clearInterval(timer); };
  }, [initData, business?.id]);

  // How many active products this business has. A connected bot with 0 products
  // is the #1 activation leak — it literally can't quote a price. We surface a
  // banner (below) when an ACTIVE shop still has an empty catalog.
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

  // Splash on first session load
  if (showSplash) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(ellipse at center, #14342E 0%, #0A1E1B 80%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: BODY, overflow: 'hidden',
      }}>
        <div className="grain" />
        <div className="mirror-reveal" style={{ marginBottom: 28 }}>
          <MiniMeLogo size={80} color={CREAM} accent={GOLDSF} />
        </div>
        <div className="fade-up delay-2" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontWeight: 300, fontStyle: 'italic', fontSize: 32, color: CREAM, letterSpacing: '-0.015em' }}>minime</div>
          <div className="fade-in delay-3" style={{ marginTop: 8, color: 'rgba(244,238,225,0.5)', letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: 10 }}>
            your business, mirrored
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 90, left: 50, right: 50 }}>
          <SplashProgress onDone={() => {
            sessionStorage.setItem('mm_splash_shown', '1');
            setShowSplash(false);
          }} />
        </div>
      </div>
    );
  }

  const ownerFirst = business?.owner_name?.split(' ')[0] || '';
  const needsReply = feed?.needs_reply?.length || 0;
  const hasActivity = feed && (feed.needs_reply?.length || feed.handled_today > 0 || feed.has_any_messages);

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      <div style={{ padding: '16px 22px 0' }}>
        {/* First-sale celebration banner */}
        {showFirstSale && (
          <div style={{
            background: 'linear-gradient(135deg, #0E2823 0%, #1E4A40 100%)',
            borderRadius: 16, padding: '18px 20px', marginBottom: 16,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: -10, right: -10, fontSize: 60, opacity: 0.15, lineHeight: 1 }}>🎉</div>
            <div style={{ fontSize: 22, marginBottom: 6 }}>🎉</div>
            <div style={{ fontFamily: SERIF, fontSize: 19, color: '#FFFFFF', fontWeight: 400, marginBottom: 4 }}>
              Your first sale!
            </div>
            <div style={{ fontSize: 13, color: 'rgba(251,248,241,0.65)', lineHeight: 1.5, marginBottom: 14 }}>
              Congratulations — you're officially in business. MiniMe is with you every step of the way.
            </div>
            <button onClick={() => {
              sessionStorage.setItem('mm_first_sale_seen', '1');
              setShowFirstSale(false);
            }} style={{
              background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', borderRadius: 8, padding: '7px 14px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
            }}>
              Thanks! 💪
            </button>
          </div>
        )}

        {!feed ? (
          <Skeleton />
        ) : hasActivity ? (
          <div className="fade-up">
            {/* ONE FOCUS — replaces the old hero card + inline draft queue */}
            <FocusCard
              needsReply={needsReply}
              onReview={() => setReviewOpen(true)}
              onHow={() => setHowOpen(true)}
            />

            {/* Setup-progress — the anti-dropoff nudge, right under the focus card */}
            <SetupProgressCard business={business} />

            {/* Plan nudge — trial countdown / upgrade to Pro (self-hides for Pro) */}
            <PlanNudge business={business} />

            {/* Secretary nag — the #1 mode owners actually ask for. */}
            {!business?.telegram_biz_conn_id && (
              <Link href="/settings/modes" style={{ textDecoration: 'none', display: 'block', marginTop: 14 }}>
                <div style={{
                  background: 'rgba(79,163,138,0.06)', border: '1.5px solid rgba(79,163,138,0.28)',
                  borderRadius: 14, padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 13,
                }}>
                  <div style={{ fontSize: 24, lineHeight: 1 }}>🕴️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, marginBottom: 2 }}>
                      Let MiniMe answer from <em>your</em> Telegram too
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
                      People text your name, MiniMe replies as you. Family stays personal — only customers get business answers.
                    </div>
                  </div>
                  <span style={{ fontSize: 15, color: MINT, opacity: 0.85 }}>›</span>
                </div>
              </Link>
            )}

            {/* Empty-catalog nag */}
            {productCount === 0 && (
              <Link href="/products" style={{ textDecoration: 'none', display: 'block', marginTop: 14 }}>
                <div style={{
                  background: '#FCF1EF', border: '1px solid rgba(184,84,80,0.28)',
                  borderRadius: 14, padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 13,
                }}>
                  <div style={{ fontSize: 24, lineHeight: 1 }}>📦</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#8E332F', marginBottom: 2 }}>
                      Your catalog is empty
                    </div>
                    <div style={{ fontSize: 12, color: '#A86763', lineHeight: 1.45 }}>
                      Customers are messaging, but MiniMe can&apos;t quote prices yet. Add a product to start selling.
                    </div>
                  </div>
                  <span style={{ fontSize: 15, color: '#B85450', opacity: 0.8 }}>›</span>
                </div>
              </Link>
            )}

            {/* Channel-connect form — fastest way to fill the catalog, right here on Home */}
            {productCount === 0 && (
              <div style={{ marginTop: 14 }}>
                <ImportPaths business={business} />
              </div>
            )}

            {/* Streaks + achievements ribbon — secondary, quiet */}
            {feed.gamification && (
              <Link href="/achievements" style={{ textDecoration: 'none' }}>
                <div style={{
                  marginTop: 14, padding: '12px 16px', borderRadius: 14,
                  background: feed.gamification.streak_days >= 7
                    ? 'linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)'
                    : '#F4EEE1',
                  color: feed.gamification.streak_days >= 7 ? '#fff' : '#0E2823',
                  border: feed.gamification.streak_days >= 7 ? 'none' : '1px solid #E4DED1',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span style={{ fontSize: 22 }}>🔥</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {feed.gamification.streak_days || 0}-day streak
                      {feed.gamification.achievements_count > 0 && (
                        <span style={{ marginLeft: 8, opacity: 0.85, fontWeight: 400 }}>
                          · {feed.gamification.achievements_count} badge{feed.gamification.achievements_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {feed.gamification.recent_achievements?.length > 0 ? (
                      <div style={{ fontSize: 11, marginTop: 3, opacity: 0.85, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        Latest: {feed.gamification.recent_achievements.slice(0, 3).map(a => a.emoji + ' ' + a.title).join('  ·  ')}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, marginTop: 3, opacity: 0.85 }}>
                        {feed.gamification.streak_days >= 7
                          ? `On fire! Come back tomorrow for day ${(feed.gamification.streak_days || 0) + 1}.`
                          : 'Open MiniMe daily to grow your streak · tap to see badges to unlock'}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 14, opacity: 0.7 }}>›</span>
                </div>
              </Link>
            )}

            {/* Today so far */}
            <TodayStrip feed={feed} />

            {/* Team Delegation Card */}
            <TeamDelegationCard />

            {/* Manage your shop */}
            <ManageList />

            {/* Advisor */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Advisor" title="A second opinion" />
              <AdvisorCard onOpen={() => setAdvisorOpen(true)} />
            </div>

            {/* Share link — custom bot OR shared MiniMe deep link */}
            {(business?.telegram_bot_username || business?.shop_code) && (() => {
              const _base = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').trim().replace(/\/$/, '');
              const shareUrl = business.telegram_bot_username
                ? `https://t.me/${business.telegram_bot_username}`
                : `${_base}/shop/${business.shop_code}`;
              const shareLabel = business.telegram_bot_username
                ? `t.me/${business.telegram_bot_username}`
                : `${_base.replace(/^https?:\/\//, '')}/shop/${business.shop_code}`;
              return (
                <div style={{ marginTop: 20 }}>
                  <SectionLabel kicker="Share" title="Send customers to your bot" />
                  <div style={{
                    marginTop: 10, background: 'var(--card)', border: `1px solid ${LINE}`,
                    borderRadius: 14, padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, color: MUTED, marginBottom: 3 }}>Your customer link</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                        {shareLabel}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (navigator.share) {
                          navigator.share({ title: business.name, text: `Chat with ${business.name} on Telegram`, url: shareUrl });
                        } else if (navigator.clipboard) {
                          navigator.clipboard.writeText(shareUrl).then(() => tgAlert('Link copied!'));
                        }
                      }}
                      style={{
                        border: `1px solid ${LINE}`, background: CREAM, borderRadius: 10,
                        padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        fontFamily: BODY, color: INK, flexShrink: 0,
                      }}
                    >
                      Share
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Teach */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Teach" title="Make me sharper" />
              <TeachGrid />
            </div>
          </div>
        ) : (
          <div className="fade-up">
            <EmptyState botUsername={business?.telegram_bot_username} shopCode={business?.shop_code} initData={initData} />
            <div style={{ marginTop: 32 }}>
              <SectionLabel kicker="Teach" title="Get started" />
              <TeachGrid />
            </div>
          </div>
        )}

        {/* Beta feedback — quiet, static entry at the end of the feed. */}
        {feed && (
          <div className="md:hidden" style={{ marginTop: 36, textAlign: 'center' }}>
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
              We're in beta — tell us what's working, or what's not.
            </div>
          </div>
        )}
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

      {/* First-run coach tour of the REAL Home — distinct from HowItWorks
          (which sells the concept pre-signup). Auto-opens once, replayable. */}
      <HomeCoach open={homeCoach.open} onClose={homeCoach.close} shopName={business?.name} />
      {!homeCoach.open && (
        <ReplayTourPill onClick={homeCoach.start} />
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function SplashProgress({ onDone }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let progress = 0;
    const iv = setInterval(() => {
      progress += Math.random() * 18 + 5;
      if (progress >= 100) { progress = 100; clearInterval(iv); setTimeout(onDone, 300); }
      setP(Math.min(progress, 100));
    }, 120);
    return () => clearInterval(iv);
  }, [onDone]);
  return (
    <>
      <div className="prog"><div className="prog-fill" style={{ width: `${p}%` }} /></div>
      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: 'rgba(244,238,225,0.35)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        {p < 40 ? 'Connecting…' : p < 75 ? 'Loading your business…' : 'Ready'}
      </div>
    </>
  );
}
