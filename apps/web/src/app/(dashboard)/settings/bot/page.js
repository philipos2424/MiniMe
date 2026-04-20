'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';
import { Bot, CheckCircle2, Copy, ExternalLink, Link2Off, Loader2, User, Store } from 'lucide-react';

export default function BotLinkPage() {
  const supabase = useSupabase();
  const [business, setBusiness] = useState(null);
  const [token, setToken] = useState('');
  const [workspaceType, setWorkspaceType] = useState('personal');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('businesses')
        .select('id,name,telegram_bot_username,telegram_bot_id,bot_linked_at,workspace_type,plan')
        .limit(1)
        .single();
      setBusiness(data);
      if (data?.workspace_type) setWorkspaceType(data.workspace_type);
    }
    load();
  }, []);

  async function linkBot() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const initData = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData;
      if (!initData) {
        setError('Open this page inside Telegram to authenticate.');
        return;
      }
      const res = await fetch('/api/bot/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ token: token.trim(), workspace_type: workspaceType }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error + (body.detail ? `: ${JSON.stringify(body.detail)}` : ''));
        return;
      }
      setResult(body);
      setToken('');
      // Refresh business
      const { data } = await supabase
        .from('businesses')
        .select('id,name,telegram_bot_username,telegram_bot_id,bot_linked_at,workspace_type,plan')
        .limit(1)
        .single();
      setBusiness(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function unlinkBot() {
    if (!confirm('Unlink your bot? MiniMe will stop receiving its updates until you link again.')) return;
    setLoading(true);
    try {
      const initData = typeof window !== 'undefined' && window.Telegram?.WebApp?.initData;
      const res = await fetch('/api/bot/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      });
      if (res.ok) {
        setBusiness({ ...business, telegram_bot_username: null, telegram_bot_id: null, bot_linked_at: null });
        setResult(null);
      }
    } finally {
      setLoading(false);
    }
  }

  const isLinked = !!business?.telegram_bot_username;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl text-gold-light flex items-center gap-2">
          <Bot className="w-6 h-6" /> Your Bot
        </h1>
        <p className="text-muted text-sm mt-1">
          <span className="am">ቦት ያገናኙ</span><span className="am-sep"> · </span>Connect your own Telegram bot to MiniMe
        </p>
      </div>

      {/* Linked state */}
      {isLinked && (
        <div className="bg-card border border-gold/30 rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-gold-light">Linked</p>
              <p className="text-sm text-body mt-1">
                @{business.telegram_bot_username}
              </p>
              <p className="text-xs text-muted mt-1">
                Since {new Date(business.bot_linked_at).toLocaleString()}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${workspaceType === 'personal' ? 'bg-agent/20 text-agent' : 'bg-gold/20 text-gold'}`}>
              {workspaceType === 'personal' ? '👤 Personal' : '🏪 Business'}
            </span>
          </div>
          <div className="flex gap-2 pt-2">
            <a
              href={`https://t.me/${business.telegram_bot_username}`}
              target="_blank" rel="noreferrer"
              className="flex-1 text-center bg-gold text-bg font-semibold py-2 rounded-lg hover:bg-gold-light transition inline-flex items-center justify-center gap-2 min-h-[44px]"
            >
              <ExternalLink className="w-4 h-4" /> Open my bot
            </a>
            <button
              onClick={unlinkBot}
              disabled={loading}
              className="px-4 py-2 border border-border text-muted hover:text-red-400 hover:border-red-400/50 rounded-lg transition inline-flex items-center gap-2 min-h-[44px]"
            >
              <Link2Off className="w-4 h-4" /> Unlink
            </button>
          </div>
        </div>
      )}

      {/* How to create a bot */}
      {!isLinked && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-gold-light">1. Create a bot in 60 seconds</h2>
          <ol className="space-y-2 text-sm text-body list-decimal pl-5">
            <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-gold underline inline-flex items-center gap-1">@BotFather <ExternalLink className="w-3 h-3" /></a> on Telegram.</li>
            <li>Send <code className="bg-bg px-1.5 py-0.5 rounded text-xs">/newbot</code>.</li>
            <li>Pick a name (e.g. <i>"Alem's Shop"</i>) and a username ending in <code className="bg-bg px-1.5 py-0.5 rounded text-xs">_bot</code>.</li>
            <li>BotFather will send you a token that looks like <code className="bg-bg px-1.5 py-0.5 rounded text-[10px]">123456789:ABCdef…</code></li>
            <li>Copy the token and paste it below. ⬇️</li>
          </ol>
        </div>
      )}

      {/* Workspace type + token form */}
      {!isLinked && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-gold-light">2. Choose how you'll use it</h2>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setWorkspaceType('personal')}
              className={`p-4 rounded-xl border-2 transition text-left ${workspaceType === 'personal' ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/40'}`}
            >
              <User className={`w-6 h-6 mb-2 ${workspaceType === 'personal' ? 'text-gold' : 'text-muted'}`} />
              <p className="font-semibold text-body">Personal</p>
              <p className="text-xs text-muted mt-1">
                <span className="am">ለግል ጥቅም</span><span className="am-sep"> · </span>Reminders, notes, Q&A, voice memos
              </p>
            </button>
            <button
              onClick={() => setWorkspaceType('business')}
              className={`p-4 rounded-xl border-2 transition text-left ${workspaceType === 'business' ? 'border-gold bg-gold/10' : 'border-border hover:border-gold/40'}`}
            >
              <Store className={`w-6 h-6 mb-2 ${workspaceType === 'business' ? 'text-gold' : 'text-muted'}`} />
              <p className="font-semibold text-body">Business</p>
              <p className="text-xs text-muted mt-1">
                <span className="am">ለንግድ</span><span className="am-sep"> · </span>Customers, products, suppliers, AI agent
              </p>
            </button>
          </div>

          <div className="space-y-2 pt-2">
            <label className="text-sm text-gold-light font-semibold">3. Paste your BotFather token</label>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="123456789:AA…"
              className="w-full bg-bg border border-border rounded-lg px-3 py-3 text-body placeholder-muted font-mono text-sm focus:outline-none focus:border-gold min-h-[44px]"
            />
            <p className="text-xs text-muted">Your token is encrypted before it's saved. MiniMe only uses it to receive updates for your bot.</p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
              ❌ {error}
            </div>
          )}

          <button
            onClick={linkBot}
            disabled={loading || !token.trim()}
            className="w-full bg-gold text-bg font-semibold py-3 rounded-lg hover:bg-gold-light transition disabled:opacity-50 inline-flex items-center justify-center gap-2 min-h-[44px]"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Linking...</> : <>Link bot</>}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
          <p className="font-semibold text-emerald-300">✅ Bot linked!</p>
          <p className="text-sm text-body">
            Open <a href={`https://t.me/${result.bot.username}`} target="_blank" rel="noreferrer" className="text-gold underline">@{result.bot.username}</a> on Telegram and send it <code className="bg-bg px-1 rounded">/start</code>.
          </p>
        </div>
      )}

      {/* Info footer */}
      <div className="text-xs text-muted space-y-1 pt-2">
        <p>🔒 Tokens are encrypted at rest (AES-256-GCM).</p>
        <p>🌍 Webhook is served from <code className="bg-bg px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/api/telegram/webhook/…</code></p>
        <p>💡 Switching workspace type? Unlink and re-link.</p>
      </div>
    </div>
  );
}
