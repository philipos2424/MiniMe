'use client';
import { useState, useEffect } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { Bot, CheckCircle2, ExternalLink, Link2Off, Loader2, User, Store } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgConfirm, tgAlert } from '../../../../lib/utils';
import { extractToken, isValidBotToken, friendlyLinkError } from '../../../../lib/botToken';

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 14,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

export default function BotLinkPage() {
  const { business, setBusiness } = useTelegram();
  const [token, setToken] = useState('');
  const [workspaceType, setWorkspaceType] = useState(business?.workspace_type || 'personal');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pasteNote, setPasteNote] = useState('');

  const isLinked = !!business?.telegram_bot_username;

  // Returning from BotFather, the token is almost always still on the clipboard.
  // Auto-read it the moment the (unlinked) form shows so the owner doesn't have
  // to hunt for the field and long-press. Best-effort + silent — the Paste
  // button covers webviews that block programmatic clipboard reads.
  useEffect(() => {
    if (isLinked || token) return;
    let cancelled = false;
    (async () => {
      try {
        const t = extractToken(await navigator.clipboard?.readText());
        if (!cancelled && isValidBotToken(t)) setToken(t);
      } catch { /* permission denied / unsupported */ }
    })();
    return () => { cancelled = true; };
  }, [isLinked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pasteFromClipboard() {
    setPasteNote('');
    try {
      const t = extractToken(await navigator.clipboard.readText());
      if (isValidBotToken(t)) { setToken(t); setError(null); }
      else setPasteNote('No bot token found on your clipboard. Copy it from BotFather first, then tap Paste.');
    } catch {
      setPasteNote('Couldn’t read the clipboard here — long-press the box and tap Paste.');
    }
  }

  async function linkBot() {
    setLoading(true); setError(null); setResult(null);
    try {
      const initData = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData;
      if (!initData) { setError('Open this page inside Telegram to authenticate.'); return; }
      const res = await fetch('/api/bot/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ token: extractToken(token), workspace_type: workspaceType }),
      });
      const body = await res.json();
      if (!res.ok) { setError(friendlyLinkError(body.error)); return; }
      setResult(body);
      setToken('');
      // Update context with the newly linked bot info
      setBusiness(b => ({
        ...b,
        telegram_bot_username: body.bot?.username || b?.telegram_bot_username,
        telegram_bot_id: body.bot?.id || b?.telegram_bot_id,
        bot_linked_at: new Date().toISOString(),
        workspace_type: workspaceType,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fixCommands() {
    setLoading(true); setError(null);
    try {
      const initData = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData;
      const res = await fetch('/api/bot/fix-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Fix failed'); return; }
      setResult({ fixed: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function unlinkBot() {
    if (!(await tgConfirm('Unlink your bot? MiniMe will stop receiving its updates until you link again.'))) return;
    setLoading(true);
    try {
      const initData = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData;
      const res = await fetch('/api/bot/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      });
      if (res.ok) {
        setBusiness(b => ({ ...b, telegram_bot_username: null, telegram_bot_id: null, bot_linked_at: null }));
        setResult(null);
      }
    } finally {
      setLoading(false);
    }
  }

  const isSharedMode = !isLinked && !!business?.shop_code && business?.onboarding_completed;
  // Branded storefront link — previews as the owner's business, not "MiniMe".
  const _webBase = (process.env.NEXT_PUBLIC_APP_URL || 'https://web-theta-one-68.vercel.app').replace(/\/$/, '');
  const shopDeepLink = business?.shop_code ? `${_webBase}/shop/${business.shop_code}` : null;

  return (
    <div style={{ maxWidth: 640, fontFamily: FONT.body, color: COLORS.textPrimary, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Heading */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          <Bot size={24} /> Your Bot
        </h1>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>
          <span className="am">ቦት ያገናኙ</span><span className="am-sep"> · </span>Connect your own Telegram bot to MiniMe
        </p>
      </div>

      {/* Shared-mode status card */}
      {isSharedMode && shopDeepLink && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.teal}40`, borderRadius: RADII.lg, padding: 20, boxShadow: SHADOW.card }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={20} color={COLORS.green} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 15, color: COLORS.textPrimary, margin: 0 }}>Active via MiniMe</p>
              <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '4px 0 8px', lineHeight: 1.5 }}>
                Your customers reach you through @MiniMeAgentBot. Share this link:
              </p>
              <div style={{
                background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.md, padding: '8px 12px',
                fontSize: 12, fontFamily: 'monospace', color: COLORS.textPrimary,
                wordBreak: 'break-all', lineHeight: 1.6,
              }}>
                {shopDeepLink}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: business.name, text: `Chat with ${business.name}`, url: shopDeepLink });
                    } else if (navigator.clipboard) {
                      navigator.clipboard.writeText(shopDeepLink).then(() => tgAlert('Link copied!'));
                    }
                  }}
                  style={{
                    padding: '8px 14px', border: `1px solid ${COLORS.border}`,
                    borderRadius: RADII.md, background: COLORS.teal, color: '#fff',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT.body,
                  }}
                >
                  Share link
                </button>
                <a
                  href={shopDeepLink} target="_blank" rel="noreferrer"
                  style={{
                    padding: '8px 14px', border: `1px solid ${COLORS.border}`,
                    borderRadius: RADII.md, background: 'transparent',
                    color: COLORS.textSecondary, fontSize: 13, fontFamily: FONT.body,
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <ExternalLink size={14} /> Test link
                </a>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, fontSize: 13, color: COLORS.textSecondary }}>
            Want your own <strong>@YourShopBot</strong> username? Connect one below — both will work.
          </div>
        </div>
      )}

      {/* Linked state */}
      {isLinked && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.teal}40`, borderRadius: RADII.lg, padding: 20, boxShadow: SHADOW.card }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={20} color={COLORS.green} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 15, color: COLORS.textPrimary, margin: 0 }}>Linked</p>
              <p style={{ fontSize: 14, color: COLORS.textPrimary, margin: '4px 0 0' }}>@{business.telegram_bot_username}</p>
              <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0' }}>
                Since {new Date(business.bot_linked_at).toLocaleString()}
              </p>
            </div>
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 999, fontWeight: 600,
              background: workspaceType === 'personal' ? '#6366F122' : `${COLORS.teal}22`,
              color: workspaceType === 'personal' ? '#6366F1' : COLORS.teal,
            }}>
              {workspaceType === 'personal' ? '👤 Personal' : '🏪 Business'}
            </span>
          </div>
          {result?.fixed && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: `${COLORS.teal}15`, borderRadius: RADII.md, fontSize: 13, color: COLORS.teal, fontWeight: 500 }}>
              ✅ Commands are now only visible to you — customers see a clean chat.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <a
              href={`https://t.me/${business.telegram_bot_username}`}
              target="_blank" rel="noreferrer"
              style={{
                flex: 1, textAlign: 'center',
                background: COLORS.teal, color: '#FFF', fontWeight: 600,
                padding: '10px 0', borderRadius: RADII.md, textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                minHeight: 44, fontSize: 14, fontFamily: FONT.body,
              }}
            >
              <ExternalLink size={16} /> Open my bot
            </a>
            <button
              onClick={fixCommands}
              disabled={loading}
              title="Fix: hide owner commands from customers"
              style={{
                padding: '10px 14px', border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.md, background: 'transparent',
                color: COLORS.textSecondary, cursor: loading ? 'default' : 'pointer',
                minHeight: 44, fontSize: 13, fontFamily: FONT.body,
              }}
            >
              🔧 Fix commands
            </button>
            <button
              onClick={unlinkBot}
              disabled={loading}
              style={{
                padding: '10px 16px',
                border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
                background: 'transparent', color: COLORS.textHint,
                cursor: loading ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8,
                minHeight: 44, fontSize: 14, fontFamily: FONT.body,
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = COLORS.red; e.currentTarget.style.borderColor = COLORS.red + '60'; }}
              onMouseLeave={e => { e.currentTarget.style.color = COLORS.textHint; e.currentTarget.style.borderColor = COLORS.border; }}
            >
              <Link2Off size={16} /> Unlink
            </button>
          </div>
        </div>
      )}

      {/* Step 1: How to create a bot */}
      {!isLinked && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, boxShadow: SHADOW.card }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 14px' }}>1. Create a bot in 60 seconds</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.5 }}>
            <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: COLORS.teal, textDecoration: 'underline' }}>@BotFather <ExternalLink size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /></a> on Telegram.</li>
            <li>Send <code style={{ background: COLORS.bg, padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>/newbot</code>.</li>
            <li>Pick a name (e.g. <em>"Alem's Shop"</em>) and a username ending in <code style={{ background: COLORS.bg, padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>_bot</code>.</li>
            <li>BotFather will send you a token that looks like <code style={{ background: COLORS.bg, padding: '1px 6px', borderRadius: 4, fontSize: 10 }}>123456789:ABCdef…</code></li>
            <li>Copy the token and paste it below. ⬇️</li>
          </ol>
        </div>
      )}

      {/* Step 2: Workspace type + token form */}
      {!isLinked && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 20, boxShadow: SHADOW.card, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>2. Choose how you'll use it</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { type: 'personal', icon: User, label: 'Personal', am: 'ለግል ጥቅም', sub: 'Reminders, notes, Q&A, voice memos' },
              { type: 'business', icon: Store, label: 'Business', am: 'ለንግድ',    sub: 'Customers, products, suppliers, AI agent' },
            ].map(o => {
              const sel = workspaceType === o.type;
              return (
                <button
                  key={o.type}
                  onClick={() => setWorkspaceType(o.type)}
                  style={{
                    padding: 16, borderRadius: RADII.lg, textAlign: 'left',
                    border: `2px solid ${sel ? COLORS.teal : COLORS.border}`,
                    background: sel ? COLORS.tealLight : 'transparent',
                    cursor: 'pointer', fontFamily: FONT.body,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <o.icon size={24} color={sel ? COLORS.teal : COLORS.textHint} style={{ marginBottom: 8 }} />
                  <p style={{ fontWeight: 600, fontSize: 14, color: COLORS.textPrimary, margin: 0 }}>{o.label}</p>
                  <p style={{ fontSize: 12, color: COLORS.textHint, margin: '4px 0 0' }}>
                    <span className="am">{o.am}</span><span className="am-sep"> · </span>{o.sub}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Token input */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>
                3. Paste your BotFather token
              </label>
              <button
                type="button"
                onClick={pasteFromClipboard}
                style={{
                  appearance: 'none', border: `1px solid ${COLORS.teal}`, background: `${COLORS.teal}14`,
                  color: COLORS.teal, fontFamily: FONT.body, fontSize: 12.5, fontWeight: 600,
                  padding: '6px 14px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Paste token
              </button>
            </div>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="123456789:AA…"
              style={{ ...INPUT_BASE, fontFamily: 'monospace', fontSize: 13 }}
            />
            {pasteNote && (
              <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: '6px 0 0', lineHeight: 1.45 }}>{pasteNote}</p>
            )}
            <p style={{ fontSize: 11, color: COLORS.textHint, margin: '6px 0 0' }}>
              Your token is encrypted before it's saved. MiniMe only uses it to receive updates for your bot.
            </p>
          </div>

          {error && (
            <div style={{ background: COLORS.redLight, border: `1px solid ${COLORS.red}40`, borderRadius: RADII.md, padding: '10px 14px', fontSize: 13, color: COLORS.red }}>
              ❌ {error}
            </div>
          )}

          <button
            onClick={linkBot}
            disabled={loading || !isValidBotToken(token)}
            style={{
              width: '100%', minHeight: 44,
              background: (loading || !isValidBotToken(token)) ? COLORS.textHint : COLORS.teal,
              color: '#FFF', fontWeight: 600, padding: '10px 0',
              borderRadius: RADII.md, border: 'none', fontSize: 14,
              cursor: (loading || !isValidBotToken(token)) ? 'default' : 'pointer',
              fontFamily: FONT.body,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 0.15s',
            }}
          >
            {loading ? <><Loader2 size={16} className="animate-spin" /> Linking...</> : 'Link bot'}
          </button>
        </div>
      )}

      {/* Success result */}
      {result && (
        <div style={{ background: COLORS.greenLight, border: `1px solid ${COLORS.green}40`, borderRadius: RADII.lg, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontWeight: 700, color: COLORS.green, margin: 0 }}>✅ Bot linked!</p>
          <p style={{ fontSize: 14, color: COLORS.textPrimary, margin: 0, lineHeight: 1.5 }}>
            Open <a href={`https://t.me/${result.bot.username}`} target="_blank" rel="noreferrer" style={{ color: COLORS.teal, textDecoration: 'underline' }}>@{result.bot.username}</a> on Telegram and send it <code style={{ background: COLORS.bg, padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>/start</code>.
          </p>
        </div>
      )}

      {/* Info footer */}
      <div style={{ fontSize: 12, color: COLORS.textHint, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8 }}>
        <p style={{ margin: 0 }}>🔒 Tokens are encrypted at rest (AES-256-GCM).</p>
        <p style={{ margin: 0 }}>🌍 Webhook is served from <code style={{ background: COLORS.bg, padding: '0 4px', borderRadius: 4, fontSize: 11 }}>{typeof window !== 'undefined' ? window.location.origin : ''}/api/telegram/webhook/…</code></p>
        <p style={{ margin: 0 }}>💡 Switching workspace type? Unlink and re-link.</p>
      </div>
    </div>
  );
}
