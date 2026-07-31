'use client';

import React from 'react';

export default function CreditIndicator({
  remainingCredits = 5,
  totalCredits = 5,
  isUnlimited = false,
  onOpenUpgrade = () => {},
}) {
  if (isUnlimited || remainingCredits === -1) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '999px',
        background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)',
        color: '#10B981', fontSize: '12px', fontWeight: 600,
        fontFamily: "'Geist', 'Inter', sans-serif"
      }}>
        ⚡ Unlimited AI Chats
      </div>
    );
  }

  const isLow = remainingCredits <= 2 && remainingCredits > 0;
  const isZero = remainingCredits <= 0;

  const bg = isZero
    ? 'rgba(239, 68, 68, 0.15)'
    : isLow
    ? 'rgba(245, 158, 11, 0.15)'
    : 'rgba(99, 102, 241, 0.12)';

  const border = isZero
    ? 'rgba(239, 68, 68, 0.3)'
    : isLow
    ? 'rgba(245, 158, 11, 0.3)'
    : 'rgba(99, 102, 241, 0.25)';

  const text = isZero ? '#F87171' : isLow ? '#FBBF24' : '#818CF8';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <div
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 12px', borderRadius: '999px',
          background: bg, border: `1px solid ${border}`,
          color: text, fontSize: '12px', fontWeight: 600,
          fontFamily: "'Geist', 'Inter', sans-serif",
          transition: 'all 0.2s ease'
        }}
      >
        <span>⚡</span>
        <span>{remainingCredits} AI Credits Remaining</span>
      </div>

      {isZero && (
        <button
          onClick={onOpenUpgrade}
          style={{
            padding: '6px 14px', borderRadius: '999px', border: 'none',
            background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
            color: '#FFF', fontSize: '12px', fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
            animation: 'pulse 2s infinite'
          }}
        >
          Upgrade to Continue
        </button>
      )}
    </div>
  );
}
