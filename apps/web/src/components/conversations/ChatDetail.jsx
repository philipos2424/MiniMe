'use client';
import { MessageSquare } from 'lucide-react';
import MessageBubble from './MessageBubble';
import DraftApproval from './DraftApproval';
import EmptyState from '../ui/EmptyState';

export default function ChatDetail({ conversation, messages }) {
  const drafts = messages.filter(m => m.status === 'drafted' && m.is_ai_generated);
  const sent = messages.filter(m => m.status !== 'drafted');

  return (
    <div className="flex flex-col h-full space-y-4 min-h-0">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-semibold shrink-0">
          {(conversation.customers?.name || '?')[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl text-gold-light truncate">
            {conversation.customers?.name || 'Unknown'}
          </h1>
          <p className="text-muted text-xs">
            {conversation.customers?.tier?.toUpperCase()} · {conversation.message_count} messages
          </p>
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="space-y-2">
          <p className="text-yellow-400 text-sm font-medium flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            Pending approval · {drafts.length}
          </p>
          {drafts.map(d => <DraftApproval key={d.id} message={d} />)}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto">
        {sent.length ? (
          sent.map(m => <MessageBubble key={m.id} message={m} />)
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="ገና ምንም መልዕክት የለም / No messages yet"
            description="Messages will show up here as the conversation unfolds."
          />
        )}
      </div>
    </div>
  );
}
