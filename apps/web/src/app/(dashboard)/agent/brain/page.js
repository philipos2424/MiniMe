'use client';
/**
 * Alfred's Brain — toggle autonomous mode + watch recent reasoning.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';

export default function BrainPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [enabled, setEnabled] = useState(null);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!initData) return;
    const r = await fetch('/api/agent/brain', { headers: { 'x-telegram-init-data': initData } });
    const j = await r.json();
    setEnabled(!!j.enabled);
    setRecent(j.recent || []);
  }, [initData]);

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function toggle() {
    if (!initData) return;
    setBusy(true);
    try {
      const r = await fetch('/api/agent/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const j = await r.json();
      setEnabled(!!j.enabled);
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-xl mx-auto pb-6">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-gold-light">Alfred's Brain</h1>
        <p className="text-muted text-sm mt-0.5">Autonomous reasoning mode</p>
      </header>

      {/* Toggle card */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-gold-light font-medium text-sm">
              Brain mode {enabled === null ? '…' : enabled ? 'ON' : 'OFF'}
            </p>
            <p className="text-muted text-xs mt-1 leading-relaxed">
              When ON, Alfred reasons each turn and picks its own tools — reply, ask, create job, brief supplier, notify you. When OFF, it follows the fixed pipeline.
            </p>
          </div>
          <button
            onClick={toggle}
            disabled={busy || enabled === null}
            className={`shrink-0 w-12 h-7 rounded-full transition relative ${enabled ? 'bg-gold' : 'bg-border'}`}
            aria-label="Toggle brain"
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-bg rounded-full transition ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      <h2 className="text-muted text-xs uppercase tracking-wider mb-2 px-1">Recent thoughts</h2>
      {recent.length === 0 ? (
        <div className="text-center py-8 text-muted text-sm">
          {enabled ? 'No thoughts yet — send Alfred a message to watch it think.' : 'Turn brain mode on to see Alfred reason.'}
        </div>
      ) : (
        <ul className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
          {recent.map(t => <ThoughtRow key={t.id} t={t} />)}
        </ul>
      )}
    </div>
  );
}

function ThoughtRow({ t }) {
  const time = new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const calls = Array.isArray(t.tool_calls) ? t.tool_calls : [];
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-gold-light text-sm font-medium truncate">{t.outcome || '—'}</span>
        <span className="text-muted text-[10px] tabular-nums flex-shrink-0">{date} · {time}</span>
      </div>
      <div className="text-muted text-[11px] mb-1">{t.trigger || 'trigger?'} · {t.duration_ms ? `${t.duration_ms}ms` : '—'}</div>
      {calls.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {calls.map((c, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
              c.result?.ok === false
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : 'bg-agent/10 border-agent/30 text-agent'
            }`}>
              {c.name}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
