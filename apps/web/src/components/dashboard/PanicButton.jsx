'use client';
import { useState } from 'react';
import { useSupabase } from '../../hooks/useSupabase';

export default function PanicButton({ business, onUpdate }) {
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const newMode = !business.panic_mode;
    await supabase.from('businesses').update({ panic_mode: newMode, panic_activated_at: newMode ? new Date().toISOString() : null }).eq('id', business.id);
    onUpdate(p => ({ ...p, panic_mode: newMode }));
    setLoading(false);
  }

  return (
    <button onClick={toggle} disabled={loading} className={`px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold transition disabled:opacity-50 ${business.panic_mode ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-card border border-border text-muted hover:border-red-500 hover:text-red-400'}`}>
      {business.panic_mode ? '🔴 Resume MiniMe' : '🚨 Panic Mode'}
    </button>
  );
}
