'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { isAmharic } from '../../lib/design-tokens';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { Mic, BookOpen, Compass, MessageSquare } from 'lucide-react';
import { TelegramIcon, WhatsAppIcon, InstagramIcon, FacebookIcon, PLATFORM_COLORS } from '../ui/PlatformIcon';
import { tgAlert } from '../../lib/utils';
import { FeedbackModal } from '../layout/DashboardShell';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const GOLDSF = '#D4B987';
const MINT   = '#4FA38A';
const MUTED  = '#8A9590';
const LINE   = '#E4DED1';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const AMH    = "'Noto Sans Ethiopic', 'Geist', sans-serif";

function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 14) return 'Good afternoon';
  if (h < 18) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good evening';
}

function getDailyGreeting(ownerFirst, feed) {
  const h = new Date().getHours();
  const needsReply = feed?.needs_reply?.length || 0;
  const revenue = feed?.revenue_today || 0;

  if (h < 9 && needsReply > 0) return `Rise and shine! ${needsReply} message${needsReply > 1 ? 's' : ''} came in overnight.`;
  if (revenue > 0) return `${revenue.toLocaleString()} ETB earned today so far. Keep going! 💪`;
  if (needsReply > 0) return `${needsReply} customer${needsReply > 1 ? 's' : ''} need${needsReply === 1 ? 's' : ''} your attention.`;
  if (h < 11) return 'MiniMe is on duty. Your customers are in good hands.';
  if (h < 17) return 'Quiet right now — good time to add products or teach MiniMe.';
  return 'Business never sleeps — MiniMe\'s got the night shift covered.';
}

// ─── TopBar ──────────────────────────────────────────────────────────────────
function TopBar({ businessName, ownerName, active, onToggle, dailyGreeting }) {
  return (
    <div style={{
      padding: '14px 22px 10px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: PAPER, borderBottom: `1px solid ${LINE}`,
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <MiniMeLogo size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED }}>
            {greeting()}{ownerName ? `, ${ownerName}` : ''}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.1, color: INK }}>{businessName}</div>
          {dailyGreeting && (
            <div style={{ fontSize: 11.5, color: '#4A5E5A', marginTop: 3, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dailyGreeting}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onToggle}
        style={{
          border: `1px solid ${LINE}`, background: '#fff',
          padding: '6px 10px 6px 8px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', fontFamily: BODY, fontSize: 12.5,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: active ? MINT : ERROR,
          boxShadow: active ? `0 0 0 3px rgba(79,163,138,.2)` : 'none',
          animation: active ? 'pulse 2s infinite' : 'none',
        }} />
        <span style={{ color: active ? MINT : ERROR, fontWeight: 500 }}>
          {active ? 'Active' : 'Paused'}
        </span>
      </button>
    </div>
  );
}

// ─── Hero dark card ───────────────────────────────────────────────────────────
function HeroCard({ needsReply, stats, helpfulPct }) {
  return (
    <div style={{
      background: INK, color: PAPER, borderRadius: 22, padding: 22,
      position: 'relative', overflow: 'hidden',
      boxShadow: '0 10px 30px -10px rgba(14,40,35,.25)',
    }}>
      <div className="grain" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLDSF }}>
            {needsReply > 0 ? `${needsReply} need you` : 'All clear'}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: PAPER, marginTop: 6, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
            {needsReply > 0 ? (
              <>You have <span style={{ fontStyle: 'italic', color: GOLDSF }}>{needsReply} draft{needsReply !== 1 ? 's' : ''}</span><br />waiting to send.</>
            ) : (
              <>All clear.<br /><span style={{ fontStyle: 'italic', color: GOLDSF }}>MiniMe has it covered.</span></>
            )}
          </div>
        </div>
        <MiniMeLogo size={32} color={CREAM} accent={GOLDSF} />
      </div>

      <div style={{ marginTop: 18 }}>
        {needsReply > 0 ? (
          <Link href="/conversations" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: PAPER, color: INK, padding: '11px 18px', borderRadius: 999,
            textDecoration: 'none', fontSize: 14, fontWeight: 500, fontFamily: BODY,
          }}>
            Review drafts
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </Link>
        ) : (
          <Link href="/advisor" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: PAPER, color: INK, padding: '11px 18px', borderRadius: 999,
            textDecoration: 'none', fontSize: 14, fontWeight: 500, fontFamily: BODY,
          }}>
            Ask the Advisor
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4"/></svg>
          </Link>
        )}
      </div>

      {/* Stats strip — each tile links to its detail view */}
      <div style={{
        display: 'flex', gap: 18, marginTop: 22, paddingTop: 16,
        borderTop: '1px solid rgba(244,238,225,0.12)',
      }}>
        <MiniStat n={stats.chatsToday} label="replied today" href="/conversations" />
        <MiniStat n={stats.ordersToday} label="orders" href="/orders?period=today" />
        <MiniStat n={stats.hoursSaved} label="hours saved" href="/settings/hours" />
        {stats.avgResp != null
          ? <MiniStat n={stats.avgResp} label="avg reply" href="/analytics" />
          : stats.fastPct != null
            ? <MiniStat n={`${stats.fastPct}%`} label="instant replies" href="/analytics" />
            : helpfulPct !== null
              ? <MiniStat n={`${helpfulPct}%`} label="helpful" href="/analytics" />
              : null
        }
      </div>
    </div>
  );
}

