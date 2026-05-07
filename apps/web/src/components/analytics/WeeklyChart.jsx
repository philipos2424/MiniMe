'use client';
/**
 * WeeklyChart — stacked bar chart (AI auto-sent + manual).
 * Matches handoff M06: dark base = auto-replied, accent top = you sent.
 * Card wrapper is provided by the parent (AnalyticsPage).
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format } from 'date-fns';
import { COLORS, FONT } from '../../lib/design-tokens';

const AI_COLOR     = COLORS.teal;
const MANUAL_COLOR = '#D97706'; // amber — "you sent"

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ai     = payload.find(p => p.dataKey === 'ai')?.value     || 0;
  const manual = payload.find(p => p.dataKey === 'manual')?.value || 0;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      fontFamily: FONT.body, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontWeight: 600, color: COLORS.textPrimary, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: AI_COLOR, flexShrink: 0 }} />
        <span style={{ color: COLORS.textSecondary }}>MiniMe auto-replied</span>
        <span style={{ fontFamily: 'monospace', color: COLORS.textPrimary, marginLeft: 'auto', paddingLeft: 12 }}>{ai}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: MANUAL_COLOR, flexShrink: 0 }} />
        <span style={{ color: COLORS.textSecondary }}>You sent</span>
        <span style={{ fontFamily: 'monospace', color: COLORS.textPrimary, marginLeft: 'auto', paddingLeft: 12 }}>{manual}</span>
      </div>
      {(ai + manual > 0) && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: COLORS.textHint }}>Total</span>
          <span style={{ fontFamily: 'monospace', color: COLORS.textPrimary, fontWeight: 600 }}>{ai + manual}</span>
        </div>
      )}
    </div>
  );
}

export default function WeeklyChart({ data }) {
  const chartData = data.map(d => ({
    day: format(new Date(d.date), 'EEE'),
    ai:     d.ai_auto_sent   || 0,
    manual: d.owner_manual   || 0,
  }));

  return (
    <div style={{ fontFamily: FONT.body }}>
      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: COLORS.textHint }}>
          Replies / day
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: COLORS.textSecondary }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: AI_COLOR }} />
            Auto-replied
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: COLORS.textSecondary }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: MANUAL_COLOR }} />
            You sent
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} barCategoryGap="30%">
          <XAxis
            dataKey="day"
            axisLine={false} tickLine={false}
            tick={{ fill: COLORS.textHint, fontSize: 11, fontFamily: 'monospace' }}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: COLORS.border + '50' }} />
          {/* ai = base (bottom of stack) */}
          <Bar dataKey="ai" stackId="a" fill={AI_COLOR} radius={[0, 0, 0, 0]} name="MiniMe auto-replied" />
          {/* manual = top of stack — gets rounded corners */}
          <Bar dataKey="manual" stackId="a" fill={MANUAL_COLOR} radius={[3, 3, 0, 0]} name="You sent" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
