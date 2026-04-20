'use client';
import { useState } from 'react';

export default function DecisionLog({ log }) {
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <button onClick={() => setOpen(p => !p)} className="flex items-center justify-between w-full">
        <span className="text-gold font-semibold text-sm">🧠 AI Decision Log ({log.length})</span>
        <span className="text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {log.map((entry, i) => (
            <div key={i} className="border-l-2 border-gold/30 pl-3">
              <p className="text-body text-sm font-medium">{entry.decision}</p>
              <p className="text-muted text-xs mt-1">{entry.reasoning}</p>
              {entry.confidence && <p className="text-muted text-xs">Confidence: {Math.round(entry.confidence * 100)}%</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
