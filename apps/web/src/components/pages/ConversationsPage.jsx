'use client';
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';
import { isAmharic } from '../../lib/design-tokens';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD   = '#B08A4A';
const MINT   = '#4FA38A';
const LINE   = '#E4DED1';
const LINE2  = '#EEE9DE';
const MUTED  = '#8A9590';
const ERROR  = '#B85450';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const AMH    = "'Noto Sans Ethiopic', 'Geist', sans-serif";

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, hasDraft }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
      background: hasDraft ? '#E8D3A6' : CREAM2,
      display: 'grid', placeItems: 'center',
      fontFamily: SERIF, fontSize: 18,
      color: hasDraft ? '#5C4520' : INK,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

// ─── Thread row ───────────────────────────────────────────────────────────────
function ThreadRow({ c, last }) {
  const name      = c.customers?.name || 'Unknown';
  const hasDraft  = c.requires_owner && c.last_ai_action === 'drafted';
  const isUnread  = c.requires_owner;
  const hasFile   = !!c.last_file_url;
  const fileType  = c.last_file_type || '';
  const fileIcon  = fileType.startsWith('image') ? '🖼' : fileType.startsWith('video') ? '🎥' : '📎';

  const rawPreview  = c.last_preview || (c.last_ai_action === 'auto_sent' ? 'AI replied' : c.last_ai_action === 'drafted' ? 'Draft ready' : 'No activity');
  const previewText = hasFile
    ? `${fileIcon} Attachment`
    : (c.last_direction === 'outbound' ? `You: ${rawPreview}` : rawPreview);
  const isAmh = isAmharic(previewText);

  return (
    <Link href={`/conversations/${c.id}${hasDraft ? '?focusDraft=1' : ''}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ display: 'flex', gap: 12, padding: '12px 10px', alignItems: 'center' }}>
        <Avatar name={name} hasDraft={hasDraft} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{
                fontFamily: SERIF, fontSize: 16, color: INK,
                fontWeight: isUnread ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}
              </div>
              {hasDraft && (
                <span style={{
                  background: 'rgba(176,138,74,.12)', color: GOLD,
                  padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 500, flexShrink: 0,
                }}>
                  draft
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: MUTED, flexShrink: 0 }}>
              {timeAgo(c.last_message_at)}
            </div>
          </div>
          <div style={{
            marginTop: 3, fontSize: 13.5, color: isUnread ? '#4A5E5A' : MUTED,
            fontFamily: isAmh ? AMH : BODY,
            fontWeight: isUnread ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {previewText}
          </div>
        </div>
        {isUnread && !hasDraft && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: GOLD, flexShrink: 0, boxShadow: `0 0 0 3px rgba(176,138,74,.2)` }} />
        )}
      </div>
      {!last && <div style={{ height: 1, background: LINE2, marginLeft: 64, marginRight: 10 }} />}
    </Link>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyChats({ filter }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
      <div style={{ fontFamily: SERIF, fontSize: 22, color: INK }}>
        {filter === 'drafts' ? 'No drafts' : filter === 'unread' ? 'All read' : 'No conversations yet'}
      </div>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
        {filter === 'all' ? 'Customers who DM your bot will appear here.' : 'Try the All tab to see everything.'}
      </p>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          display: 'flex', gap: 12, padding: '14px 10px', alignItems: 'center',
          borderTop: i > 0 ? `1px solid ${LINE2}` : 'none',
          animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.15,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: CREAM2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: '40%', background: CREAM2, borderRadius: 6, marginBottom: 8 }} />
            <div style={{ height: 12, width: '65%', background: CREAM2, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const FILTERS = [
  { v: 'all',    label: 'All'    },
  { v: 'drafts', label: 'Drafts' },
  { v: 'unread', label: 'Unread' },
];

export default function ConversationsPage() {
  const { business } = useTelegram();
  const supabase = createClient();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [counts, setCounts]     = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);
  const [search, setSearch]     = useState('');
  const businessId = business?.id;
  const filterRef  = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  useEffect(() => {
    if (businessId) fetch_(businessId, filter);
  }, [filter, businessId]);

  // Realtime
  useEffect(() => {
    if (!businessId) return;
    const rt = createClient();
    const ch = rt.channel(`mm-convos-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${businessId}` }, () => {
        setLiveFlash(true); setTimeout(() => setLiveFlash(false), 1200);
        fetch_(businessId, filterRef.current);
      }).subscribe();
    return () => rt.removeChannel(ch);
  }, [businessId]); // eslint-disable-line

  async function fetch_(bizId, f) {
    setLoading(true);
    let q = supabase.from('conversations').select('*, customers(*)')
      .eq('business_id', bizId).order('last_message_at', { ascending: false }).limit(50);
    if (f === 'drafts') q = q.eq('requires_owner', true).eq('last_ai_action', 'drafted');
    if (f === 'unread') q = q.eq('requires_owner', true);
    const { data: convs } = await q;
    if (!convs?.length) { setConversations([]); setLoading(false); return; }

    // Enrich with last message preview + last file
    const ids = convs.map(c => c.id);
    const [{ data: lastMsgs }, { data: fileMsgs }] = await Promise.all([
      supabase.from('messages')
        .select('conversation_id, content, direction, file_url, media_url, file_type, media_type')
        .in('conversation_id', ids)
        .in('status', ['sent', 'drafted', 'approved'])
        .order('created_at', { ascending: false })
        .limit(ids.length * 3),
      supabase.from('messages')
        .select('conversation_id, file_url, file_type, media_url, media_type')
        .in('conversation_id', ids)
        .or('file_url.neq.null,media_url.neq.null')
        .order('created_at', { ascending: false })
        .limit(ids.length * 2),
    ]);
    const lastMsgMap = {};
    for (const m of lastMsgs || []) { if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m; }
    const fileMap = {};
    for (const m of fileMsgs || []) { if (!fileMap[m.conversation_id]) fileMap[m.conversation_id] = m; }
    const enriched = convs.map(c => {
      const lm = lastMsgMap[c.id];
      const hasFile = !!(fileMap[c.id]?.file_url || fileMap[c.id]?.media_url);
      return {
        ...c,
        last_file_url:  hasFile ? (fileMap[c.id]?.file_url || fileMap[c.id]?.media_url) : null,
        last_file_type: hasFile ? (fileMap[c.id]?.file_type || fileMap[c.id]?.media_type) : null,
        last_preview:   lm?.content || null,
        last_direction: lm?.direction || null,
      };
    });
    setConversations(enriched);

    if (f === 'all') {
      setCounts({
        all:    enriched.length,
        drafts: enriched.filter(c => c.requires_owner && c.last_ai_action === 'drafted').length,
        unread: enriched.filter(c => c.requires_owner).length,
      });
    }
    setLoading(false);
  }

  const q = search.trim().toLowerCase();
  const shown = q
    ? conversations.filter(c =>
        (c.customers?.name || '').toLowerCase().includes(q) ||
        (c.customers?.telegram_username || '').toLowerCase().includes(q))
    : conversations;

  const draftsCount = counts?.drafts ?? null;
  const hasDrafts   = draftsCount !== null && draftsCount > 0;

  return (
    <div style={{ background: PAPER, minHeight: '100vh', paddingBottom: 96, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <div style={{ background: PAPER, borderBottom: `1px solid ${LINE}`, padding: '20px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>Inbox</div>
            {draftsCount === null ? (
              <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>Chats</div>
            ) : hasDrafts ? (
              <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>
                <span style={{ color: GOLD }}>{draftsCount}</span>
                {' '}draft{draftsCount !== 1 ? 's' : ''} ready.
              </div>
            ) : (
              <div style={{ fontFamily: SERIF, fontSize: 28, letterSpacing: '-0.015em', color: INK }}>
                All caught up.
              </div>
            )}
          </div>
          {/* Live indicator */}
          <div style={{
            width: 7, height: 7, borderRadius: '50%', marginTop: 24, flexShrink: 0,
            background: liveFlash ? MINT : MINT,
            boxShadow: liveFlash ? `0 0 0 4px rgba(79,163,138,.25)` : `0 0 0 3px rgba(79,163,138,.15)`,
            transition: 'box-shadow 0.3s',
          }} />
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
          {FILTERS.map(({ v, label }) => {
            const active = filter === v;
            const count  = counts?.[v] ?? null;
            const isPending = v === 'drafts' && !active && count > 0;
            return (
              <button
                key={v}
                onClick={() => setFilter(v)}
                style={{
                  padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                  fontFamily: BODY, fontSize: 13, fontWeight: 500,
                  border: `1px solid ${active ? INK : isPending ? `rgba(176,138,74,.5)` : LINE}`,
                  background: active ? INK : '#fff',
                  color: active ? PAPER : isPending ? GOLD : INK,
                  display: 'flex', alignItems: 'center', gap: 5, transition: 'all .15s ease',
                }}
              >
                {label}
                {count !== null && count > 0 && (
                  <span style={{
                    fontSize: 10, padding: '1px 5px', borderRadius: 999,
                    background: active ? 'rgba(255,255,255,.2)' : isPending ? 'rgba(176,138,74,.15)' : CREAM2,
                    color: active ? PAPER : isPending ? GOLD : MUTED,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', paddingBottom: 12 }}>
          <Search size={15} color={MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 36, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
              fontSize: 13.5, fontFamily: BODY, color: INK,
              background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ padding: '14px 12px' }}>
        {loading ? <Skeleton /> : !shown.length ? <EmptyChats filter={filter} /> : (
          <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
            {shown.map((c, i) => <ThreadRow key={c.id} c={c} last={i === shown.length - 1} />)}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
