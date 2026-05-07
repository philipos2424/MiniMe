'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '../../hooks/useSupabase';
import { timeAgo } from '../../lib/utils';

const SERIF = "'Fraunces', Georgia, serif";
const AMH = "'Noto Serif Ethiopic', serif";
const MONO = "'JetBrains Mono', monospace";

export default function LiveFeed({ businessId }) {
  const supabase = useSupabase();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('messages')
        .select('*, customers(name, telegram_username)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(8);
      setEvents(data || []);
    }
    load();

    const channel = supabase
      .channel('live-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `business_id=eq.${businessId}` },
        (payload) => setEvents(prev => [payload.new, ...prev.slice(0, 7)])
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [businessId]);

  if (!events.length) {
    return (
      <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, color: '#1A0F08', letterSpacing: '-0.01em' }}>
          Your shop is quiet.
        </div>
        <div style={{ fontFamily: AMH, fontSize: 13, color: '#8B2E1F', marginTop: 4 }}>ሱቅዎ ጸጥ ብሏል።</div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: '#8A7560', marginTop: 8 }}>
          Activity will appear here as customers message your bot.
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4 }}>
      {events.map((e, i) => {
        const name = e.customers?.name || (e.customers?.telegram_username ? `@${e.customers.telegram_username}` : 'Customer');
        const isInbound = e.direction === 'inbound';
        const isAi = e.is_ai_generated;
        const tag = isInbound ? 'IN' : isAi ? 'AI' : 'YOU';
        const tagColor = isInbound ? '#8A7560' : isAi ? '#8B2E1F' : '#3F5D3F';
        const isAmh = /[ሀ-፿]/.test(e.content || '');
        return (
          <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 16px', borderTop: i > 0 ? '1px solid #E8DFD0' : 'none' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', color: tagColor, padding: '2px 6px', background: tagColor + '14', borderRadius: 3, flexShrink: 0, marginTop: 2 }}>{tag}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#1A0F08', fontWeight: 500 }}>{name}</div>
              <div style={{ fontSize: 13, color: '#3D2817', marginTop: 1, fontFamily: isAmh ? AMH : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
                {(e.content || '').slice(0, 80)}
              </div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 10, color: '#8A7560', flexShrink: 0, marginTop: 4 }}>{timeAgo(e.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}
