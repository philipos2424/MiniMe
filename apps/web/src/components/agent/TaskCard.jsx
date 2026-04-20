'use client';
import { timeAgo } from '../../lib/utils';

const ICONS = { supply_reorder: '📦', delivery_schedule: '🚚', payment_followup: '💰', inventory_check: '🔍', customer_followup: '👥', price_update: '💲' };
const STATUS = { pending: { color: '#6B7280', label: 'Pending' }, awaiting_approval: { color: '#7C3AED', label: 'Awaiting' }, approved: { color: '#D97706', label: 'Approved' }, in_progress: { color: '#D97706', label: 'Running' }, completed: { color: '#059669', label: 'Done' }, failed: { color: '#ef4444', label: 'Failed' }, cancelled: { color: '#6B7280', label: 'Cancelled' } };

export default function TaskCard({ task }) {
  const s = STATUS[task.status] || STATUS.pending;
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-gold transition">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{ICONS[task.type] || '🤖'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-gold-light font-medium truncate">{task.title}</p>
            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: s.color + '33', color: s.color }}>{s.label}</span>
          </div>
          {task.description && <p className="text-muted text-xs truncate mt-0.5">{task.description}</p>}
        </div>
        <div className="text-right shrink-0">
          {task.estimated_amount && <p className="text-gold text-sm font-medium">{task.estimated_amount} ETB</p>}
          <p className="text-muted text-xs">{timeAgo(task.created_at)}</p>
        </div>
      </div>
    </div>
  );
}
