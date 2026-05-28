'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';
import { isAmharic } from '../../lib/design-tokens';
import { PlatformIcon, TelegramIcon, WhatsAppIcon, InstagramIcon, FacebookIcon, PLATFORM_COLORS, PLATFORM_LABELS } from '../ui/PlatformIcon';

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

// ─── Avatar (with optional platform overlay) ──────────────────────────────────
function Avatar({ name, hasDraft, platform }) {
  const showOverlay = platform && platform !== 'telegram' && PLATFORM_COLORS[platform];
  return (
    <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: hasDraft ? '#E8D3A6' : CREAM2,
        display: 'grid', placeItems: 'center',
        fontFamily: SERIF, fontSize: 18,
        color: hasDraft ? '#5C4520' : INK,
      }}>
        {(name || '?').trim().charAt(0).toUpperCase()}
      </div>
      {showOverlay && (
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', border: `2px solid ${PLATFORM_COLORS[platform]}`,
          display: 'grid', placeItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.1)',
        }}>
          <PlatformIcon platform={platform} size={10} color={PLATFORM_COLORS[platform]} />
        </div>
      )}
    </div>
  );
}

// Platform badge helper
const PLATFORM_BADGE = {
  whatsapp:  { icon: '📱', label: 'WhatsApp', color: '#25D366' },
  instagram: { icon: '📸', label: 'Instagram', color: '#E1306C' },
  facebook:  { icon: '👥', label: 'Facebook', color: '#1877F2' },
};

