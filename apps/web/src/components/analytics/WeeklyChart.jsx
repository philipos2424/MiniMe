'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

export default function WeeklyChart({ data }) {
  const chartData = data.map(d => ({
    day: format(new Date(d.date), 'EEE'),
    messages: d.total_messages,
    ai: d.ai_auto_sent,
    manual: d.owner_manual,
  }));

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-gold font-semibold text-sm mb-4">Weekly Messages</h2>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <XAxis dataKey="day" stroke="#6a6252" tick={{ fill: '#6a6252', fontSize: 12 }} />
          <YAxis stroke="#6a6252" tick={{ fill: '#6a6252', fontSize: 12 }} />
          <Tooltip contentStyle={{ background: '#13130f', border: '1px solid #1f1f18', borderRadius: 8 }} labelStyle={{ color: '#F5D799' }} />
          <Bar dataKey="ai" fill="#D4A853" radius={[4, 4, 0, 0]} name="AI Sent" />
          <Bar dataKey="manual" fill="#6a6252" radius={[4, 4, 0, 0]} name="Manual" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
