'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { WhatsAppIcon, InstagramIcon, FacebookIcon, PLATFORM_COLORS } from '../../../../components/ui/PlatformIcon';

const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const FB_BLUE = '#1877F2';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const PLATFORMS = [
  {
    id: 'whatsapp',
    Icon: WhatsAppIcon,
    name: 'WhatsApp Business',
    color: PLATFORM_COLORS.whatsapp,
    idLabel: 'Phone Number ID',
    idHint: 'Found in Meta Business Manager → WhatsApp → Phone numbers',
    desc: 'Get every WhatsApp Business chat in MiniMe. MiniMe can draft and auto-reply just like Telegram.',
  },
  {
    id: 'instagram',
    Icon: InstagramIcon,
    name: 'Instagram DM',
    color: PLATFORM_COLORS.instagram,
    idLabel: 'Instagram Account ID',
    idHint: 'Your Instagram business account ID (Meta Business Manager → Accounts → Instagram)',
    desc: 'Direct messages from your Instagram business account land in MiniMe and follow your trust-level rules.',
  },
  {
    id: 'facebook',
    Icon: FacebookIcon,
    name: 'Facebook Page',
    color: PLATFORM_COLORS.facebook,
    idLabel: 'Page ID',
    idHint: 'Your Facebook Page ID (Page → About → Page ID)',
    desc: 'Page messages join your unified MiniMe inbox. Same access token as Instagram.',
  },
];

