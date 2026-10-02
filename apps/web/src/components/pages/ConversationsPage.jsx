'use client';
import { useEffect, useRef, useState } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';
import { Search, ArrowUpRight, BookOpen, MessageSquare, RefreshCw } from 'lucide-react';
import styles from './ConversationsPage.module.css';
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';
import { isAmharic } from '../../lib/design-tokens';
import { PlatformIcon, TelegramIcon, WhatsAppIcon, InstagramIcon, FacebookIcon, TikTokIcon, PLATFORM_COLORS } from '../ui/PlatformIcon';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK    = 'var(--ink)';
const PAPER  = 'var(--paper)';
const CREAM  = 'var(--cream)';
const CREAM2 = 'var(--cream-2)';
const GOLD   = 'var(--gold)';
const MINT   = 'var(--mint)';
const LINE   = 'var(--line)';
const LINE2  = 'var(--line-soft)';
const MUTED  = 'var(--muted)';
const ERROR  = 'var(--error)';
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
          background: 'var(--card)', border: `2px solid ${PLATFORM_COLORS[platform]}`,
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
  tiktok:    { icon: '🎵', label: 'TikTok', color: '#FE2C55' },
};

// ─── Thread row ───────────────────────────────────────────────────────────────
function ThreadRow({ c, last, reason }) {
  const name      = c.customers?.name || 'Customer';
  const hasDraft  = c.requires_owner && c.last_ai_action === 'drafted';
  const isUnread  = c.requires_owner;
  const tone      = reason ? REASON_TONE[reason.tone] : null;
  // An attachment can exist before its URL is stored, so trust the flag when
  // the server sends one and fall back to the URL for any older shape.
  const hasFile   = c.last_has_file ?? !!c.last_file_url;
  const fileType  = c.last_file_type || '';
  const fileIcon  = fileType.startsWith('image') ? '🖼' : fileType.startsWith('video') ? '🎥' : '📎';
  const platform  = c.platform && c.platform !== 'telegram' ? PLATFORM_BADGE[c.platform] : null;

  const rawPreview  = c.last_preview || (c.last_ai_action === 'auto_sent' ? 'AI replied' : c.last_ai_action === 'drafted' ? 'Draft ready' : 'No activity');
  const previewText = hasFile
    ? `${fileIcon} Attachment`
    : (c.last_direction === 'outbound' ? `You: ${rawPreview}` : rawPreview);
  const isAmh = isAmharic(previewText);

  return (
    <Link href={`/conversations/${c.id}${hasDraft ? '?focusDraft=1' : ''}`} className={styles.thread} data-intent="chats.conversation.open">
      <div style={{ display: 'flex', gap: 12, padding: '16px 14px', alignItems: 'center' }}>
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
              {reason ? (
                <span style={{
                  background: tone.bg, color: tone.color,
                  padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}>
                  {reason.label}
                </span>
              ) : hasDraft && (
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ background: 'var(--card)', border: `1px solid ${LINE2}`, borderRadius: 14, overflow: 'hidden' }}>
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
  const counts = { telegram: 0, whatsapp: 0, instagram: 0, facebook: 0, tiktok: 0 };
  for (const c of conversations || []) counts[c.platform || 'telegram']++;
  const distinctPlatforms = Object.values(counts).filter(n => n > 0).length;
  if (distinctPlatforms < 2) return null; // Don't clutter if only one channel in use

  const items = [
    { v: 'all',       label: 'All channels', Icon: null,           color: INK },
    { v: 'telegram',  label: 'Telegram',     Icon: TelegramIcon,   color: PLATFORM_COLORS.telegram },
    { v: 'whatsapp',  label: 'WhatsApp',     Icon: WhatsAppIcon,   color: PLATFORM_COLORS.whatsapp },
    { v: 'instagram', label: 'Instagram',    Icon: InstagramIcon,  color: PLATFORM_COLORS.instagram },
    { v: 'facebook',  label: 'Facebook',     Icon: FacebookIcon,   color: PLATFORM_COLORS.facebook },
    { v: 'tiktok',    label: 'TikTok',       Icon: TikTokIcon,     color: PLATFORM_COLORS.tiktok },
  ].filter(i => i.v === 'all' || counts[i.v] > 0);

  return (
    <div style={{ display: 'flex', gap: 6, paddingBottom: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {items.map(({ v, label, Icon, color }) => {
        const isActive = active === v;
        const count = v === 'all' ? null : counts[v];
        return (
          <button
            key={v}
            aria-pressed={isActive}
            onClick={() => onChange?.(v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 12px', minHeight: 44, borderRadius: 999,
              border: `1px solid ${isActive ? color : LINE}`,
              background: isActive ? CREAM : 'var(--card)',
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

// ─── Salesperson-style classification ─────────────────────────────────────────
// A conversation lands in exactly ONE section. Priority is top-down: an urgent
// chat that also has a draft shows under "Reply now", not "Needs your OK".
// last_intent / last_urgency / last_sentiment are stamped by the reply engine
// (src/lib/server/intent.js). They may be null on older rows — those safely
// fall through to "Needs your OK" (if the owner is required) or "Handled".
const BUY_INTENTS = new Set(['order', 'negotiation', 'payment', 'delivery']);

function waitingMinutes(c) {
  const t = c.last_message_at ? Date.parse(c.last_message_at) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60000)) : 0;
}

function classifyConversation(c) {
  if (!c.requires_owner) return 'handled';
  const hot = c.last_urgency === 'high'
    || c.last_intent === 'complaint'
    || ['angry', 'frustrated'].includes(c.last_sentiment)
    || (c.last_ai_action === 'drafted' && waitingMinutes(c) > 30);
  if (hot) return 'now';
  if (BUY_INTENTS.has(c.last_intent)) return 'buy';
  return 'ok';
}

// One short, plain-language chip explaining WHY a chat is where it is.
function reasonFor(c, section) {
  if (section === 'now') {
    if (c.last_urgency === 'high')        return { label: 'urgent', tone: 'red' };
    if (c.last_intent === 'complaint')    return { label: 'complaint', tone: 'red' };
    if (['angry','frustrated'].includes(c.last_sentiment)) return { label: 'upset', tone: 'red' };
    const m = waitingMinutes(c);
    return { label: m >= 60 ? `waiting ${Math.round(m/60)}h` : `waiting ${m}m`, tone: 'red' };
  }
  if (section === 'buy') {
    if (c.last_intent === 'order')       return { label: 'wants to order', tone: 'mint' };
    if (c.last_intent === 'payment')     return { label: 'ready to pay', tone: 'mint' };
    if (c.last_intent === 'negotiation') return { label: 'negotiating', tone: 'gold' };
    if (c.last_intent === 'delivery')    return { label: 'asking delivery', tone: 'gold' };
    return { label: 'buying signal', tone: 'mint' };
  }
  if (section === 'ok') {
    if (c.last_ai_action === 'drafted')  return { label: 'reply drafted', tone: 'gold' };
    return { label: 'needs you', tone: 'gold' };
  }
  return null;
}

const REASON_TONE = {
  red:  { color: '#B85450', bg: 'rgba(184,84,80,.1)' },
  mint: { color: '#3C8E77', bg: 'rgba(79,163,138,.12)' },
  gold: { color: '#B08A4A', bg: 'rgba(176,138,74,.12)' },
};

const SECTIONS = [
  { key: 'now',     emoji: '🔥', title: 'Reply now',     sub: 'These sound urgent — answer first.',          accent: ERROR },
  { key: 'buy',     emoji: '💰', title: 'Ready to buy',  sub: 'Showing buying signals — close the sale.',    accent: MINT  },
  { key: 'ok',      emoji: '✋', title: 'Needs your OK',  sub: 'Review the conversation and choose your next step.',   accent: GOLD  },
  { key: 'handled', emoji: '✅', title: 'Other conversations', sub: 'No owner attention currently requested.',    accent: MUTED },
];

export default function ConversationsPage() {
  const { business, initData, setPendingCount } = useTelegram();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading]   = useState(true);
  // Always load everything; the salesperson-style sections (Reply now / Ready to
  // buy / Needs your OK / Handled) do the triage that the old pills did, and put
  // the ?filter=needs_reply items at the very top automatically.
  const [filter, setFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all'); // 'all' | 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'tiktok'
  const [counts, setCounts]     = useState(null);
  const [liveFlash, setLiveFlash] = useState(false);
  const [search, setSearch]     = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchTimer = useRef(null);
  const [offset, setOffset]     = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const PAGE_SIZE = 30;
  const businessId = business?.id;
  const requestId = useRef(0);
  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; }, [filter]);

  useEffect(() => {
    setConversations([]);
    setOffset(0);
    if (businessId && initData) fetch_(businessId, filter, 0, true);
    return () => { requestId.current++; };
  }, [filter, businessId, initData]); // eslint-disable-line

  // Cancel obsolete requests so older results cannot overwrite a new query.
  useEffect(() => {
    const controller = new AbortController();
    clearTimeout(searchTimer.current);
    setSearchResults(null);
    setSearchError(false);
    if (search.trim().length < 2) { setSearchLoading(false); return; }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      if (!initData) { setSearchLoading(false); setSearchError(true); return; }
      try {
        const r = await fetch(`/api/conversations/search?q=${encodeURIComponent(search.trim())}`, {
          headers: { 'x-telegram-init-data': initData }, signal: controller.signal,
        });
        if (!r.ok) throw new Error('Search unavailable');
        const j = await r.json();
        if (!controller.signal.aborted) setSearchResults(j.results || []);
      } catch { if (!controller.signal.aborted) setSearchError(true); }
      finally { if (!controller.signal.aborted) setSearchLoading(false); }
    }, 350);
    return () => { clearTimeout(searchTimer.current); controller.abort(); };
  }, [search, initData]);

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
  }, [businessId, initData]); // eslint-disable-line

  // Polling fallback — refresh list every 5 s so new messages always appear
  // even when Supabase Realtime isn't delivering (tables not in publication etc.)
  useEffect(() => {
    if (!businessId || offset > 0) return;
    const timer = setInterval(() => {
      fetch_(businessId, filterRef.current, 0, true, true); // silent=true → no loading spinner
    }, 5000);
    return () => clearInterval(timer);
  }, [businessId, initData, offset]); // eslint-disable-line

  async function fetch_(bizId, f, fromOffset = 0, replace = false, silent = false) {
    const id = ++requestId.current;
    if (replace && !silent) setLoading(true); else if (!replace) setLoadingMore(true);
    const done = () => {
      setLoading(false);
      setLoadingMore(false);
    };

    // Read through the API, not the browser Supabase client: `anon` has no
    // grants on conversations/messages (RLS on, no policies), so querying them
    // from here always came back as a swallowed permission error and a full
    // inbox rendered as "No conversations yet". See /api/conversations.
    let page;
    try {
      const res = await fetch(
        `/api/conversations?filter=${encodeURIComponent(f)}&offset=${fromOffset}`,
        { headers: { 'x-telegram-init-data': initData } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      page = await res.json();
      if (id !== requestId.current) return false;
    } catch (err) {
      if (id !== requestId.current) return false;
      // Leave whatever is already on screen alone. Blanking the list on a
      // failed poll is what made a transport problem look like an empty inbox.
      console.error('[conversations] load failed:', err);
      setLoadError(true);
      done();
      return false;
    }
    if (replace) { setOffset(0); setLoadingMore(false); }
    setLoadError(false);

    const enriched = page.conversations || [];
    setHasMore(!!page.hasMore);

    if (!enriched.length) {
      if (replace) setConversations([]);
      if (page.counts) { setCounts(page.counts); setPendingCount?.(page.counts.drafts); }
      done();
      return true;
    }

    setConversations(prev => replace ? enriched : [...prev, ...enriched]);

    if (page.counts) {
      setCounts(page.counts);
      // Keep nav badge in sync — no round-trip to Home needed after approving here
      setPendingCount?.(page.counts.drafts);
    }
    done();
    return true;
  }

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    const loaded = await fetch_(businessId, filterRef.current, nextOffset, false);
    if (loaded) setOffset(nextOffset);
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

  return <ConversationsView channelConversations={conversations} conversations={shown} counts={counts} loading={loading} loadError={loadError}
    filter={filter} onFilter={setFilter} search={search} onSearch={setSearch}
    searchResults={searchResults} searchLoading={searchLoading} searchError={searchError}
    platformFilter={platformFilter} onPlatformFilter={setPlatformFilter}
    hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore}
    onRetry={() => fetch_(businessId, filterRef.current, 0, true)} liveFlash={liveFlash} />;
}

export function ConversationsView({ conversations = [], channelConversations, counts, loading, loadError, filter = 'all', onFilter,
  search = '', onSearch, searchResults, searchLoading, searchError, platformFilter = 'all', onPlatformFilter,
  hasMore, loadingMore, onLoadMore, onRetry, liveFlash }) {
  const buckets = { now: [], buy: [], ok: [], handled: [] };
  for (const c of conversations) buckets[classifyConversation(c)].push(c);
  const searching = search.trim().length >= 2;
  return <div className={styles.page}>
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>CUSTOMER CONVERSATIONS</p><h1>A clear view of every chat.</h1><p>Review what needs you. Keep the conversation moving.</p></div>
      <button className={styles.refresh} onClick={onRetry} disabled={loading} aria-label="Refresh conversations"><RefreshCw size={17}/><span>{liveFlash ? 'Updating' : 'Refresh'}</span></button>
    </header>
    <div className={styles.layout}>
      <section className={styles.inbox} aria-label="Inbox">
        <div className={styles.toolbar}>
          <label className={styles.search}><Search size={18}/><input type="search" value={search} onChange={e => onSearch?.(e.target.value)} aria-label="Search conversations" placeholder="Find a customer or message" /></label>
          <div className={styles.filters} aria-label="Conversation filters">{[['all','All chats'],['unread','Needs you'],['drafts','Review drafts']].map(([value,label]) => <button key={value} onClick={() => onFilter?.(value)} aria-pressed={filter === value} data-intent={`chats.filter.${value}`} disabled={searching}>{label}{value === 'drafts' && counts?.drafts > 0 && <span>{counts.drafts}</span>}</button>)}</div>
          {!searching && <PlatformChips conversations={channelConversations || conversations} active={platformFilter} onChange={onPlatformFilter} />}
          {searching && <p className={styles.hint}>Searching across all conversations and channels.</p>}
        </div>
        {loadError && !searching && <div role="alert" className={styles.error}>Couldn’t refresh your chats. {conversations.length ? 'Showing the last available conversations.' : 'Try loading them again.'}<button onClick={onRetry}>Try again</button></div>}
        <div className={styles.list}>
          {searching ? searchLoading ? <p className={styles.empty} role="status">Searching your conversations…</p> : searchError ? <div role="alert" className={styles.empty}><h2>Search is unavailable</h2><p>Try another search, or clear it to return to your inbox.</p><button onClick={() => onSearch?.('')}>Back to inbox</button></div> : searchResults?.length ? <>
            <p className={styles.hint}>{searchResults.length} matching conversations</p>
            {searchResults.map(r => <Link key={r.id} href={`/conversations/${r.id}`} className={styles.result}>
              <Avatar name={r.customer_name} /><div><strong>{r.customer_name || 'Customer'}</strong>{r.match && <p>{r.match.snippet}</p>}{r.requires_owner && <small>Needs your attention</small>}</div><ArrowUpRight size={17}/>
            </Link>)}
          </> : <div className={styles.empty}><Search size={28}/><h2>No matching conversations</h2><p>Try a different name or a word from the message.</p></div>
          : loading ? <div role="status" aria-label="Loading conversations"><Skeleton /></div>
          : !conversations.length && !loadError ? <div className={styles.empty}><MessageSquare size={30}/><h2>{filter === 'all' ? 'Your conversations start here.' : 'Nothing waiting in this view.'}</h2><p>{filter === 'all' ? 'Customer conversations will appear here when someone messages your connected channel.' : 'Switch to All chats to see the rest of your conversations.'}</p>{filter !== 'all' && <button onClick={() => onFilter?.('all')}>View all chats</button>}</div>
          : SECTIONS.map(section => buckets[section.key].length ? <section className={styles.group} key={section.key} aria-label={section.title}>
            <div className={styles.groupHeading}><h2>{section.title}</h2><span>{buckets[section.key].length}</span></div><p>{section.sub}</p>
            <div className={styles.rows}>{buckets[section.key].map((c,i,rows) => <ThreadRow key={c.id} c={c} last={i===rows.length-1} reason={reasonFor(c,section.key)}/>)}</div>
          </section> : null)}
          {!searching && hasMore && <button className={styles.loadMore} onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more conversations'}</button>}
        </div>
      </section>
      <aside className={styles.guide}><span className={styles.guideIcon}><MessageSquare size={23}/></span><p className={styles.eyebrow}>A LITTLE LESS BACK-AND-FORTH</p><h2>Good conversations<br/>start with good answers.</h2><p>Review urgent chats first. Open a conversation to check a draft, edit the answer, or reply yourself.</p><div className={styles.divider}/><BookOpen size={21}/><h3>Give MiniMe the details.</h3><p>Keep your prices, delivery information, and FAQs up to date.</p><Link href="/teach">Update knowledge <ArrowUpRight size={16}/></Link></aside>
    </div>
  </div>;
}