// ─── Thread row ───────────────────────────────────────────────────────────────
function ThreadRow({ c, last }) {
  const name      = c.customers?.name || 'Unknown';
  const hasDraft  = c.requires_owner && c.last_ai_action === 'drafted';
  const isUnread  = c.requires_owner;
  const hasFile   = !!c.last_file_url;
  const fileType  = c.last_file_type || '';
  const fileIcon  = fileType.startsWith('image') ? '🖼' : fileType.startsWith('video') ? '🎥' : '📎';
  const platform  = c.platform && c.platform !== 'telegram' ? PLATFORM_BADGE[c.platform] : null;

  const rawPreview  = c.last_preview || (c.last_ai_action === 'auto_sent' ? 'AI replied' : c.last_ai_action === 'drafted' ? 'Draft ready' : 'No activity');
  const previewText = hasFile
    ? `${fileIcon} Attachment`
    : (c.last_direction === 'outbound' ? `You: ${rawPreview}` : rawPreview);
  const isAmh = isAmharic(previewText);

  return (
    <Link href={`/conversations/${c.id}${hasDraft ? '?focusDraft=1' : ''}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ display: 'flex', gap: 12, padding: '12px 10px', alignItems: 'center' }}>
        <Avatar name={name} hasDraft={hasDraft} platform={c.platform} />
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
  const isAllClear = filter === 'drafts' || filter === 'unread';
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{isAllClear ? '✅' : '💬'}</div>
      <div style={{ fontFamily: SERIF, fontSize: 22, color: INK }}>
        {filter === 'drafts' ? 'All caught up!' : filter === 'unread' ? 'All read!' : 'No conversations yet'}
      </div>
      <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
        {isAllClear
          ? 'No pending messages right now. Take a break — MiniMe has it covered.'
          : 'Customers who DM your bot will appear here.'}
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

// ─── Platform filter chips ────────────────────────────────────────────────────
function PlatformChips({ conversations, active, onChange }) {
  // Count per platform
  const counts = { telegram: 0, whatsapp: 0, instagram: 0, facebook: 0 };
  for (const c of conversations || []) counts[c.platform || 'telegram']++;
  const distinctPlatforms = Object.values(counts).filter(n => n > 0).length;
  if (distinctPlatforms < 2) return null; // Don't clutter if only one channel in use

  const items = [
    { v: 'all',       label: 'All channels', Icon: null,           color: INK },
    { v: 'telegram',  label: 'Telegram',     Icon: TelegramIcon,   color: PLATFORM_COLORS.telegram },
    { v: 'whatsapp',  label: 'WhatsApp',     Icon: WhatsAppIcon,   color: PLATFORM_COLORS.whatsapp },
    { v: 'instagram', label: 'Instagram',    Icon: InstagramIcon,  color: PLATFORM_COLORS.instagram },
    { v: 'facebook',  label: 'Facebook',     Icon: FacebookIcon,   color: PLATFORM_COLORS.facebook },
  ].filter(i => i.v === 'all' || counts[i.v] > 0);

  return (
    <div style={{ display: 'flex', gap: 6, paddingBottom: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {items.map(({ v, label, Icon, color }) => {
        const isActive = active === v;
        const count = v === 'all' ? null : counts[v];
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              border: `1px solid ${isActive ? color : LINE}`,
              background: isActive ? color + '15' : '#fff',
              color: isActive ? color : INK,
              fontSize: 12, fontWeight: 500, fontFamily: BODY,
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all .15s',
            }}
          >
            {Icon && <Icon size={13} color={isActive ? color : MUTED} />}
            {label}
            {count !== null && count > 0 && (
              <span style={{ fontSize: 10, color: isActive ? color : MUTED, fontWeight: 600 }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const FILTERS = [
  { v: 'all',    label: 'All'    },
  { v: 'drafts', label: 'Drafts' },
  { v: 'unread', label: 'Unread' },
];

// ─── Bulk approve all drafts ─────────────────────────────────────────────────
function BulkApproveButton({ drafts, initData, onDone }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function approveAll() {
    if (busy || !initData || !drafts.length) return;
    setBusy(true);
    // Fetch all conversations in parallel, then approve all found drafts in parallel
    await Promise.all(
      drafts.slice(0, 20).map(async conv => {
        try {
          const r = await fetch(`/api/conversations/${conv.id}`, {
            headers: { 'x-telegram-init-data': initData },
          });
          const j = await r.json();
          const draft = (j.messages || []).find(m => m.status === 'drafted' && m.is_ai_generated);
          if (draft) {
            await fetch(`/api/messages/${draft.id}/approve`, {
              method: 'POST',
              headers: { 'x-telegram-init-data': initData },
            });
          }
        } catch {}
      })
    );
    setBusy(false);
    setDone(true);
    setTimeout(() => { setDone(false); onDone?.(); }, 1500);
  }

  if (done) return <span style={{ fontSize: 12, color: MINT, fontWeight: 600 }}>All sent ✓</span>;

  return (
    <button onClick={approveAll} disabled={busy} style={{
      border: 'none', borderRadius: 999,
      background: busy ? LINE : 'rgba(79,163,138,0.12)',
      color: busy ? MUTED : MINT,
      padding: '5px 12px', fontSize: 12, fontWeight: 600,
      cursor: busy ? 'default' : 'pointer', fontFamily: BODY,
    }}>
      {busy ? 'Sending…' : `Send all ${drafts.length}`}
    </button>
  );
}

export default function ConversationsPage() {
  const { business, initData } = useTelegram();
  const supabase = createClient();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading]   = useState(true);
  // ?filter=needs_reply from home tab → show drafts immediately
  const [filter, setFilter] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return new URLSearchParams(window.location.search).get('filter') === 'needs_reply' ? 'drafts' : 'all';
  });
  const [platformFilter, setPlatformFilter] = useState('all'); // 'all' | 'telegram' | 'whatsapp' | 'instagram' | 'facebook'
  const [counts, setCounts]     = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);
  const [search, setSearch]     = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);
  const [offset, setOffset]     = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 30;
  const businessId = business?.id;
  const filterRef  = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  useEffect(() => {
    if (businessId) { setOffset(0); fetch_(businessId, filter, 0, true); }
  }, [filter, businessId]); // eslint-disable-line

  // Debounced full-text search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!search.trim() || search.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      if (!initData) return;
      setSearchLoading(true);
      try {
        const r = await fetch(`/api/conversations/search?q=${encodeURIComponent(search.trim())}`, {
          headers: { 'x-telegram-init-data': initData },
        });
        const j = await r.json();
        setSearchResults(j.results || []);
      } catch {}
      setSearchLoading(false);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [search, initData]); // eslint-disable-line

  // Realtime subscription
  useEffect(() => {
    if (!businessId) return;
    const rt = createClient();
    const ch = rt.channel(`mm-convos-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${businessId}` }, () => {
        setLiveFlash(true); setTimeout(() => setLiveFlash(false), 1200);
        fetch_(businessId, filterRef.current, 0, true);
      }).subscribe();
    return () => rt.removeChannel(ch);
  }, [businessId]); // eslint-disable-line

  // Polling fallback — refresh list every 5 s so new messages always appear
  // even when Supabase Realtime isn't delivering (tables not in publication etc.)
  useEffect(() => {
    if (!businessId) return;
    const timer = setInterval(() => {
      fetch_(businessId, filterRef.current, 0, true, true); // silent=true → no loading spinner
    }, 5000);
    return () => clearInterval(timer);
  }, [businessId]); // eslint-disable-line

  async function fetch_(bizId, f, fromOffset = 0, replace = false, silent = false) {
    if (replace && !silent) setLoading(true); else if (!replace) setLoadingMore(true);
    let q = supabase.from('conversations').select('*, customers(*)')
      .eq('business_id', bizId)
      .order('last_message_at', { ascending: false })
      .range(fromOffset, fromOffset + PAGE_SIZE - 1);
    if (f === 'drafts') q = q.eq('requires_owner', true).eq('last_ai_action', 'drafted');
    if (f === 'unread') q = q.eq('requires_owner', true);
    const { data: convs } = await q;

    if (!convs?.length) {
      if (replace && !silent) setConversations([]);
      setHasMore(false);
      if (replace && !silent) setLoading(false); else if (!replace) setLoadingMore(false);
      return;
    }

    // Detect if there are more pages
    setHasMore(convs.length === PAGE_SIZE);

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

    setConversations(prev => replace ? enriched : [...prev, ...enriched]);

    if (f === 'all' && replace) {
      setCounts({
        all:    enriched.length,
        drafts: enriched.filter(c => c.requires_owner && c.last_ai_action === 'drafted').length,
        unread: enriched.filter(c => c.requires_owner).length,
      });
    }
    if (replace && !silent) setLoading(false); else if (!replace) setLoadingMore(false);
  }

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    await fetch_(businessId, filterRef.current, nextOffset, false);
  }

  const q = search.trim().toLowerCase();
  let shown = q
    ? conversations.filter(c =>
        (c.customers?.name || '').toLowerCase().includes(q) ||
        (c.customers?.telegram_username || '').toLowerCase().includes(q))
    : conversations;

  // Platform filter (applied AFTER search so search works across all platforms)
  if (platformFilter !== 'all') {
    shown = shown.filter(c => (c.platform || 'telegram') === platformFilter);
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {/* Bulk approve all drafts */}
            {hasDrafts && (
              <BulkApproveButton drafts={conversations.filter(c => c.requires_owner && c.last_ai_action === 'drafted')} initData={initData} onDone={() => fetch_(businessId, filterRef.current, 0, true)} />
            )}
            {/* Live indicator */}
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: MINT,
              boxShadow: liveFlash ? `0 0 0 4px rgba(79,163,138,.25)` : `0 0 0 3px rgba(79,163,138,.15)`,
              transition: 'box-shadow 0.3s',
            }} />
          </div>
        </div>

        {/* Platform filter chips — only show when there's more than 1 platform in use */}
        <PlatformChips conversations={conversations} active={platformFilter} onChange={setPlatformFilter} />

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
            placeholder="Search by name, message content…"
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
        {/* Full-text search results */}
        {search.trim().length >= 2 ? (
          searchLoading ? (
            <div style={{ textAlign: 'center', padding: 20, color: MUTED, fontSize: 13 }}>Searching…</div>
          ) : searchResults !== null ? (
            searchResults.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: MUTED }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>No results for "{search}"</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Try a different word or customer name</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{search}"
                </div>
                {searchResults.map(r => (
                  <Link key={r.id} href={`/conversations/${r.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: r.match ? 6 : 0 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', background: CREAM2, flexShrink: 0,
                          display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: 15, color: INK,
                        }}>{(r.customer_name || '?')[0].toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: INK }}>{r.customer_name}</div>
                          {r.customer_username && <div style={{ fontSize: 11, color: MUTED }}>@{r.customer_username}</div>}
                        </div>
                        {r.requires_owner && (
                          <span style={{ fontSize: 10, background: 'rgba(176,138,74,.12)', color: GOLD, padding: '2px 7px', borderRadius: 999, fontWeight: 500 }}>draft</span>
                        )}
                      </div>
                      {r.match && (
                        <div style={{
                          fontSize: 12.5, color: '#4A5E5A', background: CREAM, borderRadius: 8,
                          padding: '6px 10px', lineHeight: 1.45,
                        }}>
                          {r.match.direction === 'outbound' ? '🪞 ' : '💬 '}
                          <span dangerouslySetInnerHTML={{ __html: r.match.snippet.replace(
                            new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                            m => `<mark style="background:rgba(176,138,74,.25);padding:0 2px;border-radius:2px">${m}</mark>`
                          )}} />
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : null
        ) : loading ? <Skeleton /> : !shown.length ? <EmptyChats filter={filter} /> : (
          <>
            <div style={{ background: '#fff', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
              {shown.map((c, i) => <ThreadRow key={c.id} c={c} last={i === shown.length - 1} />)}
            </div>

            {/* Load more — only shown when there might be more and no search active */}
            {hasMore && !search.trim() && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  display: 'block', width: '100%', marginTop: 12,
                  background: 'transparent', border: `1px solid ${LINE}`,
                  borderRadius: 12, padding: '13px 0',
                  fontSize: 14, color: loadingMore ? MUTED : INK,
                  fontFamily: BODY, cursor: loadingMore ? 'default' : 'pointer',
                  fontWeight: 500, letterSpacing: '-0.01em',
                }}
              >
                {loadingMore ? 'Loading…' : 'Load more conversations'}
              </button>
            )}
          </>
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}
