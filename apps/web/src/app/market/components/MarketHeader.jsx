'use client';
import { openChat } from '../lib';

export default function MarketHeader({ q, onSearch, voiceState, voiceErr, onMic }) {
  return (
    <div className="mk-head">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h1 className="mk-title">🛍️ MiniMe Market</h1>
        <button className="mk-ask" onClick={() => openChat('https://t.me/MiniMeSearchBot')}>💬 Ask MiniMe</button>
      </div>
      <div className="mk-sub">Every shop on MiniMe, one place — chat & order on Telegram</div>
      <div className="mk-search">
        <span aria-hidden>🔍</span>
        <input
          value={q}
          onChange={e => onSearch(e.target.value)}
          placeholder={voiceState === 'recording' ? 'Listening…' : voiceState === 'transcribing' ? 'Transcribing…' : 'What are you looking for? · ምን ይፈልጋሉ?'}
          enterKeyHint="search"
          disabled={voiceState === 'recording' || voiceState === 'transcribing'}
        />
        <button
          type="button"
          className={`mk-mic${voiceState === 'recording' ? ' on' : ''}`}
          onClick={onMic}
          disabled={voiceState === 'transcribing'}
          aria-label="Search by voice"
          title="Search by voice"
        >{voiceState === 'transcribing' ? '⏳' : voiceState === 'recording' ? '⏹️' : '🎙️'}</button>
      </div>
      {voiceState === 'error' && voiceErr && <div className="mk-voice-err">{voiceErr}</div>}
    </div>
  );
}
