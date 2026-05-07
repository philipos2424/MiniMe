'use client';
/**
 * Home (Messages tab) — minimalist mobile redesign v3.
 *
 * Features:
 *   - Exclusive splash/loader on first open
 *   - Analytics: chats handled + hours saved (today + week)
 *   - Live demo typing animation for new users
 *   - Three states: A = needs reply, B = all caught up, C = new user
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW, isAmharic } from '../../lib/design-tokens';

// ─── Splash Screen ───────────────────────────────────────────────
function SplashScreen({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0); // 0=logo, 1=tagline, 2=loading

  useEffect(() => {
    // Animate logo in
    setTimeout(() => setPhase(1), 400);
    setTimeout(() => setPhase(2), 900);
    // Progress bar
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 18 + 5;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(onDone, 350); }
      setProgress(Math.min(p, 100));
    }, 120);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'linear-gradient(160deg, #0D9488 0%, #0F766E 40%, #064E3B 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT.body,
    }}>
      {/* Logo mark */}
      <div style={{
        width: 80, height: 80, borderRadius: 24,
        background: 'rgba(255,255,255,0.15)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 40,
        opacity: phase >= 0 ? 1 : 0,
        transform: phase >= 0 ? 'scale(1)' : 'scale(0.5)',
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>🤖</div>

      {/* Wordmark */}
      <div style={{
        marginTop: 20,
        opacity: phase >= 1 ? 1 : 0,
        transform: phase >= 1 ? 'translateY(0)' : 'translateY(12px)',
        transition: 'all 0.4s ease',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.03em' }}>MiniMe</div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Your AI Business Assistant
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        position: 'absolute', bottom: 60, left: 40, right: 40,
        opacity: phase >= 2 ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.2)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 99,
            background: 'rgba(255,255,255,0.9)',
            width: `${progress}%`,
            transition: 'width 0.12s ease',
          }} />
        </div>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>
          {progress < 40 ? 'Connecting…' : progress < 75 ? 'Loading your business…' : progress < 95 ? 'Almost ready…' : 'Ready'}
        </div>
      </div>

      {/* Decorative dots */}
      <div style={{ position: 'absolute', top: 80, right: 30, width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
      <div style={{ position: 'absolute', top: 120, right: 60, width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
      <div style={{ position: 'absolute', bottom: 140, left: 30, width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
      <div style={{ position: 'absolute', top: 200, left: 50, width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.2)' }} />
    </div>
  );
}

// ─── Analytics stat card ─────────────────────────────────────────
function StatCard({ value, label, sub, accent, icon }) {
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg,
      padding: '16px 14px',
      boxShadow: SHADOW.card,
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 20, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 400,
        color: accent || COLORS.teal, lineHeight: 1, letterSpacing: '-0.025em',
      }}>{value}</div>
      {sub && (
        <div style={{
          fontSize: 11, marginTop: 5, color: COLORS.textHint,
          fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
        }}>{sub}</div>
      )}
    </div>
  );
}

// ─── Demo chat animation ─────────────────────────────────────────
function DemoChat() {
  const [phase, setPhase] = useState(0);
  // 0: client msg, 1: typing dots, 2: minime reply
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 800);
    const t2 = setTimeout(() => setPhase(2), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg,
      padding: 16,
      boxShadow: SHADOW.card,
      marginTop: 20,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>LIVE DEMO</div>

      {/* Client message */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 4 }}>Client</div>
          <div style={{
            background: '#F3F4F6', borderRadius: '12px 12px 12px 4px',
            padding: '10px 14px', fontSize: 15, fontFamily: FONT.amharic, color: COLORS.textPrimary,
            maxWidth: 240,
          }}>
            "ዋጋ ስንት ነው? NFC card"
          </div>
        </div>
      </div>

      {/* MiniMe typing / reply */}
      {phase >= 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 11, color: COLORS.teal, marginBottom: 4, textAlign: 'right', fontWeight: 600 }}>MiniMe</div>
            {phase === 1 ? (
              <div style={{
                background: COLORS.teal, borderRadius: '12px 12px 4px 12px',
                padding: '10px 16px', display: 'flex', gap: 5, alignItems: 'center',
              }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{
                    width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.7)',
                    animation: `mmDot 1.2s ${i * 0.2}s ease-in-out infinite`,
                    display: 'inline-block',
                  }} />
                ))}
              </div>
            ) : (
              <div style={{
                background: COLORS.teal, borderRadius: '12px 12px 4px 12px',
                padding: '10px 14px', fontSize: 14, fontFamily: FONT.amharic, color: '#FFFFFF',
                maxWidth: 260, lineHeight: 1.5,
                animation: 'mmFadeUp 0.3s ease',
              }}>
                "ሰላም! ✅ NFC Digital card 4,000 ብር ነው — QR + NFC + App ሁሉም ይጠቃለላል 😊 መቼ ትፈልጋለህ?"
              </div>
            )}
          </div>
        </div>
      )}

      {phase >= 2 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: COLORS.greenLight, borderRadius: RADII.sm, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: COLORS.green, fontSize: 14 }}>⚡</span>
          <span style={{ fontSize: 12, color: COLORS.green, fontWeight: 500 }}>Replied in 1.2s — in your exact voice</span>
        </div>
      )}

      <style>{`
        @keyframes mmDot {
          0%,80%,100%{transform:scale(1);opacity:0.5}
          40%{transform:scale(1.3);opacity:1}
        }
        @keyframes mmFadeUp {
          from{opacity:0;transform:translateY(6px)}
          to{opacity:1;transform:translateY(0)}
        }
      `}</style>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { business, telegramUser, loading, initData } = useTelegram() || {};
  const [feed, setFeed] = useState(null);
  // sessionStorage persists across in-session navigation; useRef reset on every mount
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !sessionStorage.getItem('mm_splash_shown');
  });

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
          headers: { 'x-telegram-init-data': initData },
          cache: 'no-store',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!off) setFeed(j);
      } catch {}
    })();
    return () => { off = true; };
  }, [initData, business?.id]);

  // Local paused state shadows business.panic_mode so toggling is instant
  const [paused, setPaused] = useState(null); // null = use server value
  const active = paused !== null ? !paused : !business?.panic_mode;
  const businessName = business?.name || 'Your shop';

  async function togglePause() {
    if (!business?.id) return;
    const next = !active;
    setPaused(next);
    try {
      await createClient()
        .from('businesses')
        .update({ panic_mode: next })
        .eq('id', business.id);
    } catch {
      setPaused(!next); // revert on error
    }
  }

  if (showSplash) {
    return (
      <SplashScreen onDone={() => {
        sessionStorage.setItem('mm_splash_shown', '1');
        setShowSplash(false);
      }} />
    );
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 90, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* HEADER */}
      <header style={{
        padding: '16px 20px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>{businessName}</div>
          {feed && (feed.all_time_ai_chats > 0) && (
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 1 }}>
              {feed.all_time_ai_chats.toLocaleString()} chats handled all time
            </div>
          )}
        </div>
        <button
          onClick={togglePause}
          title={active ? 'Tap to pause MiniMe' : 'Tap to resume MiniMe'}
          style={{
            appearance: 'none', border: `1px solid ${active ? COLORS.green + '50' : COLORS.amber + '60'}`,
            borderRadius: 999, padding: '5px 10px',
            background: active ? COLORS.greenLight : COLORS.amberLight,
            cursor: 'pointer', fontFamily: FONT.body,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: active ? COLORS.green : COLORS.amber,
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: active ? COLORS.green : COLORS.amber,
            animation: active ? 'pulse 2s infinite' : 'none',
          }} />
          {active ? 'Active' : 'Paused'}
        </button>
      </header>

      <div style={{ padding: '16px 20px 0' }}>
        {!feed ? <Skeleton /> : feed.needs_reply?.length ? (
          <StateA needs={feed.needs_reply} feed={feed} />
        ) : feed.handled_today > 0 || feed.has_any_messages ? (
          <StateB feed={feed} />
        ) : (
          <StateC botUsername={business?.telegram_bot_username} />
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%,100%{opacity:1} 50%{opacity:0.5}
        }
        @keyframes mmFadeIn {
          from{opacity:0;transform:translateY(16px)}
          to{opacity:1;transform:translateY(0)}
        }
      `}</style>
    </div>
  );
}

// ─── Analytics strip ─────────────────────────────────────────────
function AnalyticsStrip({ feed }) {
  const todayH = feed.hours_saved_today || 0;
  const weekH  = feed.hours_saved_week || 0;
  const todayC = feed.handled_today || 0;
  const weekC  = feed.weekly_ai_chats || 0;

  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel>YOUR NUMBERS</SectionLabel>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <StatCard
          icon="💬"
          value={todayC}
          label="today"
          sub="chats handled"
          accent={COLORS.teal}
        />
        <StatCard
          icon="⏱"
          value={todayH < 1 ? `${Math.round(todayH * 60)}m` : `${todayH}h`}
          label="today"
          sub="time saved"
          accent="#7C3AED"
        />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <StatCard
          icon="📊"
          value={weekC}
          label="this week"
          sub="AI replies sent"
          accent={COLORS.green}
        />
        <StatCard
          icon="🕐"
          value={weekH < 1 ? `${Math.round(weekH * 60)}m` : `${weekH}h`}
          label="this week"
          sub="time saved"
          accent={COLORS.amber}
        />
      </div>
      {feed.total_customers > 0 && (
        <div style={{
          marginTop: 10, background: COLORS.surface, border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.lg, padding: '12px 16px', boxShadow: SHADOW.card,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>👥</span>
            <div>
              <div style={{ fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.textHint, marginBottom: 2 }}>Total clients</div>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 400, color: COLORS.textPrimary, letterSpacing: '-0.02em', lineHeight: 1 }}>{feed.total_customers}</div>
            </div>
          </div>
          <Link href="/customers" style={{ textDecoration: 'none', fontSize: 13, color: COLORS.teal, fontWeight: 500 }}>View all →</Link>
        </div>
      )}
      <Link href="/analytics" style={{
        display: 'block', textAlign: 'center', marginTop: 14,
        fontSize: 13, color: COLORS.teal, fontWeight: 500, textDecoration: 'none',
      }}>
        View full analytics →
      </Link>
    </div>
  );
}

// ─── State A — needs reply ───────────────────────────────────────
function StateA({ needs, feed }) {
  return (
    <div style={{ animation: 'mmFadeIn 0.3s ease' }}>
      <SectionLabel>NEEDS YOUR REPLY</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        {needs.map(m => <NeedCard key={m.conversation_id} m={m} />)}
      </div>
      <AnalyticsStrip feed={feed} />
    </div>
  );
}

function NeedCard({ m }) {
  const dotColor = m.status === 'urgent' ? COLORS.red : m.status === 'pending' ? COLORS.amber : COLORS.green;
  const tagText  = m.status === 'urgent' ? 'Needs personal reply' : m.status === 'pending' ? 'AI draft ready — tap to send' : 'AI handled it';
  const tagBg    = m.status === 'urgent' ? COLORS.redLight : m.status === 'pending' ? COLORS.amberLight : COLORS.greenLight;
  const tagColor = m.status === 'urgent' ? COLORS.red : m.status === 'pending' ? '#92400E' : COLORS.green;
  const isAmh    = isAmharic(m.preview);
  return (
    <Link href={`/conversations/${m.conversation_id}${m.status === 'pending' ? '?focusDraft=1' : ''}`} style={{ textDecoration: 'none' }}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.client_name}</span>
          </div>
          <span style={{ fontSize: 12, color: COLORS.textHint, flexShrink: 0 }}>{m.time_ago}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 15, color: COLORS.textPrimary, lineHeight: 1.5, fontFamily: isAmh ? FONT.amharic : FONT.body, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {m.has_file ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18 }}>{m.file_type?.startsWith('image') ? '🖼' : m.file_type?.startsWith('video') ? '🎥' : '📎'}</span>
              <span style={{ color: COLORS.textSecondary }}>{m.preview}</span>
            </span>
          ) : `"${m.preview}"`}
        </div>
        <div style={{ marginTop: 12, display: 'inline-block', fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 999, background: tagBg, color: tagColor }}>
          {tagText}
        </div>
      </div>
    </Link>
  );
}

// ─── State B — all caught up ─────────────────────────────────────
function StateB({ feed }) {
  return (
    <div style={{ animation: 'mmFadeIn 0.3s ease' }}>
      {/* Compact success card */}
      <div style={{
        background: COLORS.greenLight, border: `1px solid ${COLORS.green}30`,
        borderRadius: RADII.lg, padding: '16px 18px',
        display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: SHADOW.card,
      }}>
        <span style={{ fontSize: 36, flexShrink: 0 }}>✅</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.textPrimary }}>All caught up!</div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>MiniMe handled everything. Your clients are taken care of.</div>
        </div>
        <Link href="/demo" style={{ textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: COLORS.teal, fontWeight: 500, whiteSpace: 'nowrap' }}>✨ Demo</span>
        </Link>
      </div>
      <AnalyticsStrip feed={feed} />
    </div>
  );
}

// ─── State C — new user ──────────────────────────────────────────
function StateC({ botUsername }) {
  return (
    <div style={{ animation: 'mmFadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 20 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>👋</div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>MiniMe is ready</h2>
        <p style={{ fontSize: 15, color: COLORS.textSecondary, marginTop: 10, lineHeight: 1.5, maxWidth: 300 }}>
          Send your first client message to {botUsername ? <b>@{botUsername}</b> : 'your bot'} and watch me reply in your exact voice.
        </p>
      </div>

      {/* Animated demo */}
      <DemoChat />

      {/* What MiniMe can do */}
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { icon: '⚡', title: 'Instant replies', sub: 'Answers price, availability & FAQ in seconds' },
          { icon: '📦', title: 'Know your inventory', sub: 'Teach it your products once — it never forgets' },
          { icon: '🕐', title: 'Works 24/7', sub: 'Never miss a client even when you\'re busy' },
        ].map((it, i) => (
          <div key={i} style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card,
            display: 'flex', alignItems: 'flex-start', gap: 14,
          }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>{it.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{it.title}</div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{it.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div style={{ marginTop: 24, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link href="/agent/knowledge" style={{ textDecoration: 'none' }}>
          <button style={{
            width: '100%', appearance: 'none', border: 'none',
            background: COLORS.teal, color: '#FFFFFF',
            padding: '16px', borderRadius: RADII.md, fontSize: 16, fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT.body,
          }}>
            Teach MiniMe your business →
          </button>
        </Link>
        <Link href="/demo" style={{ textDecoration: 'none' }}>
          <button style={{
            width: '100%', appearance: 'none',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.surface, color: COLORS.textSecondary,
            padding: '14px', borderRadius: RADII.md, fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: FONT.body,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            ✨ Watch MiniMe in action — A Tale of Two Tuesdays
          </button>
        </Link>
        <p style={{ fontSize: 12, color: COLORS.textHint, textAlign: 'center', marginTop: 2 }}>
          Add your products, prices & FAQs in 2 minutes
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em' }}>{children}</div>;
}
function Skeleton() {
  return (
    <div style={{ animation: 'mmFadeIn 0.3s ease' }}>
      <div style={{ height: 24, background: '#EBEBEB', borderRadius: 6, width: 140, marginBottom: 12, animation: 'pulse 1.5s infinite' }} />
      <div style={{ height: 110, background: '#F3F3F1', borderRadius: RADII.lg, marginBottom: 10, animation: 'pulse 1.5s infinite' }} />
      <div style={{ height: 110, background: '#F3F3F1', borderRadius: RADII.lg, marginBottom: 10, animation: 'pulse 1.5s infinite', opacity: 0.7 }} />
      <div style={{ height: 90, background: '#F3F3F1', borderRadius: RADII.lg, animation: 'pulse 1.5s infinite', opacity: 0.4 }} />
    </div>
  );
}
