'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import MessageBubble from './MessageBubble';
import DraftApproval from './DraftApproval';
import { MessageSquare, ArrowLeft, Paperclip, Send, X as XIcon } from 'lucide-react';
import { useTelegram } from '../../context/TelegramContext';
import { createClient } from '../../lib/supabase-browser';

// ─── Tokens ──────────────────────────────────────────────────────────────────
const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const CREAM2= '#EDE6D6';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const LINE2 = '#EEE9DE';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

export default function ChatDetail({ conversation, messages: initialMessages }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initData, business } = useTelegram() || {};
  const [activeTab, setActiveTab] = useState('chat');
  const draftBannerRef = useRef(null);
  const [messages, setMessages] = useState(initialMessages);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyErr, setReplyErr] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const drafts = messages.filter(m => (m.status === 'drafted' || m.status === 'pending_approval') && m.is_ai_generated);
  const sent   = messages.filter(m => m.status !== 'drafted' && m.status !== 'pending_approval');

  // ── Realtime: subscribe to new messages in this conversation ──────────────
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${conversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, payload => {
        const newMsg = payload.new;
        setMessages(prev => {
          // Drop matching optimistic tmp- entry first
          const withoutTmp = prev.filter(m => {
            if (!m.id?.toString().startsWith('tmp-')) return true;
            // Remove tmp if direction and approximate time match
            return !(m.direction === newMsg.direction &&
              Math.abs(new Date(m.created_at) - new Date(newMsg.created_at)) < 5000);
          });
          // Avoid duplicates
          if (withoutTmp.some(m => m.id === newMsg.id)) return withoutTmp;
          return [...withoutTmp, newMsg];
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, payload => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversation.id]);

  useEffect(() => {
    if (searchParams.get('focusDraft') === '1' && drafts.length > 0 && draftBannerRef.current) {
      setTimeout(() => { draftBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setMessages(prev => {
      const hasTmp = prev.some(m => m.id?.toString().startsWith('tmp-'));
      if (hasTmp) {
        const realIds = new Set(initialMessages.map(m => m.id));
        const tmpMsgs = prev.filter(m => m.id?.toString().startsWith('tmp-'));
        return [...initialMessages, ...tmpMsgs.filter(m => !realIds.has(m.id))];
      }
      return initialMessages;
    });
  }, [initialMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !initData) return;
    if (f.size > 20 * 1024 * 1024) { setReplyErr('File too large (20 MB max)'); return; }
    setUploading(true); setReplyErr('');
    try {
      // Upload via server-side route (service-role key — no anon-key security exposure)
      const fd = new FormData();
      fd.append('file', f, f.name);
      const r = await fetch(`/api/conversations/${conversation.id}/upload`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
        body: fd,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      setPendingFile({
        url: j.url,
        type: j.type || f.type || 'application/octet-stream',
        name: j.name || f.name,
        localPreview: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
      });
    } catch (err) {
      setReplyErr(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const sendReply = useCallback(async () => {
    if ((!replyText.trim() && !pendingFile) || sending || !initData) return;
    setSending(true); setReplyErr('');
    const text = replyText.trim();
    const file = pendingFile;
    setReplyText(''); setPendingFile(null);
    const optimistic = {
      id: `tmp-${Date.now()}`, direction: 'outbound',
      content: text || (file ? `[${file.type?.split('/')[0] || 'file'}]` : ''),
      content_type: file ? (file.type?.startsWith('image/') ? 'photo' : 'document') : 'text',
      status: 'sent', is_ai_generated: false,
      file_url: file?.url || null, media_url: file?.url || null,
      file_type: file?.type || null, media_type: file?.type || null,
      file_name: file?.name || null, created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const r = await fetch(`/api/conversations/${conversation.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ text: text || undefined, file: file ? { url: file.url, type: file.type, name: file.name } : undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Send failed');
      if (j.message) setMessages(prev => prev.map(m => m.id === optimistic.id ? j.message : m));
    } catch (e) {
      setReplyErr(e.message);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setReplyText(text);
      if (file) setPendingFile(file);
    } finally {
      setSending(false);
    }
  }, [replyText, sending, initData, conversation.id, pendingFile]);

  const files = messages.filter(m => m.file_url || m.media_url).map(m => ({
    id: m.id, url: m.file_url || m.media_url,
    type: m.file_type || m.media_type || '',
    name: m.file_name || m.media_filename || 'Attachment',
    direction: m.direction, created_at: m.created_at,
  }));

  const customer = conversation.customers;
  const name = customer?.name || (customer?.telegram_username ? `@${customer.telegram_username}` : 'Client');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: PAPER, fontFamily: BODY, color: INK }}>

      {/* Header */}
      <header style={{
        background: PAPER, borderBottom: `1px solid ${LINE}`,
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.back()} style={{
          appearance: 'none', border: 'none', background: 'transparent',
          color: INK, cursor: 'pointer', padding: '4px 2px',
          display: 'flex', alignItems: 'center',
        }}>
          <ArrowLeft size={22} strokeWidth={1.5} />
        </button>

        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: CREAM2,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          fontFamily: SERIF, fontSize: 18, color: INK, fontWeight: 400,
        }}>
          {name[0]?.toUpperCase() || '?'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 400, color: INK,
            fontFamily: SERIF, letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 1, fontFamily: SERIF, fontStyle: 'italic' }}>
            {conversation.message_count || messages.length} messages
            {files.length > 0 && ` · ${files.length} file${files.length > 1 ? 's' : ''}`}
          </div>
        </div>

        {files.length > 0 && (
          <button onClick={() => setActiveTab(t => t === 'files' ? 'chat' : 'files')} style={{
            appearance: 'none', border: 'none', cursor: 'pointer',
            background: activeTab === 'files' ? CREAM2 : 'transparent',
            borderRadius: 8, padding: '6px 10px',
            display: 'flex', alignItems: 'center', gap: 5,
            color: activeTab === 'files' ? INK : MUTED,
            transition: 'background .15s',
          }}>
            <Paperclip size={16} strokeWidth={1.5} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{files.length}</span>
          </button>
        )}
      </header>

      {/* Pending drafts */}
      {drafts.length > 0 && (
        <div ref={draftBannerRef} style={{
          padding: '12px 16px',
          background: 'rgba(176,138,74,.07)',
          borderBottom: `1px solid rgba(176,138,74,.2)`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: GOLD, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: GOLD, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
            {drafts.length} pending approval
          </div>
          {drafts.map(d => <DraftApproval key={d.id} message={d} />)}
        </div>
      )}

      {/* Tabs: Chat / Files */}
      {files.length > 0 && (
        <div style={{ display: 'flex', background: PAPER, borderBottom: `1px solid ${LINE}` }}>
          {[['chat', 'Chat'], ['files', `Files (${files.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setActiveTab(k)} style={{
              flex: 1, appearance: 'none', border: 'none', background: 'transparent',
              padding: '12px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              fontFamily: BODY,
              color: activeTab === k ? INK : MUTED,
              borderBottom: activeTab === k ? `2px solid ${INK}` : '2px solid transparent',
            }}>{l}</button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: 140 }}>
        {activeTab === 'chat' ? (
          sent.length ? (
            <>
              {sent.map(m => <MessageBubble key={m.id} message={m} />)}
              <div ref={bottomRef} />
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: MUTED, textAlign: 'center' }}>
              <MessageSquare size={36} strokeWidth={1.2} style={{ marginBottom: 12, opacity: 0.35 }} />
              <div style={{ fontFamily: SERIF, fontSize: 16 }}>No messages yet</div>
            </div>
          )
        ) : (
          <FilesGrid files={files} />
        )}
      </div>

      {/* Reply bar */}
      {activeTab === 'chat' && (
        <div style={{
          position: 'fixed', bottom: 'calc(64px + env(safe-area-inset-bottom))', left: 0, right: 0, zIndex: 20,
          background: PAPER, borderTop: `1px solid ${LINE}`,
          padding: '10px 12px',
        }}>
          {replyErr && (
            <div style={{ fontSize: 12, color: ERROR, marginBottom: 6, padding: '0 4px' }}>{replyErr}</div>
          )}

          {/* Pending file chip */}
          {pendingFile && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: CREAM, border: `1px solid ${LINE}`,
              borderRadius: 12, padding: '6px 10px', marginBottom: 6,
            }}>
              {pendingFile.localPreview ? (
                <img src={pendingFile.localPreview} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} />
              ) : (
                <span style={{ fontSize: 22 }}>
                  {pendingFile.type?.includes('pdf') ? '📄' : pendingFile.type?.startsWith('audio/') ? '🎵' : pendingFile.type?.startsWith('video/') ? '🎥' : '📎'}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</div>
                <div style={{ fontSize: 10, color: MUTED }}>{pendingFile.type || 'file'}</div>
              </div>
              <button onClick={() => setPendingFile(null)} style={{
                appearance: 'none', border: 'none', background: 'transparent',
                cursor: 'pointer', color: MUTED, padding: 4, display: 'flex',
              }}>
                <XIcon size={14} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {/* Hidden file input */}
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf,audio/*,video/*" onChange={pickFile} style={{ display: 'none' }} />

            {/* Paperclip */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || sending}
              title="Attach file"
              style={{
                appearance: 'none', border: 'none', background: 'transparent',
                width: 40, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: uploading ? GOLD : MUTED, cursor: uploading || sending ? 'default' : 'pointer', flexShrink: 0,
              }}
            >
              <Paperclip size={19} strokeWidth={1.5} />
            </button>

            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={replyText}
              onChange={e => { setReplyText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              placeholder={pendingFile ? 'Add a caption…' : 'Reply to customer…'}
              rows={1}
              style={{
                flex: 1, appearance: 'none', resize: 'none', outline: 'none',
                border: `1px solid ${LINE}`, borderRadius: 999,
                padding: '10px 16px', fontSize: 14, fontFamily: BODY,
                color: INK, background: '#fff',
                lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
                boxSizing: 'border-box',
              }}
            />

            {/* Send */}
            <button
              onClick={sendReply}
              disabled={(!replyText.trim() && !pendingFile) || sending || uploading}
              style={{
                appearance: 'none', border: 'none', borderRadius: '50%',
                width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: (!replyText.trim() && !pendingFile) || sending || uploading ? LINE2 : INK,
                color: (!replyText.trim() && !pendingFile) || sending || uploading ? MUTED : '#fff',
                cursor: (!replyText.trim() && !pendingFile) || sending || uploading ? 'default' : 'pointer',
                flexShrink: 0, transition: 'all 0.15s',
              }}
            >
              <Send size={18} />
            </button>
          </div>

          <div style={{ fontSize: 11, color: MUTED, marginTop: 5, padding: '0 4px' }}>
            {uploading ? 'Uploading…' : 'Sends via Telegram · Shift+Enter for new line'}
          </div>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
    </div>
  );
}

function FilesGrid({ files }) {
  if (!files.length) return null;
  const images = files.filter(f => f.type.startsWith('image/'));
  const others  = files.filter(f => !f.type.startsWith('image/'));

  return (
    <div>
      {images.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Photos</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 20 }}>
            {images.map(f => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '1', overflow: 'hidden', borderRadius: 10 }}>
                <img src={f.url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>Files</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {others.map(f => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12,
                background: '#fff', border: `1px solid ${LINE2}`,
                borderRadius: 14, padding: '12px 14px',
              }}>
                <span style={{ fontSize: 26 }}>
                  {f.type.includes('pdf') ? '📄' : f.type.includes('audio') ? '🎵' : f.type.includes('video') ? '🎥' : '📎'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 400, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: SERIF }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {f.direction === 'inbound' ? 'From client' : 'Sent by you'} · {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: MUTED, fontWeight: 500, flexShrink: 0 }}>Open →</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
