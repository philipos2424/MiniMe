'use client';
import { useState } from 'react';
import { timeAgo } from '../../lib/utils';
import { isAmharic } from '../../lib/design-tokens';

const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const AMH   = "'Noto Sans Ethiopic', 'Geist', sans-serif";

function resolveFileType(msg) {
  const explicit = msg.file_type || msg.media_type || '';
  if (explicit.includes('/')) return explicit;
  const ct = msg.content_type || msg.telegram_file_type || '';
  if (ct === 'photo' || ct === 'image') return 'image/jpeg';
  if (ct === 'voice') return 'audio/ogg';
  if (ct === 'video') return 'video/mp4';
  if (ct === 'document') {
    const fn = (msg.file_name || msg.telegram_file_name || '').toLowerCase();
    if (fn.endsWith('.pdf')) return 'application/pdf';
    if (fn.endsWith('.jpg') || fn.endsWith('.jpeg') || fn.endsWith('.png')) return `image/${fn.split('.').pop()}`;
    return 'application/octet-stream';
  }
  return explicit;
}

export default function MessageBubble({ message }) {
  const isOwner = message.direction === 'outbound';
  const isTmp   = message.id?.toString().startsWith('tmp-');
  const hasFile = !!(message.file_url || message.media_url);
  const fileType = resolveFileType(message);
  const fileName = message.file_name || message.media_filename || message.telegram_file_name || 'Attachment';
  const fileUrl  = message.file_url  || message.media_url  || '';
  const isAmh    = isAmharic(message.content);
  const [showFullTime, setShowFullTime] = useState(false);

  const fullTime = message.created_at
    ? new Date(message.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOwner ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '82%',
        background: isOwner ? 'var(--accent, #1F6B52)' : 'var(--card, #FFFFFF)',
        color: isOwner ? '#FFFFFF' : 'var(--ink, #0A211A)',
        border: isOwner ? 'none' : '1px solid var(--line-soft, #EFEBE0)',
        borderRadius: isOwner ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: hasFile ? '10px 12px' : '10px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        opacity: isTmp ? 0.7 : 1,
        transition: 'opacity 0.3s',
      }}>
        {hasFile && (
          <div style={{ marginBottom: message.content ? 8 : 0 }}>
            {fileType.startsWith('image/') ? (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <img
                  src={fileUrl} alt={fileName}
                  style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 10, display: 'block', objectFit: 'cover', cursor: 'pointer' }}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              </a>
            ) : fileType.startsWith('video/') ? (
              <video src={fileUrl} controls style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, display: 'block' }} />
            ) : (
              <a href={fileUrl} target="_blank" rel="noreferrer" style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: isOwner ? 'rgba(255,255,255,0.15)' : 'var(--cream-2, #ECE6D6)',
                borderRadius: 8, padding: '10px 12px', textDecoration: 'none',
              }}>
                <span style={{ fontSize: 22 }}>
                  {fileType.includes('pdf') ? '📄' : fileType.includes('audio') ? '🎵' : fileType.includes('zip') || fileType.includes('rar') ? '🗜' : '📎'}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: isOwner ? '#FFFFFF' : 'var(--ink, #0A211A)', wordBreak: 'break-word' }}>{fileName}</div>
                  <div style={{ fontSize: 11, color: isOwner ? 'rgba(255,255,255,0.7)' : 'var(--muted, #7E8C86)', marginTop: 1 }}>Tap to open</div>
                </div>
              </a>
            )}
          </div>
        )}

        {message.content && (
          <p style={{
            margin: 0, fontSize: 14.5, lineHeight: 1.5,
            color: isOwner ? '#FFFFFF' : 'var(--ink, #0A211A)',
            fontFamily: isAmh ? AMH : BODY,
            wordBreak: 'break-word',
          }}>
            {message.content}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
          {message.is_ai_generated && (
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 10, color: isOwner ? 'rgba(255,255,255,0.75)' : 'var(--mint, #2E9E7E)' }}>
              MiniMe · {Math.round((message.ai_confidence || 0) * 100)}%
            </span>
          )}
          {message.owner_edited && (
            <span style={{ fontSize: 10, color: isOwner ? 'rgba(255,255,255,0.75)' : '#60A5FA', fontStyle: 'italic' }}>edited</span>
          )}
          <span
            onClick={() => setShowFullTime(v => !v)}
            style={{ fontSize: 10, color: isOwner ? 'rgba(255,255,255,0.65)' : 'var(--muted, #7E8C86)', cursor: 'pointer' }}
            title={fullTime}
          >
            {showFullTime && fullTime ? fullTime : timeAgo(message.created_at)}
          </span>
          {isOwner && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginLeft: 1 }}>
              {isTmp ? '○' : message.status === 'delivered' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
