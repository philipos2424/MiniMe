'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import ChatDetail from '../../../../components/conversations/ChatDetail';
import { COLORS, FONT } from '../../../../lib/design-tokens';

export default function ConversationDetailPage({ params }) {
  const { initData, loading: tgLoading, error: tgError } = useTelegram() || {};
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [err, setErr] = useState(null);
  const [fetched, setFetched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Track newest message we've seen so poll only fetches new ones
  const newestRef = useRef(null);

  // Initial load
  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/conversations/${params.id}`, {
          headers: { 'x-telegram-init-data': initData },
        });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
        const j = await r.json();
        if (cancelled) return;
        setConversation(j.conversation);
        setMessages(j.messages || []);
        setHasMore(!!j.has_more);
        const last = (j.messages || []).at(-1)?.created_at;
        if (last) newestRef.current = last;
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setFetched(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [params.id, initData]);

  // Poll for NEW messages only — never wipes loaded history
  useEffect(() => {
    if (!initData || !fetched) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      if (cancelled) return;
      try {
        const after = newestRef.current || '';
        const url = `/api/conversations/${params.id}${after ? `?after=${encodeURIComponent(after)}` : ''}`;
        const r = await fetch(url, { headers: { 'x-telegram-init-data': initData } });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const newMsgs = j.messages || [];
        if (!newMsgs.length) return;
        const last = newMsgs.at(-1)?.created_at;
        if (last) newestRef.current = last;
        setMessages(prev => {
          const ids = new Set(prev.map(m => m.id));
          const toAdd = newMsgs.filter(m => !ids.has(m.id));
          return toAdd.length ? [...prev, ...toAdd] : prev;
        });
        setConversation(j.conversation); // update status flags
      } catch {}
    }, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [params.id, initData, fetched]);

  // Load older messages (prepend)
  const loadOlder = useCallback(async () => {
    if (!initData || !messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0]?.created_at;
      const r = await fetch(`/api/conversations/${params.id}?before=${encodeURIComponent(oldest)}`, {
        headers: { 'x-telegram-init-data': initData },
      });
      if (!r.ok) return;
      const j = await r.json();
      const older = j.messages || [];
      if (!older.length) { setHasMore(false); return; }
      setMessages(prev => {
        const ids = new Set(prev.map(m => m.id));
        return [...older.filter(m => !ids.has(m.id)), ...prev];
      });
      setHasMore(!!j.has_more);
    } catch (e) {
      console.warn('loadOlder:', e.message);
    } finally {
      setLoadingOlder(false);
    }
  }, [initData, messages, loadingOlder, params.id]);

  const msgStyle = { padding: 16, fontSize: 14, fontFamily: FONT.body };

  if (tgLoading) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Loading…</div>;
  if (tgError)   return <div style={{ ...msgStyle, color: COLORS.red }}>Auth error: {tgError}</div>;
  if (!initData) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Open this page inside Telegram.</div>;
  if (err && !conversation) return (
    <div style={{ padding: 16, fontFamily: FONT.body }}>
      <p style={{ color: COLORS.red, fontSize: 14, margin: '0 0 4px' }}>Couldn't load chat.</p>
      <p style={{ color: COLORS.textHint, fontSize: 12, margin: 0 }}>{err}</p>
    </div>
  );
  if (!fetched) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Loading chat…</div>;
  if (!conversation) return <div style={{ ...msgStyle, color: COLORS.textHint }}>Chat not found.</div>;

  return (
    <ChatDetail
      conversation={conversation}
      messages={messages}
      hasMore={hasMore}
      loadingOlder={loadingOlder}
      onLoadOlder={loadOlder}
    />
  );
}
