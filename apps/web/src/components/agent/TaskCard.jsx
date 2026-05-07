'use client';
import { timeAgo } from '../../lib/utils';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const ICONS = { supply_reorder: '📦', delivery_schedule: '🚚', payment_followup: '💰', inventory_check: '🔍', customer_followup: '👥', price_update: '💲' };
const STATUS = { pending: { color: COLORS.textHint, label: 'Pending' }, awaiting_approval: { color: '#7C3AED', label: 'Awaiting' }, approved: { color: COLORS.amber, label: 'Approved' }, in_progress: { color: COLORS.amber, label: 'Running' }, completed: { color: COLORS.green, label: 'Done' }, failed: { color: COLORS.red, label: 'Failed' }, cancelled: { color: COLORS.textHint, label: 'Cancelled' } };

export default function TaskCard({ task }) {
  const s = STATUS[task.status] || STATUS.pending;
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, boxShadow: SHADOW.card, fontFamily: FONT.body }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 24 }}>{ICONS[task.type] || '🤖'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</p>
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: s.color + '22', color: s.color, flexShrink: 0, fontWeight: 500 }}>{s.label}</span>
          </div>
          {task.description && <p style={{ fontSize: 12, color: COLORS.textHint, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</p>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {task.estimated_amount && <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.teal, margin: 0 }}>{task.estimated_amount} ETB</p>}
          <p style={{ fontSize: 11, color: COLORS.textHint, margin: '2px 0 0' }}>{timeAgo(task.created_at)}</p>
        </div>
      </div>
    </div>
  );
}
