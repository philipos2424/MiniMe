'use client';
import { timeAgo, confidenceColor } from '../../lib/utils';

export default function MessageBubble({ message }) {
  const isOwner = message.direction === 'outbound';
  return (
    <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-2.5 ${isOwner ? 'bg-gold text-bg rounded-br-sm' : 'bg-card border border-border text-body rounded-bl-sm'}`}>
        <p className="text-sm">{message.content}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs ${isOwner ? 'text-bg/60' : 'text-muted'}`}>{timeAgo(message.created_at)}</span>
          {message.is_ai_generated && (
            <span className={`text-xs font-medium ${confidenceColor(message.ai_confidence)}`}>
              🤖 {Math.round((message.ai_confidence || 0) * 100)}%
            </span>
          )}
          {message.owner_edited && <span className="text-xs text-blue-400">✏️ edited</span>}
        </div>
      </div>
    </div>
  );
}
