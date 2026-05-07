'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import MessageBubble from './MessageBubble';
import DraftApproval from './DraftApproval';
import EmptyState from '../ui/EmptyState';
import { MessageSquare, ArrowLeft, Paperclip } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

export default function ChatDetail({ conversation, messages }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'files'
  const draftBannerRef = useRef(null);

  const drafts = messages.filter(m => m.status === 'drafted' && m.is_ai_generated);
  const sent   = messages.filter(m => m.status !== 'drafted');

  // Auto-scroll to pending drafts when arriving via ?focusDraft=1
  useEffect(() => {
    if (searchParams.get('focusDraft') === '1' && drafts.length > 0 && draftBannerRef.current) {
      setTimeout(() => {
        draftBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect all files from messages
  const files = messages.filter(m => m.file_url || m.media_url).map(m => ({
    id: m.id,
    url: m.file_url || m.media_url,
    type: m.file_type || m.media_type || '',
    name: m.file_name || m.media_filename || 'Attachment',
    direction: m.direction,
    created_at: m.created_at,
  }));

  const customer = conversation.customers;
  const name = customer?.name || (customer?.telegram_username ? `@${customer.telegram_username}` : 'Client');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: COLORS.bg, fontFamily: FONT.body }}>
      {/* Header */}
      <header style={{
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.back()} style={{
          appearance: 'none', border: 'none', background: 'transparent',
          color: COLORS.teal, cursor: 'pointer', padding: '4px 2px',
          display: 'flex', alignItems: 'center',
        }}>
          <ArrowLeft size={22} />
        </button>

        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `linear-gradient(135deg, ${COLORS.teal}, #0F766E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#FFFFFF', fontFamily: "'Fraunces', Georgia, serif",
          fontWeight: 400, fontSize: 18, flexShrink: 0,
        }}>
          {name[0]?.toUpperCase() || '?'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 400, color: COLORS.textPrimary,
            fontFamily: "'Fraunces', Georgia, serif", letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {name}
          </div>
          <div style={{
            fontSize: 11, color: COLORS.textHint, marginTop: 1,
            fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
          }}>
            {conversation.message_count || messages.length} messages
            {files.length > 0 && ` · ${files.length} file${files.length > 1 ? 's' : ''}`}
          </div>
        </div>

        {files.length > 0 && (
          <button onClick={() => setActiveTab(t => t === 'files' ? 'chat' : 'files')} style={{
            appearance: 'none', border: 'none', cursor: 'pointer',
            background: activeTab === 'files' ? COLORS.tealLight : 'transparent',
            borderRadius: RADII.sm, padding: '6px 10px',
            display: 'flex', alignItems: 'center', gap: 5,
            color: activeTab === 'files' ? COLORS.teal : COLORS.textSecondary,
          }}>
            <Paperclip size={16} />
            <span style={{ fontSize: 12, fontWeight: 500 }}>{files.length}</span>
          </button>
        )}
      </header>

      {/* Pending drafts */}
      {drafts.length > 0 && (
        <div ref={draftBannerRef} style={{ padding: '12px 16px', background: '#FFFBEB', borderBottom: `1px solid #FDE68A` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D97706', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
            {drafts.length} pending approval
          </div>
          {drafts.map(d => <DraftApproval key={d.id} message={d} />)}
        </div>
      )}

      {/* Tabs: Chat / Files */}
      {files.length > 0 && (
        <div style={{ display: 'flex', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
          {[['chat', 'Chat'], ['files', `Files (${files.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setActiveTab(k)} style={{
              flex: 1, appearance: 'none', border: 'none', background: 'transparent',
              padding: '12px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              color: activeTab === k ? COLORS.teal : COLORS.textSecondary,
              borderBottom: activeTab === k ? `2px solid ${COLORS.teal}` : '2px solid transparent',
              fontFamily: FONT.body,
            }}>{l}</button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: 100 }}>
        {activeTab === 'chat' ? (
          sent.length ? (
            sent.map(m => <MessageBubble key={m.id} message={m} />)
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: COLORS.textHint, textAlign: 'center' }}>
              <MessageSquare size={36} strokeWidth={1.5} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontSize: 14 }}>No messages yet</div>
            </div>
          )
        ) : (
          <FilesGrid files={files} />
        )}
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>PHOTOS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 20 }}>
            {images.map(f => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '1', overflow: 'hidden', borderRadius: RADII.md }}>
                <img src={f.url} alt={f.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>FILES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {others.map(f => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: '12px 14px', boxShadow: SHADOW.card,
              }}>
                <span style={{ fontSize: 28 }}>
                  {f.type.includes('pdf') ? '📄' : f.type.includes('audio') ? '🎵' : f.type.includes('video') ? '🎥' : '📎'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                    {f.direction === 'inbound' ? 'From client' : 'Sent by you'} · {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ fontSize: 13, color: COLORS.teal, fontWeight: 500, flexShrink: 0 }}>Open →</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