export default function ChannelsPage() {
  const { initData } = useTelegram() || {};
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', text }
  const [showAdvanced, setShowAdvanced] = useState(false);
  const searchParams = useSearchParams();

  const refresh = useCallback(async () => {
    if (!initData) return;
    setLoading(true);
    try {
      const r = await fetch('/api/settings/channels', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      setState(j);
    } catch {} finally { setLoading(false); }
  }, [initData]);

  // Handle OAuth redirect params
  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get('connected') === 'true') {
      const platforms = searchParams.get('platforms') || 'facebook';
      const pageName = searchParams.get('page_name');
      const parts = platforms.split(',').map(p => p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : p);
      setToast({
        type: 'success',
        text: `${parts.join(' & ')} connected!${pageName ? ` (${pageName})` : ''}`,
      });
      // Clean URL without reload
      window.history.replaceState({}, '', '/settings/channels');
    }
    const err = searchParams.get('error');
    if (err) {
      const detail = searchParams.get('detail') || '';
      const messages = {
        oauth_denied: 'You cancelled the Facebook login.',
        oauth_failed: detail || 'Connection failed. Please try again.',
        no_pages: detail || 'No Facebook Pages found. Create a Page first.',
        invalid_state: 'Session expired. Please try again.',
        missing_params: 'Something went wrong. Please try again.',
        business_not_found: 'Business not found.',
      };
      setToast({ type: 'error', text: messages[err] || detail || 'Connection failed.' });
      window.history.replaceState({}, '', '/settings/channels');
    }
  }, [searchParams]);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-dismiss toast after 6s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const fbConnected = state?.facebook?.connected;
  const igConnected = state?.instagram?.connected;

  function startOAuth() {
    if (!initData) return;
    const url = `/api/auth/meta?initData=${encodeURIComponent(initData)}`;
    // Open in system browser — OAuth redirect will bring them back
    const twa = window.Telegram?.WebApp;
    if (twa?.openLink) twa.openLink(window.location.origin + url);
    else window.open(url, '_blank');
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 0 120px', fontFamily: BODY, color: INK }}>
      <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
        Channels
      </h1>
      <p style={{ fontSize: 14, color: MUTED, marginBottom: 22, lineHeight: 1.5 }}>
        Connect WhatsApp, Instagram, and Facebook so every message lands in MiniMe.
        Your AI handles them all the same way as Telegram.
      </p>

      {/* Toast notification */}
      {toast && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontSize: 13, lineHeight: 1.4,
          background: toast.type === 'success' ? MINT + '15' : ERROR + '15',
          color: toast.type === 'success' ? MINT : ERROR,
          border: `1px solid ${toast.type === 'success' ? MINT + '30' : ERROR + '30'}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>{toast.type === 'success' ? '✅' : '⚠️'}</span>
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit', padding: 0 }}>×</button>
        </div>
      )}

      {/* OAuth connect card — shown when FB/IG not yet connected */}
      {!loading && !(fbConnected && igConnected) && (
        <div style={{
          background: '#fff', border: `1px solid ${FB_BLUE}30`, borderRadius: 14,
          padding: 20, marginBottom: 16,
          boxShadow: `0 4px 20px ${FB_BLUE}08`,
        }}>
          <div style={{ fontFamily: SERIF, fontSize: 18, color: INK, marginBottom: 6 }}>
            Connect Instagram & Facebook
          </div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 16 }}>
            One tap to link your Facebook Page and Instagram DMs.
            MiniMe will handle messages from both automatically.
          </div>
          <button onClick={startOAuth} style={{
            display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center',
            width: '100%', padding: '13px 20px',
            background: FB_BLUE, color: '#fff', border: 'none', borderRadius: 999,
            fontSize: 15, fontWeight: 600, fontFamily: BODY, cursor: 'pointer',
            boxShadow: `0 2px 12px ${FB_BLUE}30`,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Connect with Facebook
          </button>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, cursor: 'pointer', fontFamily: BODY }}
            >
              {showAdvanced ? '▾' : '▸'} Advanced: paste token manually
            </button>
          </div>
        </div>
      )}

      {/* Webhook setup card — show when advanced is open or WA needs it */}
      {(showAdvanced || (state && !fbConnected && !igConnected)) && <WebhookSetup state={state} />}

      {loading && <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading…</div>}

      {state && PLATFORMS.map(p => {
        // Hide IG/FB manual cards unless advanced mode or already connected
        const isMetaPlatform = p.id === 'instagram' || p.id === 'facebook';
        const platformConnected = state[p.id]?.connected;
        if (isMetaPlatform && !showAdvanced && !platformConnected) return null;
        return (
          <ChannelCard key={p.id} platform={p} state={state[p.id]} hasToken={state.has_access_token} initData={initData} onChange={refresh} />
        );
      })}
    </div>
  );
}

function WebhookSetup({ state }) {
  const [copied, setCopied] = useState('');
  if (!state?.webhook_url) return null;

  function copy(text, key) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  }

  return (
    <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>
        Step 1 — Configure Meta webhook
      </div>
      <div style={{ fontSize: 13, color: INK, lineHeight: 1.5, marginBottom: 12 }}>
        In <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{ color: GOLD, fontWeight: 500 }}>Meta App Dashboard</a> → Webhooks, paste:
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={state.webhook_url} readOnly style={inputStyle} />
        <button onClick={() => copy(state.webhook_url, 'url')} style={smallBtn}>{copied === 'url' ? '✓' : 'Copy'}</button>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>Webhook URL</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={state.verify_token_hint ? `META_VERIFY_TOKEN env (${state.verify_token_hint})` : 'Set META_VERIFY_TOKEN in Vercel env'} readOnly style={{ ...inputStyle, fontStyle: 'italic', color: MUTED }} />
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Verify token (set once in Vercel)</div>
    </div>
  );
}

function ChannelCard({ platform, state, hasToken, initData, onChange }) {
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState(state.phone_number_id || state.page_id || '');
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const { Icon, name, color, idLabel, idHint, desc } = platform;
  const connected = state.connected;

  async function save() {
    if (!id.trim()) { setErr('Enter the ID first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ platform: platform.id, id: id.trim(), access_token: accessToken.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      setMsg('Connected ✓');
      setAccessToken('');
      setEditing(false);
      onChange();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/settings/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'test', access_token: accessToken.trim() || undefined }),
      });
      const j = await r.json();
      if (j.ok) setMsg(`✓ Token works — account: ${j.account?.name || j.account?.id || 'verified'}`);
      else setErr(j.error || 'Test failed');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${name}?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/settings/channels?platform=${platform.id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': initData },
      });
      if (r.ok) { setEditing(false); setId(''); onChange(); }
    } catch {} finally { setBusy(false); }
  }

  return (
    <div style={{
      background: '#fff', border: `1px solid ${connected ? color + '40' : LINE}`,
      borderRadius: 14, padding: 18, marginBottom: 12,
      boxShadow: connected ? `0 4px 16px ${color}10` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: connected ? color + '15' : CREAM,
          display: 'grid', placeItems: 'center',
        }}>
          <Icon size={26} color={connected ? color : MUTED} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <div style={{ fontFamily: SERIF, fontSize: 17, color: INK }}>{name}</div>
            {connected ? (
              <span style={{ fontSize: 11, color: MINT, fontWeight: 600, background: MINT + '15', padding: '3px 9px', borderRadius: 999 }}>
                ✓ Connected
              </span>
            ) : (
              <span style={{ fontSize: 11, color: MUTED, padding: '3px 9px' }}>Not connected</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginTop: 4 }}>{desc}</div>
        </div>
      </div>

      {connected && !editing && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 12, color: MUTED }}>{idLabel}: <code style={{ background: CREAM, padding: '2px 8px', borderRadius: 6, color: INK, fontSize: 12 }}>{state.masked}</code></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(true)} style={smallBtnGhost}>Edit</button>
            <button onClick={disconnect} disabled={busy} style={smallBtnDanger}>Disconnect</button>
          </div>
        </div>
      )}

      {!connected && !editing && (
        <button onClick={() => setEditing(true)} style={{
          marginTop: 14, padding: '10px 18px', background: color, color: '#fff', border: 'none',
          borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: BODY,
        }}>
          Connect →
        </button>
      )}

      {editing && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${LINE}` }}>
          <label style={labelStyle}>{idLabel}</label>
          <input value={id} onChange={e => setId(e.target.value)} placeholder={idHint} style={inputStyle} />

          <label style={{ ...labelStyle, marginTop: 12 }}>Meta access token {hasToken ? '(already saved — leave blank to keep)' : ''}</label>
          <input
            type="password"
            value={accessToken}
            onChange={e => setAccessToken(e.target.value)}
            placeholder={hasToken ? 'Leave blank to reuse existing token' : 'Paste your Meta System User token'}
            style={inputStyle}
          />
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            Shared across WhatsApp, Instagram, Facebook. Encrypted in storage.
          </div>

          {msg && <div style={{ fontSize: 12, color: MINT, marginTop: 10, background: MINT + '10', padding: 8, borderRadius: 6 }}>{msg}</div>}
          {err && <div style={{ fontSize: 12, color: ERROR, marginTop: 10, background: ERROR + '10', padding: 8, borderRadius: 6 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={testConnection} disabled={busy} style={smallBtnGhost}>Test token</button>
            <button onClick={() => { setEditing(false); setErr(''); setMsg(''); }} style={smallBtnGhost}>Cancel</button>
            <button onClick={save} disabled={busy || !id.trim()} style={{ ...primaryBtn, background: busy ? MUTED : color, marginLeft: 'auto' }}>
              {busy ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 14px', border: `1px solid ${LINE}`, borderRadius: 10,
  fontSize: 14, fontFamily: BODY, color: INK, background: '#fff', outline: 'none',
};
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: MUTED,
  letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6,
};
const smallBtn = {
  padding: '8px 14px', background: INK, color: PAPER, border: 'none', borderRadius: 8,
  fontSize: 12, fontWeight: 500, fontFamily: BODY, cursor: 'pointer',
};
const smallBtnGhost = {
  padding: '8px 14px', background: '#fff', color: INK, border: `1px solid ${LINE}`, borderRadius: 8,
  fontSize: 12, fontWeight: 500, fontFamily: BODY, cursor: 'pointer',
};
const smallBtnDanger = {
  padding: '8px 14px', background: '#fff', color: ERROR, border: `1px solid ${ERROR}40`, borderRadius: 8,
  fontSize: 12, fontWeight: 500, fontFamily: BODY, cursor: 'pointer',
};
const primaryBtn = {
  padding: '10px 22px', color: '#fff', border: 'none', borderRadius: 999,
  fontSize: 13, fontWeight: 600, fontFamily: BODY, cursor: 'pointer',
};
