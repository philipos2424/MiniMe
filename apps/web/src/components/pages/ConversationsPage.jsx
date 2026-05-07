'use client';
/**
 * Conversations (Messages tab) — redesigned with design tokens.
 * Filter tabs: all | pending | urgent | ai
 * Real-time: Supabase channel subscribes to conversations changes for this business.
 */
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import ChatList from '../conversations/ChatList';
import { COLORS, FONT, RADII } from '../../lib/design-tokens';

function ListSkeleton() {
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg,
      overflow: 'hidden',
    }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none',
          animation: 'pulse 1.5s infinite',
          opacity: 1 - i * 0.15,
        }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: COLORS.border, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: '50%', background: COLORS.border, borderRadius: 6, marginBottom: 8 }} />
            <div style={{ height: 12, width: '70%', background: COLORS.border, borderRadius: 6 }} />
          </div>
        </div>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

export default function ConversationsPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [counts, setCounts] = useState(null); // { all, pending, urgent, ai }
  const [liveFlash, setLiveFlash] = useState(false); // brief pulse when realtime fires
  const [search, setSearch] = useState('');
  const businessId = business?.id;

  // Keep a ref so the realtime callback always sees the current filter
  // without needing to re-subscribe when the tab changes.
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  useEffect(() => {
    if (businessId) fetchConversations(businessId, filter);
  }, [filter, businessId]);

  // ── Supabase realtime subscription ──────────────────────────────
  useEffect(() => {
    if (!businessId) return;
    const supabaseRt = createClient();
    const channel = supabaseRt
      .channel(`mm-convos-${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${businessId}` },
        () => {
          setLiveFlash(true);
          setTimeout(() => setLiveFlash(false), 1200);
          fetchConversations(businessId, filterRef.current);
        }
      )
      .subscribe();
    return () => { supabaseRt.removeChannel(channel); };
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchConversations(bizId, f) {
    setLoading(true);
    let q = supabase
      .from('conversations')
      .select('*, customers(*)')
      .eq('business_id', bizId)
      .order('last_message_at', { ascending: false })
      .limit(50);
    if (f === 'pending') q = q.eq('requires_owner', true);
    if (f === 'urgent')  q = q.eq('priority', 'urgent');
    if (f === 'ai')      q = q.eq('last_ai_action', 'auto_sent');
    const { data: convs } = await q;
    if (!convs?.length) { setConversations([]); setLoading(false); return; }

    // Enrich with last-message file metadata (one query, no N+1)
    const convIds = convs.map(c => c.id);
    const { data: fileMsgs } = await supabase
      .from('messages')
      .select('conversation_id, file_url, file_type, media_url, media_type, text')
      .in('conversation_id', convIds)
      .eq('direction', 'inbound')
      .or('file_url.neq.null,media_url.neq.null')
      .order('created_at', { ascending: false })
      .limit(convIds.length * 2);

    const fileMap = {};
    for (const m of fileMsgs || []) {
      if (!fileMap[m.conversation_id]) fileMap[m.conversation_id] = m;
    }

    const enriched = convs.map(c => ({
      ...c,
      last_file_url:  fileMap[c.id]?.file_url  || fileMap[c.id]?.media_url  || null,
      last_file_type: fileMap[c.id]?.file_type || fileMap[c.id]?.media_type || null,
      last_preview:   fileMap[c.id]?.text || null,
    }));
    setConversations(enriched);

    // Derive per-tab counts from the full 'all' fetch
    if (f === 'all') {
      setCounts({
        all:     enriched.length,
        pending: enriched.filter(c => c.requires_owner).length,
        urgent:  enriched.filter(c => c.priority === 'urgent').length,
        ai:      enriched.filter(c => c.last_ai_action === 'auto_sent').length,
      });
    }

    setLoading(false);
  }

  const TABS = [
    { v: 'all',     label: 'All' },
    { v: 'pending', label: 'Pending' },
    { v: 'urgent',  label: 'Urgent' },
    { v: 'ai',      label: 'AI handled' },
  ];

  const pendingCount = counts?.pending ?? null;
  const aiCount      = counts?.ai ?? 0;
  const hasPending   = pendingCount !== null && pendingCount > 0;

  // Client-side search filter
  const q = search.trim().toLowerCase();
  const shown = q
    ? conversations.filter(c =>
        (c.customers?.name || '').toLowerCase().includes(q) ||
        (c.customers?.telegram_username || '').toLowerCase().includes(q)
      )
    : conversations;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 90, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px 0' }}>

        {/* Dynamic hero */}
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          {/* Live indicator dot */}
          <div style={{ paddingTop: 6, flexShrink: 0 }}>
            <span title="Live" style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: liveFlash ? COLORS.teal : COLORS.green,
              boxShadow: liveFlash ? `0 0 0 4px ${COLORS.teal}30` : 'none',
              transition: 'box-shadow 0.3s, background 0.3s',
              marginRight: 8,
            }} />
          </div>
          <div style={{ flex: 1 }}>
          {pendingCount === null ? (
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>Chats</h1>
          ) : hasPending ? (
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              <span style={{ color: COLORS.teal }}>{pendingCount}</span>
              {' '}{pendingCount === 1 ? 'draft needs' : 'drafts need'} a tap.
            </h1>
          ) : (
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>
              All caught up ✓
            </h1>
          )}
          {aiCount > 0 && (
            <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '2px 0 0' }}>
              MiniMe handled {aiCount} automatically.
            </p>
          )}
          </div>{/* /flex:1 */}
        </div>{/* /hero row */}

        {/* Filter pills */}
        <div style={{
          display: 'flex', gap: 6, marginTop: 14, paddingBottom: 14,
          overflowX: 'auto', msOverflowStyle: 'none', scrollbarWidth: 'none',
          marginInline: -20, paddingInline: 20,
        }}>
          {TABS.map(({ v, label }) => {
            const isActive = filter === v;
            const count    = counts?.[v] ?? null;
            const isPending = v === 'pending' && !isActive && count > 0;
            return (
              <button
                key={v}
                onClick={() => setFilter(v)}
                style={{
                  flexShrink: 0, appearance: 'none',
                  padding: '6px 12px', borderRadius: 999,
                  background: isActive ? COLORS.textPrimary : 'transparent',
                  border: `1px solid ${isActive ? COLORS.textPrimary : isPending ? COLORS.amber + '80' : COLORS.border}`,
                  color: isActive ? '#FFFFFF' : isPending ? COLORS.amber : COLORS.textSecondary,
                  fontSize: 12, fontWeight: 500, fontFamily: FONT.body,
                  display: 'flex', alignItems: 'center', gap: 5,
                  cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                {label}
                {count !== null && count > 0 && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 999, fontFamily: 'monospace',
                    background: isActive ? 'rgba(255,255,255,0.2)' : isPending ? COLORS.amber + '22' : COLORS.bg,
                    color: isActive ? '#FFFFFF' : isPending ? COLORS.amber : COLORS.textHint,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div style={{ paddingBottom: 12, paddingTop: 4, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: COLORS.textHint, pointerEvents: 'none' }}>🔍</span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              fontSize: 13, color: COLORS.textPrimary, fontFamily: FONT.body,
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.lg, outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = COLORS.teal}
            onBlur={e => e.target.style.borderColor = COLORS.border}
          />
        </div>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {loading ? <ListSkeleton /> : <ChatList conversations={shown} />}
      </div>
    </div>
  );
}
