'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { ToastProvider, useToast } from '../ui/Toast';
import { COLORS, FONT } from '../../lib/design-tokens';
import { MiniMeLogo } from '../ui/MiniMeLogo';

// ─── Platform Feedback Widget ─────────────────────────────────────────────────
const CATEGORIES = [
  { key: 'bug',     label: '🐛 Bug report' },
  { key: 'feature', label: '✨ Feature idea' },
  { key: 'general', label: '💬 General' },
  { key: 'praise',  label: '🎉 Love it!' },
];

function FeedbackModal({ onClose }) {
  const { initData } = useTelegram() || {};
  const { toast } = useToast();
  const pathname = usePathname();
  const [nps, setNps] = useState(null);
  const [category, setCategory] = useState(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    if (!category) { toast('Please pick a category', { variant: 'error' }); return; }
    setSending(true);
    try {
      await fetch('/api/platform/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
        body: JSON.stringify({ nps_score: nps, category, note: note.trim(), page: pathname }),
      });
      toast('Thanks for your feedback! 🙏', { variant: 'success' });
      onClose();
    } catch { toast('Could not send — try again', { variant: 'error' }); }
    finally { setSending(false); }
  }, [category, nps, note, pathname, initData, toast, onClose]);

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
        background: '#fff', borderRadius: '20px 20px 0 0',
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
              <button key={c.key} onClick={() => setCategory(c.key)} style={{
                padding: '10px 12px', borderRadius: 10, textAlign: 'left',
                border: `1.5px solid ${category === c.key ? COLORS.teal : COLORS.border}`,
                background: category === c.key ? COLORS.teal + '12' : '#fff',
                color: category === c.key ? COLORS.teal : COLORS.textSecondary,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
              }}>{c.label}</button>
            ))}
          </div>
        </div>

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
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        style={{
          position: 'fixed', right: 16, bottom: 'calc(74px + env(safe-area-inset-bottom))',
          zIndex: 100, background: COLORS.ink, color: '#fff',
          border: 'none', borderRadius: 999, padding: '8px 14px',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
          boxShadow: '0 4px 16px rgba(14,40,35,0.25)',
          display: 'flex', alignItems: 'center', gap: 6,
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
    // Store token for API calls that support x-impersonate-token header
    sessionStorage.setItem('impersonate_token', t);
    // Parse payload (not verified client-side — server verifies on each request)
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

export default function DashboardShell({ children }) {
  const { loading, error, telegramUser, business } = useTelegram();
  const router = useRouter();
  const pathname = usePathname();
  const onOnboarding = pathname?.startsWith('/onboarding');

  // startapp=demo deep link → show the demo page inside Telegram.
  // Uses sessionStorage so navigating back from /demo doesn't loop.
  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const startParam = twa?.initDataUnsafe?.start_param;
    if (startParam === 'demo' && !sessionStorage.getItem('_demo_seen')) {
      sessionStorage.setItem('_demo_seen', '1');
      router.replace('/demo');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Always land on Home (/) when the Mini App opens fresh.
  // Telegram creates a new WebView each open, so this fires every time.
  // Skips sub-routes the user actively navigated to in the same session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('_navigated')) return; // user has navigated — don't override
    const path = window.location.pathname;
    const isDeepLink = path !== '/' && !path.startsWith('/onboarding') && !path.startsWith('/demo');
    if (isDeepLink) router.replace('/');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // New owners: redirect into the onboarding wizard.
  // A business needs onboarding if it has no linked bot token username.
  // We also allow skipping via "I'll do this later" (bot may not be linked yet
  // but business row exists — we only force onboarding on first open).
  useEffect(() => {
    if (loading || error || !telegramUser) return;
    const needsOnboarding = !business || !business.telegram_bot_username;
    if (needsOnboarding && !onOnboarding) router.replace('/onboarding');
  }, [loading, error, telegramUser, business?.telegram_bot_username, onOnboarding, router]);

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(ellipse at center, #14342E 0%, #0A1E1B 80%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT.body, overflow: 'hidden',
      }}>
        {/* Grain overlay */}
        <div className="grain" />
        {/* Logo */}
        <div className="mirror-reveal" style={{ marginBottom: 28 }}>
          <MiniMeLogo size={80} color="#F4EEE1" accent="#D4B987" />
        </div>
        {/* Wordmark */}
        <div className="fade-up delay-2" style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 300, fontStyle: 'italic', fontSize: 32, color: '#F4EEE1', letterSpacing: '-0.015em' }}>
            minime
          </div>
          <div className="fade-in delay-3" style={{ marginTop: 8, color: 'rgba(244,238,225,0.5)', letterSpacing: '0.16em', textTransform: 'uppercase', fontSize: 10 }}>
            your business, mirrored
          </div>
        </div>
        {/* Progress bar */}
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

  // While onboarding (no business yet OR no bot linked), render wizard bare —
  // no padding, no chrome. The onboarding screens manage their own full-screen layout.
  const needsOnboarding = !business || !business.telegram_bot_username;
  if (needsOnboarding) {
    return (
      <ToastProvider>
        <div style={{ position: 'fixed', inset: 0, fontFamily: FONT.body, overflowY: 'auto' }}>{children}</div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {/* position:fixed + inset:0 → truly fullscreen on every phone, including
          models where 100vh includes browser chrome that 100dvh doesn't */}
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT.body, width: '100%' }}>
        <ImpersonateBanner />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <DashboardTopBar business={business} telegramUser={telegramUser} />
          <main style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 16px',
            paddingBottom: 'max(96px, calc(80px + env(safe-area-inset-bottom)))',
            width: '100%',
            boxSizing: 'border-box',
          }}>{children}</main>
        </div>
        <MobileNav />
        </div>
        {/* Floating feedback button — always visible during beta */}
        <FeedbackButton />
      </div>
    </ToastProvider>
  );
}

function DashboardTopBar({ business, telegramUser }) {
  return (
    <header style={{
      height: 56,
      borderBottom: `1px solid ${COLORS.border}`,
      background: COLORS.surface,
      display: 'flex', alignItems: 'center',
      padding: '0 16px', gap: 12,
      flexShrink: 0,
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {business.name}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textHint, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{telegramUser.username || telegramUser.first_name}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {business.panic_mode && (
          <span style={{ fontSize: 11, background: COLORS.redLight, color: COLORS.red, border: `1px solid ${COLORS.red}40`, borderRadius: 999, padding: '2px 8px', fontWeight: 600 }}>
            PANIC
          </span>
        )}
        <span
          className="animate-pulse"
          style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.green, display: 'inline-block' }}
          title="MiniMe active"
        />
      </div>
    </header>
  );
}
