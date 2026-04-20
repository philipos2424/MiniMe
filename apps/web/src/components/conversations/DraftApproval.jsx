'use client';
import { useEffect, useState } from 'react';
import { Check, X, Sparkles } from 'lucide-react';
import { useSupabase } from '../../hooks/useSupabase';

export default function DraftApproval({ message }) {
  const supabase = useSupabase();
  const [action, setAction] = useState(null);

  async function approve() {
    if (action) return;
    setAction('approving');
    await supabase
      .from('messages')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', message.id);
    setAction('approved');
  }

  async function skip() {
    if (action) return;
    setAction('skipping');
    await supabase.from('messages').update({ status: 'skipped' }).eq('id', message.id);
    setAction('skipped');
  }

  useEffect(() => {
    function onKey(e) {
      if (action) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Only trigger if not typing in an input
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        approve();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (action === 'approved') {
    return (
      <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3 text-emerald-400 text-sm flex items-center gap-2">
        <Check size={16} /> Approved and sent
      </div>
    );
  }
  if (action === 'skipped') return null;

  const pct = Math.round((message.ai_confidence || 0) * 100);
  const confColor = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-gold' : 'bg-red-500';

  return (
    <div className="bg-yellow-900/10 border border-yellow-700/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-yellow-400 text-xs font-medium inline-flex items-center gap-1.5">
          <Sparkles size={12} /> MiniMe Draft
        </span>
        <span className="text-xs text-muted">{pct}% confidence</span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-bg overflow-hidden">
        <div
          className={`h-full ${confColor} transition-all`}
          style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
        />
      </div>

      <p className="text-body text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>

      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={!!action}
          className="flex-1 min-h-[44px] bg-emerald-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Check size={16} /> Approve & Send
        </button>
        <button
          onClick={skip}
          disabled={!!action}
          className="min-h-[44px] px-4 bg-card border border-border text-muted text-sm py-2.5 rounded-lg hover:text-body hover:border-gold/40 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <X size={16} /> Skip
        </button>
      </div>
      <p className="text-[11px] text-muted text-center">
        <kbd className="font-mono">Enter</kbd> to approve · <kbd className="font-mono">Esc</kbd> to skip
      </p>
    </div>
  );
}
