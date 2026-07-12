'use client';

export default function BottomTabs({ tab, onTab, savedCount }) {
  return (
    <div className="mk-tabs">
      <button className={`mk-tab${tab === 'market' ? ' on' : ''}`} onClick={() => onTab('market')}>
        <span className="ic" aria-hidden>🛍️</span>
        Market
      </button>
      <button className={`mk-tab${tab === 'saved' ? ' on' : ''}`} onClick={() => onTab('saved')} style={{ position: 'relative' }}>
        <span className="ic" aria-hidden>{tab === 'saved' ? '❤️' : '🤍'}</span>
        {savedCount > 0 && <span className="badge">{savedCount > 99 ? '99+' : savedCount}</span>}
        Saved
      </button>
    </div>
  );
}
