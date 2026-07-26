'use client';
<<<<<<< HEAD
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { Home, MessageSquare, Sparkles, Workflow, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { useAuth } from '../../hooks/useAuth';
=======
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import Sidebar from './Sidebar';
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
import MobileNav from './MobileNav';
import { ToastProvider, useToast } from '../ui/Toast';
import { COLORS, FONT } from '../../lib/design-tokens';
import { needsOnboarding } from '../../lib/onboarding-status';
import { MiniMeLogo } from '../ui/MiniMeLogo';

// ─── Platform Feedback Widget ─────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'bug',     label: '🐛 Bug report' },
  { key: 'feature', label: '✨ Feature idea' },
  { key: 'general', label: '💬 General' },
  { key: 'praise',  label: '🎉 Love it!' },
];

// One guided question per category — a real question with tap-to-answer chips so
// owners who don't want to write still tell us something useful. The chosen chips
// are prepended to the note as "Prompt: answer" lines (no API change needed).
const GUIDED = {
  bug: {
    prompt: 'Where did it happen?',
    chips: ['Home', 'Chats', 'Products', 'Settings', 'In the bot', 'Somewhere else'],
  },
  feature: {
    prompt: 'What would help you sell more?',
    chips: ['Faster replies', 'Easier product import', 'More languages', 'Marketing tools', 'Better insights'],
  },
  general: {
    prompt: 'Was anything confusing today?',
    chips: ['Home', 'Chats', 'Settings', 'Setup', "Nothing — it's clear"],
  },
  praise: {
    prompt: 'What do you love most?',
    chips: ['It saves me time', 'It sounds like me', 'Never miss a customer', 'The insights', 'Everything'],
  },
};

