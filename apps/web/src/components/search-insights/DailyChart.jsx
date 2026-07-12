'use client';
/**
 * DailyChart — per-business daily search activity.
 * Bars = search appearances; overlaid bars = order taps + referrals.
 * Data comes from /api/dashboard/search-insights ({ day, appearances, clicks, referrals }).
 */
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { COLORS, FONT } from '../../lib/design-tokens';

const APPEAR_COLOR   = COLORS.teal;
const CLICK_COLOR    = '#D97706'; // amber — taps to chat/order
const REFERRAL_COLOR = COLORS.green;

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = (key) => payload.find(p => p.dataKey === key)?.value || 0;
  const items = [
    { label: 'Appeared in search', value: row('appearances'), color: APPEAR_COLOR },
    { label: 'Order/chat taps',    value: row('clicks'),      color: CLICK_COLOR },
    { label: 'Arrived at your bot', value: row('referrals'),  color: REFERRAL_COLOR },
  ];
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      fontFamily: FONT.body, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontWeight: 600, color: COLORS.textPrimary, marginBottom: 6 }}>{label}</div>
      {items.map(it => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: it.color, flexShrink: 0 }} />
          <span style={{ color: COLORS.textSecondary }}>{it.label}</span>
          <span style={{ fontFamily: 'monospace', color: COLORS.textPrimary, marginLeft: 'auto', paddingLeft: 12 }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function DailyChart({ daily }) {
  if (!daily?.length) return null;
  const data = daily.map(d => ({
    ...d,
    label: d.day?.slice(5), // MM-DD
  }));
  // Thin out x labels on long windows
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div style={{ fontFamily: FONT.body }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: COLORS.textHint }}>
          Search activity / day
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { c: APPEAR_COLOR, t: 'Appearances' },
            { c: CLICK_COLOR, t: 'Order taps' },
            { c: REFERRAL_COLOR, t: 'Referrals' },
          ].map(({ c, t }) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: COLORS.textSecondary }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} barCategoryGap="25%">
          <XAxis
            dataKey="label"
            axisLine={false} tickLine={false} interval={tickEvery - 1}
            tick={{ fill: COLORS.textHint, fontSize: 10, fontFamily: 'monospace' }}
          />
          <YAxis hide allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: COLORS.border + '50' }} />
          <Bar dataKey="appearances" fill={APPEAR_COLOR} radius={[3, 3, 0, 0]} name="Appearances" />
          <Line type="monotone" dataKey="clicks" stroke={CLICK_COLOR} strokeWidth={2} dot={false} name="Order taps" />
          <Line type="monotone" dataKey="referrals" stroke={REFERRAL_COLOR} strokeWidth={2} dot={false} name="Referrals" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
