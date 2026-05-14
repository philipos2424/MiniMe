'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { isAmharic } from '../../lib/design-tokens';
import { MiniMeLogo } from '../ui/MiniMeLogo';
import { Mic, BookOpen, Compass, MessageSquare } from 'lucide-react';

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
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ─── TopBar ──────────────────────────────────────────────────────────────────
function TopBar({ businessName, ownerName, active, onToggle }) {
  return (
    <div style={{
      padding: '14px 22px 10px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: PAPER, borderBottom: `1px solid ${LINE}`,
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <MiniMeLogo size={32} />
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED }}>
            {greeting()}{ownerName ? `, ${ownerName}` : ''}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.1, color: INK }}>{businessName}</div>
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
              <>Caught up.<br /><span style={{ fontStyle: 'italic', color: GOLDSF }}>Take a break.</span></>
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

      {/* Stats strip */}
      <div style={{
        display: 'flex', gap: 18, marginTop: 22, paddingTop: 16,
        borderTop: '1px solid rgba(244,238,225,0.12)',
      }}>
        <MiniStat n={stats.chatsToday} label="replied today" />
        <MiniStat n={stats.ordersToday} label="orders" />
        <MiniStat n={stats.hoursSaved} label="hours saved" />
        {helpfulPct !== null && <MiniStat n={`${helpfulPct}%`} label="helpful" />}
      </div>
    </div>
  );
}

function MiniStat({ n, label }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: SERIF, fontSize: 22, color: PAPER, lineHeight: 1 }}>{n ?? '—'}</div>
      <div style={{ fontSize: 10.5, color: 'rgba(244,238,225,0.55)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Draft cards ─────────────────────────────────────────────────────────────
function DraftCard({ m }) {
  const isAmh = isAmharic(m.preview);
  return (
    <Link href={`/conversations/${m.conversation_id}?focusDraft=1`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16,
        padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start',
        boxShadow: '0 1px 0 rgba(14,40,35,.04), 0 8px 24px -12px rgba(14,40,35,.12)',
      }}>
        <Avatar name={m.client_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.client_name}</div>
              <span style={{ background: 'rgba(176,138,74,.12)', color: GOLD, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 500, flexShrink: 0 }}>draft</span>
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, flexShrink: 0 }}>{m.time_ago}</div>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#4A5E5A', fontFamily: isAmh ? AMH : BODY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.preview}
          </div>
          {m.draft_preview && (
            <div style={{
              marginTop: 8, padding: '8px 10px', background: CREAM, borderRadius: 10,
              fontSize: 13, color: INK, display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4"/></svg>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.draft_preview}</span>
            </div>
          )}
        </div>
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
function EmptyState({ botUsername }) {
  return (
    <div className="fade-up" style={{ textAlign: 'center', paddingTop: 20 }}>
      <div style={{ fontSize: 56, marginBottom: 14 }}>👋</div>
      <div style={{ fontFamily: SERIF, fontSize: 26, color: INK }}>MiniMe is ready</div>
      <p style={{ fontSize: 15, color: '#4A5E5A', marginTop: 10, lineHeight: 1.55, maxWidth: 300, margin: '10px auto 0' }}>
        Send your first message to {botUsername ? <b>@{botUsername}</b> : 'your bot'} and watch me reply in your exact voice.
      </p>
      <Link href="/teach" style={{ textDecoration: 'none', display: 'block', marginTop: 28 }}>
        <div style={{
          background: INK, color: PAPER, padding: '16px', borderRadius: 999,
          fontSize: 15, fontWeight: 500, fontFamily: BODY,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          Teach MiniMe your business
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={PAPER} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </div>
      </Link>
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
  const { business, telegramUser, loading, initData } = useTelegram() || {};
  const [feed, setFeed] = useState(null);
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('mm_splash_shown');
  });
  const [paused, setPaused] = useState(null);

  useEffect(() => {
    if (loading) return;
    if (!business || !business.telegram_bot_username) router.replace('/onboarding');
  }, [loading, business, router]);

  useEffect(() => {
    if (!initData || !business?.id) return;
    let off = false;
    (async () => {
      try {
        const r = await fetch('/api/home/feed', {
          headers: { 'x-telegram-init-data': initData }, cache: 'no-store',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!off) setFeed(j);
      } catch {}
    })();
    return () => { off = true; };
  }, [initData, business?.id]);

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
  const stats = {
    chatsToday: feed?.handled_today ?? '—',
    ordersToday: feed?.orders_today ?? '—',
    hoursSaved: feed?.hours_saved_today != null
      ? (feed.hours_saved_today < 1 ? `${Math.round(feed.hours_saved_today * 60)}m` : `${feed.hours_saved_today}h`)
      : '—',
    helpfulPct: feed?.helpful_pct ?? null,
  };

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>
      <TopBar
        businessName={business?.name || 'Your shop'}
        ownerName={ownerFirst}
        active={active}
        onToggle={togglePause}
      />

      <div style={{ padding: '16px 22px 0' }}>
        {!feed ? (
          <Skeleton />
        ) : feed.needs_reply?.length || feed.handled_today > 0 || feed.has_any_messages ? (
          <div className="fade-up">
            <HeroCard needsReply={needsReply} stats={stats} helpfulPct={stats.helpfulPct} />

            {/* Draft queue */}
            {feed.needs_reply?.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <SectionLabel kicker="Inbox" title="Drafts ready" action={
                  <Link href="/conversations" style={{ textDecoration: 'none', fontSize: 13, color: '#4A5E5A', fontWeight: 500 }}>See all</Link>
                } />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {feed.needs_reply.slice(0, 3).map((m, i) => (
                    <div key={m.conversation_id} className="fade-up" style={{ animationDelay: `${0.05 * i}s` }}>
                      <DraftCard m={m} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Advisor */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Advisor" title="A second opinion" />
              <AdvisorCard />
            </div>

            {/* Teach */}
            <div style={{ marginTop: 28 }}>
              <SectionLabel kicker="Teach" title="Make me sharper" />
              <TeachGrid />
            </div>
          </div>
        ) : (
          <div className="fade-up">
            <EmptyState botUsername={business?.telegram_bot_username} />
            <div style={{ marginTop: 32 }}>
              <SectionLabel kicker="Teach" title="Get started" />
              <TeachGrid />
            </div>
          </div>
        )}
      </div>

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