export function FeedbackModal({ onClose }) {
  const { initData } = useTelegram() || {};
  const { toast } = useToast();
  const pathname = usePathname();
  const [nps, setNps] = useState(null);
  const [category, setCategory] = useState(null);
  const [picks, setPicks] = useState([]); // tapped guided-answer chips
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const guided = category ? GUIDED[category] : null;
  function togglePick(chip) {
    setPicks(p => p.includes(chip) ? p.filter(c => c !== chip) : [...p, chip]);
  }
  // Switching category clears stale answers from the previous one.
  function pickCategory(key) { setCategory(key); setPicks([]); }

  const send = useCallback(async () => {
    if (!category) { toast('Please pick a category', { variant: 'error' }); return; }
    setSending(true);
    // Fold the guided answer into the note so no schema change is needed.
    const guidedLine = picks.length ? `${GUIDED[category].prompt} ${picks.join(', ')}` : '';
    const fullNote = [guidedLine, note.trim()].filter(Boolean).join('\n');
    try {
      await fetch('/api/platform/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
        body: JSON.stringify({ nps_score: nps, category, note: fullNote, page: pathname }),
      });
      toast('Thanks for your feedback! 🙏', { variant: 'success' });
      onClose();
    } catch { toast('Could not send — try again', { variant: 'error' }); }
    finally { setSending(false); }
  }, [category, nps, note, picks, pathname, initData, toast, onClose]);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(14,40,35,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 env(safe-area-inset-bottom)',
      }}
    >
      <div style={{
<<<<<<< HEAD
        background: 'var(--card)', borderRadius: '20px 20px 0 0',
=======
        background: '#fff', borderRadius: '20px 20px 0 0',
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        width: '100%', maxWidth: 480, padding: '24px 20px 28px',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.textPrimary }}>How's MiniMe working?</div>
            <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>Your feedback shapes what we build next</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: COLORS.textHint, padding: 4 }}>×</button>
        </div>

        {/* NPS row */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
            HOW LIKELY TO RECOMMEND? (optional)
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
              <button key={n} onClick={() => setNps(nps === n ? null : n)} style={{
                width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${nps === n ? COLORS.teal : COLORS.border}`,
                background: nps === n
                  ? COLORS.teal
                  : n <= 6 ? 'rgba(184,84,80,0.06)' : n <= 8 ? 'rgba(176,138,74,0.06)' : 'rgba(79,163,138,0.06)',
                color: nps === n ? '#fff' : COLORS.textSecondary,
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
              }}>{n}</button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: COLORS.textHint }}>Not likely</span>
            <span style={{ fontSize: 10, color: COLORS.textHint }}>Very likely</span>
          </div>
        </div>

        {/* Category */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
            WHAT'S THIS ABOUT? <span style={{ color: COLORS.red }}>*</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CATEGORIES.map(c => (
              <button key={c.key} onClick={() => pickCategory(c.key)} style={{
                padding: '10px 12px', borderRadius: 10, textAlign: 'left',
                border: `1.5px solid ${category === c.key ? COLORS.teal : COLORS.border}`,
                background: category === c.key ? COLORS.teal + '12' : '#fff',
                color: category === c.key ? COLORS.teal : COLORS.textSecondary,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
              }}>{c.label}</button>
            ))}
          </div>
        </div>

<<<<<<< HEAD
        {/* Guided question — appears once a category is picked. Tap-to-answer so
            owners who won't type still give us a signal. */}
=======
        {/* Guided question */}
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        {guided && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
              {guided.prompt.toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {guided.chips.map(chip => {
                const on = picks.includes(chip);
                return (
                  <button key={chip} onClick={() => togglePick(chip)} style={{
                    padding: '7px 12px', borderRadius: 999,
                    border: `1.5px solid ${on ? COLORS.teal : COLORS.border}`,
                    background: on ? COLORS.teal : '#fff',
                    color: on ? '#fff' : COLORS.textSecondary,
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
                  }}>{on ? '✓ ' : ''}{chip}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* Note */}
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Tell us more… (optional)"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            background: COLORS.bg, border: `1.5px solid ${COLORS.border}`,
            borderRadius: 10, padding: '10px 12px', marginBottom: 16,
            fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
            outline: 'none', lineHeight: 1.5,
          }}
        />

        {/* Send */}
        <button onClick={send} disabled={!category || sending} style={{
          width: '100%', padding: '14px', background: !category || sending ? COLORS.textHint : COLORS.ink,
          color: '#fff', border: 'none', borderRadius: 999, fontSize: 14, fontWeight: 600,
          cursor: !category || sending ? 'default' : 'pointer', fontFamily: FONT.body,
        }}>
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </div>
  );
}

function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
<<<<<<< HEAD
      {/* Visible on every screen. On mobile it sits ABOVE the bottom nav (which
          owns the very bottom); on desktop there's no bottom nav so it floats a
          little higher than the corner — still clear of everything. */}
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="flex"
        style={{
          position: 'fixed', right: 14, bottom: 'calc(84px + env(safe-area-inset-bottom))',
          zIndex: 100, background: COLORS.ink, color: '#fff',
          border: 'none', borderRadius: 999, padding: '8px 13px',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
          boxShadow: '0 4px 16px rgba(14,40,35,0.28)',
          alignItems: 'center', gap: 6,
        }}
      >
        💬 <span style={{ letterSpacing: '0.02em' }}>Feedback</span>
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

// Detect impersonation token in URL and show a banner
function ImpersonateBanner() {
  const [bizName, setBizName] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('impersonate');
    if (!t) return;
    setToken(t);
<<<<<<< HEAD
    // Store token for API calls that support x-impersonate-token header
    sessionStorage.setItem('impersonate_token', t);
    // Parse payload (not verified client-side — server verifies on each request)
=======
    sessionStorage.setItem('impersonate_token', t);
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
    try {
      const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      setBizName(payload.target_business_id || 'unknown');
    } catch {}
  }, []);

  if (!token) return null;

  return (
    <div style={{
      background: '#7B3F00', color: '#FFF8E7', padding: '8px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontWeight: 500, zIndex: 9999, flexShrink: 0,
    }}>
      <span>🎭 Admin impersonation active — all actions are audit-logged</span>
      <button onClick={() => {
        sessionStorage.removeItem('impersonate_token');
        window.close();
      }} style={{
        background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
        borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12,
      }}>End session ×</button>
    </div>
  );
}

<<<<<<< HEAD
// Wire Telegram's native BackButton across the whole app. On any sub-page it
// pops back; on Home (the root) there's nowhere further back, so it closes the
// Mini App — the natural "back out" gesture inside Telegram. No-ops cleanly in a
// plain browser (no Telegram.WebApp), where the browser's own back chrome works.
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
function TelegramBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const wa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = wa?.BackButton;
    if (!bb) return;
    const onHome = pathname === '/';
    const handler = () => {
      if (onHome) { try { wa.close(); } catch {} }
      else { try { sessionStorage.setItem('_navigated', '1'); } catch {} router.back(); }
    };
    try { bb.show(); bb.onClick(handler); } catch {}
    return () => { try { bb.offClick(handler); } catch {} };
  }, [pathname, router]);
  return null;
}

<<<<<<< HEAD
// "Welcome back — restore your shop?" — shown on the fresh-start screen when a
// returning owner has a non-expired backup in the deletion vault.
function RestoreBanner() {
  const { initData } = useTelegram() || {};
  const [info, setInfo] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!initData) return;
    let off = false;
    fetch('/api/businesses/restore', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!off && j?.has_backup) setInfo(j); })
      .catch(() => {});
    return () => { off = true; };
  }, [initData]);

  if (!info || dismissed) return null;

  const days = Math.max(0, Math.ceil((new Date(info.expires_at) - Date.now()) / 86400000));

  async function restore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const r = await fetch('/api/businesses/restore', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) throw new Error();
      window.location.href = '/';
    } catch {
      setRestoring(false);
      alert('Could not restore — please try again.');
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 'env(safe-area-inset-top)', left: 0, right: 0, zIndex: 3000,
      background: 'var(--ink)', color: 'var(--paper)', fontFamily: FONT.body,
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 24px -12px rgba(0,0,0,.4)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Welcome back{info.original_name ? ` — ${info.original_name}` : ''}</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>We kept your shop for {days} more day{days === 1 ? '' : 's'}. Restore it?</div>
      </div>
      <button onClick={restore} disabled={restoring} style={{
        background: 'var(--paper)', color: 'var(--ink)', border: 'none', borderRadius: 999,
        padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: restoring ? 'wait' : 'pointer',
        fontFamily: 'inherit', flexShrink: 0, opacity: restoring ? 0.6 : 1,
      }}>{restoring ? 'Restoring…' : 'Restore'}</button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{
        background: 'none', border: 'none', color: 'var(--paper)', opacity: 0.7,
        fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4, flexShrink: 0,
      }}>×</button>
    </div>
  );
}

=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
export default function DashboardShell({ children }) {
  const { loading, error, telegramUser, business } = useTelegram();
  const router = useRouter();
  const pathname = usePathname();
  const onOnboarding = pathname?.startsWith('/onboarding');

<<<<<<< HEAD
  // startapp=demo deep link → show the demo page inside Telegram.
  // Uses sessionStorage so navigating back from /demo doesn't loop.
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const startParam = twa?.initDataUnsafe?.start_param;
    if (startParam === 'demo' && !sessionStorage.getItem('_demo_seen')) {
      sessionStorage.setItem('_demo_seen', '1');
      router.replace('/demo');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

<<<<<<< HEAD
  // Always land on Home (/) when the Mini App opens fresh.
  // Telegram creates a new WebView each open, so this fires every time.
  // Skips sub-routes the user actively navigated to in the same session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('_navigated')) return; // user has navigated — don't override
=======
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('_navigated')) return;
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
    const path = window.location.pathname;
    const isDeepLink = path !== '/' && !path.startsWith('/onboarding') && !path.startsWith('/demo');
    if (isDeepLink) router.replace('/');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

<<<<<<< HEAD
  // New owners: redirect into the onboarding wizard.
  // A business needs onboarding if it has no linked bot token username.
  // We also allow skipping via "I'll do this later" (bot may not be linked yet
  // but business row exists — we only force onboarding on first open).
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
  useEffect(() => {
    if (loading || error || !telegramUser) return;
    if (needsOnboarding(business) && !onOnboarding) router.replace('/onboarding');
  }, [loading, error, telegramUser, business?.telegram_bot_username, business?.onboarding_completed, onOnboarding, router]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(ellipse at center, #14342E 0%, #0A1E1B 80%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT.body, overflow: 'hidden',
      }}>
<<<<<<< HEAD
        {/* Grain overlay */}
        <div className="grain" />
        {/* Logo */}
        <div className="mirror-reveal" style={{ marginBottom: 28 }}>
          <MiniMeLogo size={80} color="#F4EEE1" accent="#D4B987" />
        </div>
        {/* Wordmark */}
=======
        <div className="grain" />
        <div className="mirror-reveal" style={{ marginBottom: 28 }}>
          <MiniMeLogo size={80} color="#F4EEE1" accent="#D4B987" />
        </div>
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        <div className="fade-up delay-2" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 300, fontStyle: 'italic', fontSize: 32, color: '#F4EEE1', letterSpacing: '-0.015em' }}>
            minime
          </div>
          <div className="fade-in delay-3" style={{ marginTop: 8, color: 'rgba(244,238,225,0.5)', letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: 10 }}>
            your business, mirrored
          </div>
        </div>
<<<<<<< HEAD
        {/* Progress bar */}
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        <div style={{ position: 'absolute', bottom: 90, left: 50, right: 50 }}>
          <div className="prog"><div className="prog-fill" style={{ width: '60%', animation: 'none', background: '#D4B987' }} /></div>
        </div>
        <div style={{ position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(244,238,225,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Connecting…
        </div>
      </div>
    );
  }

  if (error || !telegramUser) {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const debug = {
      hasTelegram: !!window.Telegram,
      hasWebApp: !!twa,
      hasInitData: !!twa?.initData,
      initDataLength: twa?.initData?.length || 0,
      version: twa?.version,
      platform: twa?.platform,
      error: error || '(no error)',
    };
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', background: COLORS.bg, fontFamily: FONT.body }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24, maxWidth: 384, width: '100%' }}>
          <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
          <p style={{ fontWeight: 600, color: COLORS.textPrimary, textAlign: 'center', margin: '0 0 8px', fontSize: 15 }}>Open in Telegram</p>
          <p style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', margin: '0 0 16px' }}>
            MiniMe must be opened through your Telegram bot.
          </p>
          <pre style={{ fontSize: 11, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, color: COLORS.textHint, overflow: 'auto' }}>
            {JSON.stringify(debug, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

<<<<<<< HEAD
  // While onboarding (no business yet OR no bot linked), render wizard bare —
  // no padding, no chrome. The onboarding screens manage their own full-screen layout.
  // Also render bare when the user is REPLAYING onboarding on demand (?preview=1),
  // even though their business is fully set up — otherwise the dashboard sidebar/topbar
  // would wrap the wizard.
  if (needsOnboarding(business) || onOnboarding) {
    return (
      <ToastProvider>
        <RestoreBanner />
=======
  if (needsOnboarding(business) || onOnboarding) {
    return (
      <ToastProvider>
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        <div style={{ position: 'fixed', inset: 0, fontFamily: FONT.body, overflowY: 'auto' }}>{children}</div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
<<<<<<< HEAD
      {/* position:fixed + inset:0 → truly fullscreen on every phone, including
          models where 100vh includes browser chrome that 100dvh doesn't.
          paddingTop respects Telegram's status bar overlay on iOS. */}
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT.body, width: '100%', background: 'var(--paper)', color: 'var(--ink)', paddingTop: 'env(safe-area-inset-top)' }}>
        <TelegramBackButton />
        <ImpersonateBanner />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <DashboardTopBar business={business} telegramUser={telegramUser} />
          <main style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 16px',
            paddingBottom: 'max(96px, calc(80px + env(safe-area-inset-bottom)))',
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--paper)',
          }}>{children}</main>
        </div>
        <MobileNav />
        </div>
        {/* Floating feedback button — always visible during beta */}
=======
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT.body, width: '100%', background: 'var(--paper)', color: 'var(--ink)', paddingTop: 'env(safe-area-inset-top)' }}>
        <TelegramBackButton />
        <ImpersonateBanner />
        
        {/* Main Application Flex Container */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
          
          {/* Injecting the Sidebar for Desktop */}
          <Sidebar />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <DashboardTopBar business={business} telegramUser={telegramUser} />
            
            <main style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px',
              paddingBottom: 'max(96px, calc(80px + env(safe-area-inset-bottom)))',
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--paper)',
            }}>
              {children}
            </main>
          </div>
          
          <MobileNav />
        </div>
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        <FeedbackButton />
      </div>
    </ToastProvider>
  );
}

<<<<<<< HEAD
// Primary navigation — a single horizontal bar (desktop). Mirrors the mobile
// bottom-nav roots plus the shop-management destinations that used to live in
// the retired left sidebar.
// Time-of-day greeting, alternating Amharic by date so it feels local, not
// translated (mirrors the old in-page TopBar which we've folded in here).
=======
// ─── Simplified Context-Only Top Bar ─────────────────────────────────────────────────
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
function shellGreeting() {
  const now = new Date();
  const h = now.getHours();
  const am = now.getDate() % 2 === 0;
  if (h < 5)  return am ? 'ሌሊቱን ሙሉ' : 'Working late';
  if (h < 12) return am ? 'እንደምን አደሩ' : 'Good morning';
  if (h < 18) return am ? 'እንደምን ዋሉ' : 'Good afternoon';
  return am ? 'እንደምን አመሹ' : 'Good evening';
}

<<<<<<< HEAD
const TOP_NAV = [
  { href: '/',              icon: Home,          label: 'Home'     },
  { href: '/conversations', icon: MessageSquare, label: 'Chats'    },
  { href: '/advisor',       icon: Sparkles,      label: 'Advisor'  },
  { href: '/pipeline',      icon: Workflow,      label: 'Sales'    },
  { href: '/products',      icon: null,          label: 'Products' },
  { href: '/customers',     icon: null,          label: 'Customers' },
  { href: '/analytics',     icon: null,          label: 'Analytics' },
  { href: '/settings',      icon: SettingsIcon,  label: 'Settings' },
];

function DashboardTopBar({ business, telegramUser }) {
  const { theme, toggleTheme } = useTelegram();
  const { signOut } = useAuth();
  const isDark = theme === 'dark';
  const pathname = usePathname();
  const router = useRouter();
  // The 5 bottom-tab roots are "top level" — everything deeper gets a visible
  // in-app Back button on mobile. This chevron is always here (Telegram's native
  // header BackButton is easy to miss / vanishes in fullscreen).
  const TABS = ['/', '/conversations', '/advisor', '/pipeline', '/settings'];
  const showBack = !TABS.includes(pathname);
  const ownerFirst = business.owner_name?.split(' ')[0] || '';
  const paused = !!business.panic_mode;
  const isActive = (href) => href === '/' ? pathname === '/' : (pathname === href || pathname.startsWith(href + '/'));
=======
function DashboardTopBar({ business, telegramUser }) {
  const { theme, toggleTheme } = useTelegram();
  const isDark = theme === 'dark';
  const pathname = usePathname();
  const router = useRouter();
  
  const TABS = ['/', '/conversations', '/advisor', '/pipeline', '/settings'];
  const showBack = !TABS.includes(pathname);
  const ownerFirst = business?.owner_name?.split(' ')[0] || '';
  const paused = !!business?.panic_mode;
  
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
  const goBack = () => {
    try { sessionStorage.setItem('_navigated', '1'); } catch {}
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };
<<<<<<< HEAD
  return (
    <header style={{
      height: 56,
      borderBottom: '1px solid var(--line)',
      background: 'var(--paper)',
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 12,
      flexShrink: 0,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      {/* Back chevron on mobile subpages only (desktop uses the top nav) */}
=======

  return (
    <header style={{
      height: 64,
      borderBottom: '1px solid var(--line)',
      background: 'var(--paper)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 16,
      flexShrink: 0,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      {/* Back chevron on mobile subpages */}
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
      {showBack && (
        <button
          onClick={goBack}
          aria-label="Back"
          className="md:hidden"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
<<<<<<< HEAD
            width: 38, height: 38, marginLeft: -8, borderRadius: 10,
=======
            width: 38, height: 38, marginLeft: -12, borderRadius: 10,
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: COLORS.textPrimary, flexShrink: 0,
          }}
        >
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}

<<<<<<< HEAD
      {/* Brand + greeting + owner (merged from the old in-page header) */}
      <div style={{ minWidth: 0, flexShrink: 1 }}>
        <p style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {shellGreeting()}{ownerFirst ? `, ${ownerFirst}` : ''}
        </p>
        <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em', fontFamily: "'Newsreader', Georgia, serif" }}>
          {business.name}
        </p>
      </div>

      {/* Horizontal primary nav — desktop only */}
      <nav className="hidden md:flex" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 0 }}>
        {TOP_NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', borderRadius: 999, textDecoration: 'none',
                fontSize: 13, fontWeight: active ? 600 : 500,
                color: active ? 'var(--paper)' : COLORS.textSecondary,
                background: active ? 'var(--ink)' : 'transparent',
                transition: 'background .15s, color .15s',
                whiteSpace: 'nowrap',
              }}
            >
              {Icon && <Icon size={15} strokeWidth={active ? 2.1 : 1.7} />}
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
=======
      {/* Brand Context */}
      <div style={{ minWidth: 0, flexShrink: 1 }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textHint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {shellGreeting()}{ownerFirst ? `, ${ownerFirst}` : ''}
        </p>
        <p style={{ fontSize: 18, fontWeight: 700, color: COLORS.textPrimary, margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em', fontFamily: "'Newsreader', Georgia, serif" }}>
          {business?.name || 'MiniMe'}
        </p>
      </div>

      {/* Empty Space filler to push controls to the right */}
      <div style={{ flex: 1 }}></div>

      {/* Right cluster: Controls & Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* Active / Paused pill */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: paused ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          border: `1px solid ${paused ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`, 
          borderRadius: 999, padding: '6px 12px',
          fontSize: 13, fontWeight: 600, flexShrink: 0,
          color: paused ? COLORS.red : COLORS.mint,
        }}>
          <span
            className={paused ? '' : 'animate-pulse'}
            style={{ width: 8, height: 8, borderRadius: '50%', background: paused ? COLORS.red : COLORS.mint, display: 'inline-block' }}
          />
          {paused ? 'Bot Paused' : 'Bot Active'}
        </span>

        <div style={{ width: 1, height: 24, background: 'var(--line)' }}></div>

>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
<<<<<<< HEAD
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
            fontSize: 16, lineHeight: 1, borderRadius: 8, color: COLORS.textHint,
=======
            background: 'var(--bg)', border: `1px solid var(--line)`, cursor: 'pointer', padding: '8px',
            fontSize: 16, lineHeight: 1, borderRadius: '50%', color: COLORS.textPrimary,
            transition: 'all 0.2s ease'
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
          }}
          aria-label="Toggle dark mode"
        >
          {isDark ? '☀️' : '🌙'}
        </button>
<<<<<<< HEAD
        <button
          onClick={signOut}
          title="Sign out"
          aria-label="Sign out"
          className="hidden md:inline-flex"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
            lineHeight: 1, borderRadius: 8, color: COLORS.textHint, alignItems: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = COLORS.red)}
          onMouseLeave={e => (e.currentTarget.style.color = COLORS.textHint)}
        >
          <LogOut size={16} />
        </button>
        {/* Active / Paused pill (moved up from the old in-page header) */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          border: `1px solid ${COLORS.border}`, borderRadius: 999, padding: '4px 10px',
          fontSize: 12, fontWeight: 600, flexShrink: 0,
          color: paused ? COLORS.red : COLORS.mint,
        }}>
          <span
            className={paused ? '' : 'animate-pulse'}
            style={{ width: 7, height: 7, borderRadius: '50%', background: paused ? COLORS.red : COLORS.mint, display: 'inline-block' }}
          />
          {paused ? 'Paused' : 'Active'}
        </span>
=======
>>>>>>> 611098d (feat: dark mode overrides, simplified settings UI, sidebar groups)
      </div>
    </header>
  );
}