function MiniStat({ n, label, href }) {
  const content = (
    <>
      <div style={{ fontFamily: SERIF, fontSize: 22, color: PAPER, lineHeight: 1 }}>{n ?? '—'}</div>
      <div style={{ fontSize: 10.5, color: 'rgba(244,238,225,0.55)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
    </>
  );
  if (!href) return <div style={{ flex: 1 }}>{content}</div>;
  return (
    <Link href={href} style={{ flex: 1, textDecoration: 'none', display: 'block', cursor: 'pointer' }}>
      {content}
    </Link>
  );
}

// ─── Draft queue with local dismiss state ────────────────────────────────────
function DraftQueue({ drafts }) {
  const { initData } = useTelegram() || {};
  const [dismissed, setDismissed] = useState([]);
  const [approvingAll, setApprovingAll] = useState(false);
  const visible = drafts.filter(d => !dismissed.includes(d.conversation_id)).slice(0, 5);
  const total = drafts.length;
  const remaining = total - dismissed.length;
  if (visible.length === 0) return null;

  async function approveAll() {
    if (approvingAll || !initData) return;
    setApprovingAll(true);
    const draftIds = visible.filter(m => m.draft_id).map(m => m.draft_id);
    await Promise.all(draftIds.map(id =>
      fetch(`/api/messages/${id}/approve`, {
        method: 'POST', headers: { 'x-telegram-init-data': initData },
      }).catch(() => {})
    ));
    setDismissed(prev => [...prev, ...visible.map(m => m.conversation_id)]);
    setApprovingAll(false);
  }

  const hasDraftIds = visible.some(m => m.draft_id);

  return (
    <div style={{ marginTop: 28 }}>
      <SectionLabel
        kicker="Inbox"
        title={`${remaining} draft${remaining !== 1 ? 's' : ''} ready`}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {hasDraftIds && visible.length > 1 && (
              <button
                onClick={approveAll}
                disabled={approvingAll}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 999,
                  background: INK, color: PAPER, border: 'none',
                  fontFamily: BODY, fontWeight: 600, cursor: approvingAll ? 'default' : 'pointer',
                  opacity: approvingAll ? 0.7 : 1,
                }}
              >
                {approvingAll ? 'Sending…' : `✓ Send all ${visible.length}`}
              </button>
            )}
            <Link href="/conversations" style={{ textDecoration: 'none', fontSize: 13, color: '#4A5E5A', fontWeight: 500 }}>See all</Link>
          </div>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((m, i) => (
          <div key={m.conversation_id} className="fade-up" style={{ animationDelay: `${0.05 * i}s` }}>
            <DraftCard m={m} onAction={convId => setDismissed(prev => [...prev, convId])} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Draft cards with inline approve/skip ────────────────────────────────────
function DraftCard({ m, onAction }) {
  const { initData } = useTelegram() || {};
  const isAmh = isAmharic(m.preview);
  const [state, setState] = useState('idle'); // 'idle'|'approving'|'skipping'|'done'

  async function approve(e) {
    e.preventDefault(); e.stopPropagation();
    if (!m.draft_id || !initData || state !== 'idle') return;
    setState('approving');
    try {
      await fetch(`/api/messages/${m.draft_id}/approve`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      setState('done');
      setTimeout(() => onAction?.(m.conversation_id), 600);
    } catch { setState('idle'); }
  }

  async function skip(e) {
    e.preventDefault(); e.stopPropagation();
    if (!m.draft_id || !initData || state !== 'idle') return;
    setState('skipping');
    try {
      await fetch(`/api/messages/${m.draft_id}/skip`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      setState('done');
      setTimeout(() => onAction?.(m.conversation_id), 400);
    } catch { setState('idle'); }
  }

  if (state === 'done') return null;

  return (
    <Link href={`/conversations/${m.conversation_id}?focusDraft=1`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
        padding: 14, boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)',
        opacity: state !== 'idle' ? 0.6 : 1, transition: 'opacity .2s',
      }}>
        {/* Top row */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Avatar name={m.client_name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.client_name}</div>
                <span style={{ background: 'rgba(176,138,74,.12)', color: GOLD, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 500, flexShrink: 0 }}>draft</span>
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, flexShrink: 0 }}>{m.time_ago}</div>
            </div>
            {/* Customer message preview */}
            <div style={{ marginTop: 4, fontSize: 13, color: '#4A5E5A', fontFamily: isAmh ? AMH : BODY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.preview}
            </div>
          </div>
        </div>

        {/* MiniMe's draft reply */}
        {m.draft_preview && (
          <div style={{
            margin: '10px 0 0 56px', padding: '10px 12px', background: CREAM, borderRadius: 12,
            fontSize: 13, color: INK, lineHeight: 1.45,
          }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: GOLD, letterSpacing: '0.1em', marginBottom: 4 }}>MINIME'S DRAFT</div>
            {m.draft_preview}
          </div>
        )}

        {/* Quick action buttons */}
        {m.draft_id && (
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 0 56px' }} onClick={e => e.preventDefault()}>
            <button onClick={approve} disabled={state !== 'idle'} style={{
              flex: 2, padding: '9px', borderRadius: 10, border: 'none',
              background: MINT, color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: state !== 'idle' ? 'default' : 'pointer', fontFamily: BODY,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              {state === 'approving' ? '…' : '✓ Send'}
            </button>
            <button onClick={skip} disabled={state !== 'idle'} style={{
              flex: 1, padding: '9px', borderRadius: 10,
              border: `1px solid ${LINE}`, background: '#fff', color: MUTED,
              fontSize: 13, cursor: state !== 'idle' ? 'default' : 'pointer', fontFamily: BODY,
            }}>
              {state === 'skipping' ? '…' : 'Skip'}
            </button>
            <Link href={`/conversations/${m.conversation_id}?focusDraft=1`} onClick={e => e.stopPropagation()} style={{
              flex: 1, padding: '9px', borderRadius: 10, border: `1px solid ${LINE}`,
              background: '#fff', color: INK, fontSize: 13, fontWeight: 500,
              textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              Edit
            </Link>
          </div>
        )}
      </div>
    </Link>
  );
}

function Avatar({ name = '?' }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%', background: CREAM2,
      display: 'grid', placeItems: 'center',
      fontFamily: SERIF, fontSize: 18, color: INK, flexShrink: 0,
    }}>{letter}</div>
  );
}

// ─── Advisor card ─────────────────────────────────────────────────────────────
function AdvisorCard() {
  return (
    <Link href="/advisor" style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        background: CREAM, border: `1px solid ${LINE}`, borderRadius: 16,
        padding: '16px', display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer',
        boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: '#fff',
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, color: INK }}>Ask MiniMe anything</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>"Should I run a promo this weekend?"</div>
        </div>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6"/>
        </svg>
      </div>
    </Link>
  );
}

// ─── Channels strip ───────────────────────────────────────────────────────────
function ChannelsStrip({ channels }) {
  const items = [
    { id: 'telegram',  Icon: TelegramIcon,  label: 'Telegram',  connected: !!channels.telegram },
    { id: 'whatsapp',  Icon: WhatsAppIcon,  label: 'WhatsApp',  connected: !!channels.whatsapp },
    { id: 'instagram', Icon: InstagramIcon, label: 'Instagram', connected: !!channels.instagram },
    { id: 'facebook',  Icon: FacebookIcon,  label: 'Facebook',  connected: !!channels.facebook },
  ];
  const connectedCount = items.filter(i => i.connected).length;
  return (
    <Link href="/settings/channels" style={{ textDecoration: 'none', display: 'block', marginTop: 16 }}>
      <div style={{
        background: '#fff', border: '1px solid #E4DED1', borderRadius: 14,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#8A9590', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
            Channels · {connectedCount} connected
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
            {items.map(({ id, Icon, label, connected }) => (
              <div key={id} title={`${label}: ${connected ? 'connected' : 'not connected'}`} style={{
                width: 32, height: 32, borderRadius: 10,
                background: connected ? PLATFORM_COLORS[id] + '15' : '#F4EEE1',
                display: 'grid', placeItems: 'center',
                opacity: connected ? 1 : 0.45,
              }}>
                <Icon size={18} color={connected ? PLATFORM_COLORS[id] : '#8A9590'} />
              </div>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 16, color: '#8A9590' }}>›</span>
      </div>
    </Link>
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
            background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
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
  // Shared mode points at our /shop/<code> page (not the raw t.me link) so the
  // owner's business — not "MiniMe" — shows up in link previews when they paste
  // it into Instagram / WhatsApp / Facebook.
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
      done: checklist?.products === true,
      icon: '📦',
      title: 'Add your products & prices',
      sub: 'MiniMe will quote exact prices to every customer.',
      href: '/products',
      cta: 'Add products',
    },
    {
      done: checklist?.taught === true,
      icon: '🧠',
      title: 'Teach MiniMe about your business',
      sub: 'Tell it your hours, location, delivery zones, and payment methods.',
      href: '/teach',
      cta: 'Start teaching',
    },
    {
      done: linkShared,
      icon: '📣',
      title: 'Share your link with customers',
      sub: shareLinkLabel
        ? `Put ${shareLinkLabel} in your Instagram bio, WhatsApp status, or Facebook page.`
        : 'Share your customer link wherever customers can find you.',
      href: '#',
      cta: linkCopied ? '✓ Copied!' : 'Copy link',
      onClick: copyLink,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: SERIF, fontSize: 24, color: INK, letterSpacing: '-0.015em' }}>
          You're live. <span style={{ fontStyle: 'italic', color: GOLD }}>Let's set up.</span>
        </div>
        <p style={{ fontSize: 14, color: '#4A5E5A', marginTop: 6, lineHeight: 1.5 }}>
          {doneCount === 0
            ? '3 quick steps and MiniMe is ready to handle customers.'
            : doneCount === 1
              ? '1 of 3 done — keep going!'
              : doneCount === 2
                ? '2 of 3 done — almost there!'
                : 'All set up! Your dashboard will light up when customers start messaging.'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => (
          <Link
            key={i}
            href={s.href || '#'}
            onClick={s.onClick}
            target={s.external ? '_blank' : undefined}
            rel={s.external ? 'noopener noreferrer' : undefined}
            style={{ textDecoration: 'none' }}
          >
            <div style={{
              background: s.done ? 'rgba(79,163,138,0.04)' : '#fff',
              border: `1px solid ${s.done ? 'rgba(79,163,138,0.25)' : LINE}`,
              borderRadius: 14,
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
              boxShadow: '0 1px 0 rgba(14,40,35,.04)',
              opacity: s.done ? 0.8 : 1,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: s.done ? 'rgba(79,163,138,0.12)' : CREAM,
                display: 'grid', placeItems: 'center', fontSize: 20,
              }}>
                {s.done ? '✓' : s.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: s.done ? MINT : INK, textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: '#4A5E5A', marginTop: 2, lineHeight: 1.4 }}>{s.sub}</div>
              </div>
              {!s.done && (
                <div style={{
                  fontSize: 12, fontWeight: 600, color: linkCopied && s.onClick ? MINT : GOLD,
                  background: linkCopied && s.onClick ? 'rgba(79,163,138,0.1)' : 'rgba(176,138,74,0.1)',
                  padding: '5px 10px',
                  borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'all 0.2s',
                }}>{s.cta} {!s.onClick && '→'}</div>
              )}
            </div>
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
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
      <div style={{ height: 160, background: INK, borderRadius: 22, marginBottom: 24, opacity: 0.7, animation: 'pulse 1.5s infinite' }} />
      {bar('60%', 12)}
      {bar('100%', 90, 10)}
      {bar('100%', 90, 10)}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { business, telegramUser, loading, initData, setPendingCount } = useTelegram() || {};
  const [feed, setFeed] = useState(null);
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('mm_splash_shown');
  });
  const [paused, setPaused] = useState(null);
  const [showFirstSale, setShowFirstSale] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
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
      await createClient().from('businesses').update({ panic_mode: next }).eq('id', business.id);
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
  const avgResp = feed?.avg_response_min != null
    ? (feed.avg_response_min < 1 ? `${Math.round(feed.avg_response_min * 60)}s` : `${feed.avg_response_min}m`)
    : null;

  // Fast-path adoption rate (% of replies handled without the full brain)
  const fastTotal = (feed?.fast_path_count || 0) + (feed?.brain_count || 0);
  const fastPct = fastTotal > 5 ? Math.round((feed.fast_path_count / fastTotal) * 100) : null;

  const stats = {
    chatsToday: feed?.handled_today ?? '—',
    ordersToday: feed?.orders_today ?? '—',
    hoursSaved: feed?.hours_saved_today != null
      ? (feed.hours_saved_today < 1 ? `${Math.round(feed.hours_saved_today * 60)}m` : `${feed.hours_saved_today}h`)
      : '—',
    helpfulPct: feed?.helpful_pct ?? null,
    avgResp,
    fastPct,
  };

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      <TopBar
        businessName={business?.name || 'Your shop'}
        ownerName={ownerFirst}
        active={active}
        onToggle={togglePause}
        dailyGreeting={feed ? getDailyGreeting(ownerFirst, feed) : null}
      />

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
            <div style={{ fontFamily: SERIF, fontSize: 19, color: '#FBF8F1', fontWeight: 400, marginBottom: 4 }}>
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
        ) : feed.needs_reply?.length || feed.handled_today > 0 || feed.has_any_messages ? (
          <div className="fade-up">
            <HeroCard needsReply={needsReply} stats={stats} helpfulPct={stats.helpfulPct} />

            {/* Empty-catalog nag — only for ACTIVE shops (getting messages) that
                still have no products. This bot can't quote a single price until
                the owner adds one, so it's the highest-leverage thing to fix. */}
            {productCount === 0 && (
              <Link href="/products" style={{ textDecoration: 'none', display: 'block', marginTop: 16 }}>
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

            {/* Streaks + achievements ribbon */}
            {feed.gamification && (
              <Link href="/achievements" style={{ textDecoration: 'none' }}>
                <div style={{
                  marginTop: 16, padding: '12px 16px', borderRadius: 14,
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
                          · {feed.gamification.achievements_count} achievement{feed.gamification.achievements_count === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {feed.gamification.recent_achievements?.length > 0 && (
                      <div style={{ fontSize: 11, marginTop: 3, opacity: 0.85, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        Latest: {feed.gamification.recent_achievements.slice(0, 3).map(a => a.emoji + ' ' + a.title).join('  ·  ')}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 14, opacity: 0.7 }}>›</span>
                </div>
              </Link>
            )}

            {/* Draft queue */}
            {feed.needs_reply?.length > 0 && (
              <DraftQueue drafts={feed.needs_reply} />
            )}

            {/* Revenue today */}
            {(feed.revenue_today > 0 || feed.orders_today > 0) && (
              <Link href="/orders" style={{ textDecoration: 'none', display: 'block', marginTop: 20 }}>
                <div style={{
                  background: 'linear-gradient(135deg, #0E2823 0%, #1A3C35 100%)',
                  borderRadius: 16, padding: '16px 18px',
                  display: 'flex', alignItems: 'center', gap: 14,
                  boxShadow: '0 8px 24px -12px rgba(14,40,35,.35)',
                }}>
                  <div style={{ fontSize: 28 }}>💰</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(244,238,225,0.55)', marginBottom: 4 }}>
                      Revenue today
                    </div>
                    <div style={{ fontFamily: SERIF, fontSize: 24, color: CREAM, letterSpacing: '-0.01em', lineHeight: 1 }}>
                      {Number(feed.revenue_today || 0).toLocaleString()} <span style={{ fontSize: 14, opacity: 0.7 }}>{feed.revenue_currency || 'ETB'}</span>
                    </div>
                    {feed.orders_today > 0 && (
                      <div style={{ fontSize: 12, color: 'rgba(244,238,225,0.55)', marginTop: 4 }}>
                        {feed.orders_today} paid order{feed.orders_today !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(244,238,225,0.4)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6"/>
                  </svg>
                </div>
              </Link>
            )}

            {/* Stock alerts */}
            {((feed.out_of_stock_count || 0) + (feed.low_stock_count || 0)) > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  background: feed.out_of_stock_count > 0 ? 'rgba(184,84,80,0.06)' : 'rgba(176,138,74,0.06)',
                  border: `1px solid ${feed.out_of_stock_count > 0 ? 'rgba(184,84,80,0.2)' : 'rgba(176,138,74,0.2)'}`,
                  borderRadius: 14, padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>{feed.out_of_stock_count > 0 ? '🚨' : '⚠️'}</span>
                    <div style={{ fontSize: 13, fontWeight: 600, color: feed.out_of_stock_count > 0 ? '#B85450' : '#8B6A2A', flex: 1 }}>
                      {feed.out_of_stock_count > 0
                        ? `${feed.out_of_stock_count} item${feed.out_of_stock_count > 1 ? 's' : ''} out of stock`
                        : `${feed.low_stock_count} item${feed.low_stock_count > 1 ? 's' : ''} running low`}
                    </div>
                  </div>
                  {feed.stock_alert_names?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {feed.stock_alert_names.map(name => (
                        <span key={name} style={{
                          fontSize: 11.5, padding: '3px 9px', borderRadius: 999,
                          background: '#fff', border: `1px solid ${LINE}`, color: INK, fontWeight: 500,
                        }}>{name}</span>
                      ))}
                    </div>
                  )}
                  <Link href="/products" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600,
                    color: feed.out_of_stock_count > 0 ? '#B85450' : GOLD,
                    textDecoration: 'none',
                  }}>
                    Update stock in Products →
                  </Link>
                </div>
              </div>
            )}

            {/* Business completeness nudge */}
            <ProfileCompletenessCard business={business} />

            {/* Quick access grid — mobile shortcuts to less-visible pages */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Manage" title="Quick access" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                {[
                  { href: '/products',     icon: '📦',  label: 'Products',       sub: 'Add items & update stock' },
                  { href: '/customers',    icon: '👥',  label: 'Customers',      sub: 'Clients & loyalty' },
                  { href: '/broadcast',    icon: '📢',  label: 'Broadcast',      sub: 'Message customers' },
                  { href: '/analytics',    icon: '📊',  label: 'Analytics',      sub: 'Business insights' },
                  { href: '/documents',    icon: '🖼️',  label: 'Files & Media',  sub: 'Upload & send files' },
                ].map(({ href, icon, label, sub }) => (
                  <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                    <div style={{
                      background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
                      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{label}</div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{sub}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Advisor */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Advisor" title="A second opinion" />
              <AdvisorCard />
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
                <div style={{ marginTop: 28 }}>
                  <SectionLabel kicker="Share" title="Send customers to your bot" />
                  <div style={{
                    marginTop: 10, background: '#fff', border: `1px solid ${LINE}`,
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

        {/* Beta feedback — quiet, static entry at the end of the feed. Never
            floats over the bottom nav. Mobile only; desktop has the FAB in
            DashboardShell. Opens the shared FeedbackModal (NPS + category +
            note → /api/platform/feedback, which also pings the admin). */}
        {feed && (
          <div className="md:hidden" style={{ marginTop: 36, textAlign: 'center' }}>
            <button
              onClick={() => setShowFeedback(true)}
              style={{
                border: `1px solid ${LINE}`, background: '#fff', color: '#4A5E5A',
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

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

// ─── Business completeness nudge ─────────────────────────────────────────────
function ProfileCompletenessCard({ business }) {
  if (!business) return null;

  const checks = [
    { key: 'address',        label: 'Add your address',         done: !!business.address,        href: '/settings/profile', icon: '📍' },
    { key: 'owner_phone',    label: 'Add your phone number',    done: !!business.owner_phone,    href: '/settings/profile', icon: '📱' },
    { key: 'business_hours', label: 'Add your opening hours',   done: !!business.business_hours, href: '/settings/profile', icon: '🕐' },
    { key: 'instagram',      label: 'Add your Instagram link',  done: !!business.instagram,      href: '/settings/profile', icon: '📸' },
    { key: 'sample_replies', label: 'Add 3 sample replies',     done: (business.sample_replies?.length || 0) >= 3, href: '/settings/voice', icon: '🗣️' },
  ];

  const missing = checks.filter(c => !c.done);
  if (missing.length === 0) return null; // all complete, hide

  const done = checks.length - missing.length;
  const pct = Math.round((done / checks.length) * 100);
  const next = missing[0];

  return (
    <div style={{ marginTop: 20 }}>
      <Link href={next.href} style={{ textDecoration: 'none', display: 'block' }}>
        <div style={{
          background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
          padding: '14px 16px', boxShadow: '0 1px 0 rgba(14,40,35,.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Profile completeness</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{pct}%</div>
          </div>
          <div style={{ height: 4, background: LINE, borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', background: GOLD, borderRadius: 999, width: `${pct}%`, transition: 'width .5s ease' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>{next.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: INK }}>{next.label}</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>MiniMe uses this info in every reply</div>
            </div>
            <span style={{ fontSize: 16, color: MUTED }}>›</span>
          </div>
        </div>
      </Link>
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
