'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../../../hooks/useSupabase';

const LEVELS = [
  { level: 0, emoji: '👁️', name: 'Shadow', am: 'ጥላ', color: '#6B7280', desc: 'Observe only. MiniMe watches but never drafts or sends anything.' },
  { level: 1, emoji: '✋', name: 'Supervised', am: 'ቁጥጥር', color: '#D97706', desc: 'Drafts every reply. You approve each one before it sends.' },
  { level: 2, emoji: '🤝', name: 'Trusted', am: 'ታማኝ', color: '#059669', desc: 'Auto-sends routine messages (>85% confidence). Flags complex ones.' },
  { level: 3, emoji: '🚀', name: 'Full Agent', am: 'ሙሉ ወኪል', color: '#7C3AED', desc: 'Handles everything. You review daily summary.' },
];

export default function TrustPage() {
  const supabase = useSupabase();
  const [business, setBusiness] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('businesses').select('id,trust_level').limit(1).single();
      setBusiness(data);
    }
    load();
  }, []);

  async function setLevel(level) {
    if (!business) return;
    await supabase.from('businesses').update({ trust_level: level, trust_promoted_at: new Date().toISOString() }).eq('id', business.id);
    setBusiness(p => ({ ...p, trust_level: level }));
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="font-display text-2xl text-gold-light">Trust Controls</h1>
      <p className="text-muted text-sm">Control how much autonomy MiniMe has. Start low and increase as you build confidence.</p>
      <div className="space-y-3">
        {LEVELS.map(l => (
          <button key={l.level} onClick={() => setLevel(l.level)} className={`w-full text-left bg-card border rounded-xl p-4 transition ${business?.trust_level === l.level ? 'border-gold' : 'border-border hover:border-muted'}`}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl">{l.emoji}</span>
              <span className="font-semibold" style={{ color: l.color }}>{l.name}</span>
              <span className="text-muted text-sm">({l.am})</span>
              {business?.trust_level === l.level && <span className="ml-auto text-xs bg-gold text-bg px-2 py-0.5 rounded">Active</span>}
            </div>
            <p className="text-muted text-sm pl-9">{l.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
