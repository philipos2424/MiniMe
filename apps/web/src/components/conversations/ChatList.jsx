'use client';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { timeAgo } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';

const ACTION_ICON = {
  auto_sent: '🤖',
  drafted: '✍️',
  escalated: '⚠️',
  observed: '👁️',
  approved: '✅',
  scam_flagged: '🛡️',
  order_created: '🛒',
};

const ACTION_LABEL = {
  auto_sent: 'AI replied',
  drafted: 'Draft ready',
  escalated: 'Needs you',
  observed: 'Watching',
  approved: 'You replied',
  scam_flagged: 'Scam blocked',
  order_created: 'New order',
};

export default function ChatList({ conversations }) {
  if (!conversations.length) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No messages yet"
        description="Customers who DM your bot will appear here."
      />
    );
  }
  return (
    <ul className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
      {conversations.map(c => {
        const name = c.customers?.name || 'Unknown';
        const letter = name.charAt(0).toUpperCase();
        const action = c.last_ai_action;
        return (
          <li key={c.id}>
            <Link
              href={`/conversations/${c.id}`}
              className="flex items-start gap-3 px-4 py-3.5 hover:bg-border/20 active:bg-border/30 transition"
            >
              <div className="w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center text-gold font-semibold shrink-0 text-sm">
                {letter}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-gold-light font-medium truncate text-sm">{name}</span>
                  <span className="text-muted text-[11px] flex-shrink-0 tabular-nums">
                    {timeAgo(c.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {action && <span className="text-xs">{ACTION_ICON[action] || ''}</span>}
                  <span className="text-muted text-xs truncate">
                    {action ? (ACTION_LABEL[action] || action.replace('_', ' ')) : 'No activity'}
                  </span>
                  {c.requires_owner && (
                    <span className="text-[10px] bg-yellow-500/15 text-yellow-400 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-auto">
                      Needs you
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
