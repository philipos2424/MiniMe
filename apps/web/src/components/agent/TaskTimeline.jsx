'use client';
export default function TaskTimeline({ steps }) {
  if (!steps.length) return <p className="text-muted text-sm">No steps recorded yet.</p>;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-gold font-semibold text-sm mb-3">Timeline</h2>
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.status === 'completed' ? 'bg-emerald-400' : s.status === 'in_progress' ? 'bg-yellow-400 animate-pulse' : 'bg-muted'}`} />
            <div>
              <p className="text-body text-sm">{s.step}</p>
              {s.timestamp && <p className="text-muted text-xs">{new Date(s.timestamp).toLocaleTimeString()}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
