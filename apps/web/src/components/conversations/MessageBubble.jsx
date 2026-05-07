'use client';
import { timeAgo, confidenceColor } from '../../lib/utils';
import { COLORS, FONT, RADII, isAmharic } from '../../lib/design-tokens';

export default function MessageBubble({ message }) {
  const isOwner = message.direction === 'outbound';
  const hasFile = !!(message.file_url || message.media_url);
  const fileType = message.file_type || message.media_type || '';
  const fileName = message.file_name || message.media_filename || 'Attachment';
  const fileUrl  = message.file_url  || message.media_url  || '';
  const isAmh    = isAmharic(message.content);

  return (
    <div style={{
      display: 'flex',
      justifyContent: isOwner ? 'flex-end' : 'flex-start',
      marginBottom: 6,
    }}>
      <div style={{
        maxWidth: '78%',
        background: isOwner ? COLORS.teal : COLORS.surface,
        border: isOwner ? 'none' : `1px solid ${COLORS.border}`,
        borderRadius: isOwner ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: hasFile ? '10px 12px' : '10px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {/* File / media attachment */}
        {hasFile && (
          <div style={{ marginBottom: message.content ? 8 : 0 }}>
            {fileType.startsWith('image/') ? (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                <img
                  src={fileUrl}
                  alt={fileName}
                  style={{
                    maxWidth: '100%', maxHeight: 280, borderRadius: 10,
                    display: 'block', objectFit: 'cover', cursor: 'pointer',
                  }}
                  onError={e => { e.currentTarget.style.display = 'none'; }}
                />
              </a>
            ) : fileType.startsWith('video/') ? (
              <video
                src={fileUrl}
                controls
                style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, display: 'block' }}
              />
            ) : (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: isOwner ? 'rgba(255,255,255,0.15)' : '#F3F4F6',
                  borderRadius: RADII.sm, padding: '10px 12px', textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 24 }}>
                  {fileType.includes('pdf') ? '📄' :
                   fileType.includes('audio') ? '🎵' :
                   fileType.includes('zip') || fileType.includes('rar') ? '🗜' : '📎'}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: isOwner ? '#FFFFFF' : COLORS.textPrimary, wordBreak: 'break-word' }}>
                    {fileName}
                  </div>
                  <div style={{ fontSize: 11, color: isOwner ? 'rgba(255,255,255,0.6)' : COLORS.textHint, marginTop: 1 }}>
                    Tap to open
                  </div>
                </div>
              </a>
            )}
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <p style={{
            margin: 0, fontSize: 15, lineHeight: 1.5,
            color: isOwner ? '#FFFFFF' : COLORS.textPrimary,
            fontFamily: isAmh ? FONT.amharic : FONT.body,
            wordBreak: 'break-word',
          }}>
            {message.content}
          </p>
        )}

        {/* Meta row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
          marginTop: 5, flexWrap: 'wrap',
        }}>
          {message.is_ai_generated && (
            <span style={{
              fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic', fontSize: 10,
              color: isOwner ? 'rgba(255,255,255,0.8)' : COLORS.teal,
            }}>
              MiniMe · {Math.round((message.ai_confidence || 0) * 100)}%
            </span>
          )}
          {message.owner_edited && (
            <span style={{ fontSize: 10, color: isOwner ? 'rgba(255,255,255,0.7)' : '#60A5FA', fontStyle: 'italic' }}>edited</span>
          )}
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: isOwner ? 'rgba(255,255,255,0.55)' : COLORS.textHint }}>
            {timeAgo(message.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
