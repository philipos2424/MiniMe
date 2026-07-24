'use client';
/**
 * ChatList — conversation list rows, redesigned with design tokens.
 * Shows file indicator (📎) when the last message has an attachment.
 */
import Link from 'next/link';
import { timeAgo } from '../../lib/utils';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const ACTION_ICON = {
  auto_sent:    '🤖',
  drafted:      '✍️',
  escalated:    '⚠️',
  observed:     '👁️',
  approved:     '✅',
  scam_flagged: '🛡️',
  order_created:'🛒',
  asked_owner:  '🤔',
  owner_answered:'✅',
};

const ACTION_LABEL = {
  auto_sent:    'AI replied',
  drafted:      'Draft ready',
  escalated:    'Needs you',
  observed:     'Watching',
  approved:     'You replied',
  scam_flagged: 'Scam blocked',
  order_created:'New order',
  asked_owner:  "MiniMe doesn't know this one",
  owner_answered:'You answered',
};

function EmptyChats() {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, padding: '48px 24px', textAlign: 'center',
      boxShadow: SHADOW.card,
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary }}>No messages yet</div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
        Customers who DM your bot will appear here.
      </div>
    </div>
  );
}

export default function ChatList({ conversations }) {
  if (!conversations || !conversations.length) return <EmptyChats />;

  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card,
    }}>
      {conversations.map((c, idx) => {
        const name     = c.customers?.name || 'Unknown';
        const letter   = name.charAt(0).toUpperCase();
        const action   = c.last_ai_action;
        const hasFile  = !!c.last_file_url;
        const fileType = c.last_file_type || '';
        const fileIcon = fileType.startsWith('image') ? '🖼' : fileType.startsWith('video') ? '🎥' : '📎';

        return (
          <div key={c.id} style={{ borderTop: idx > 0 ? `1px solid ${COLORS.border}` : 'none' }}>
            <Link href={`/conversations/${c.id}`} style={{ textDecoration: 'none' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = COLORS.border + '30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: '50%',
                  background: COLORS.teal + '20',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: COLORS.teal, fontFamily: "'Fraunces', Georgia, serif",
                  fontWeight: 400, fontSize: 18,
                  flexShrink: 0,
                }}>
                  {letter}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{
                      fontFamily: "'Fraunces', Georgia, serif", fontStyle: 'italic',
                      fontSize: 15, fontWeight: 400, color: COLORS.textPrimary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {name}
                    </span>
                    <span style={{ fontSize: 11, color: COLORS.textHint, flexShrink: 0, fontFamily: 'monospace' }}>
                      {timeAgo(c.last_message_at)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    {action && (
                      <span style={{ fontSize: 12 }}>{ACTION_ICON[action] || ''}</span>
                    )}
                    {hasFile && (
                      <span style={{ fontSize: 12 }}>{fileIcon}</span>
                    )}
                    <span style={{ fontSize: 12, color: COLORS.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {action ? (ACTION_LABEL[action] || action.replace(/_/g, ' ')) : 'No activity'}
                    </span>
                    {c.requires_owner && (
                      <span style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 999,
                        background: '#FEF3C7', color: '#92400E',
                        fontWeight: 600, flexShrink: 0,
                      }}>
                        Needs you
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
