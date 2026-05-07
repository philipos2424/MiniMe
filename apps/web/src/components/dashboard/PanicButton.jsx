'use client';
import { useState } from 'react';
import { useSupabase } from '../../hooks/useSupabase';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

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

  const active = business.panic_mode;

  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        padding: '8px 16px',
        minHeight: 44,
        borderRadius: RADII.md,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: FONT.body,
        cursor: loading ? 'default' : 'pointer',
        opacity: loading ? 0.5 : 1,
        border: active ? 'none' : `1px solid ${COLORS.border}`,
        background: active ? COLORS.red : 'transparent',
        color: active ? '#FFF' : COLORS.textHint,
        transition: 'background 0.15s, color 0.15s, border-color 0.15s',
      }}
    >
      {active ? '🔴 Resume MiniMe' : '🚨 Panic Mode'}
    </button>
  );
}
