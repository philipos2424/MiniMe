'use client';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { timeAgo } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';

const STATUS_COLORS = { active: '#D97706', resolved: '#059669', archived: '#6B7280' };
const AI_ACTIONS = { auto_sent: '🤖', drafted: '✍️', escalated: '⚠️', observed: '👁️', approved: '✅' };

export default function ChatList({ conversations }) {
  if (!conversations.length) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="ገና ምንም መልዕክት የለም / No messages yet"
        description="Customers who DM your bot will appear here."
      />
    );
  }
  return (
    <div className="space-y-2">
      {conversations.map(c => (
        <Link
          key={c.id}
          href={`/conversations/${c.id}`}
          className="flex items-center gap-3 bg-card border border-border rounded-xl p-4 min-h-[44px] hover:border-gold/40 transition"
        >
          <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-semibold shrink-0">
            {(c.customers?.name || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-gold-light font-medium truncate">{c.customers?.name || 'Unknown'}</p>
              {c.requires_owner && (
                <span className="text-xs bg-yellow-900/30 text-yellow-400 px-1.5 py-0.5 rounded">Needs you</span>
              )}
            </div>
            <p className="text-muted text-sm truncate">
              {AI_ACTIONS[c.last_ai_action] || ''} {c.last_ai_action?.replace('_', ' ') || 'No activity'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-muted text-xs">{timeAgo(c.last_message_at)}</p>
            <p className="text-xs mt-0.5" style={{ color: STATUS_COLORS[c.status] }}>{c.status}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
