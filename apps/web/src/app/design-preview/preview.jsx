'use client';
import { useState } from 'react';
import WorkspaceFrame from '../../components/layout/WorkspaceFrame';
import { ConversationsView } from '../../components/pages/ConversationsPage';
import HomeOverview from '../../components/dashboard/HomeOverview';

const sample = { owner_attention_count: 3, ready_to_fulfill_count: 2, pending_payment_count: 1, handled_today: 24, orders_today: 5, revenue_today: 428, revenue_currency: 'USD', has_any_messages: true };
export default function Preview() {
  const [screen, setScreen] = useState('home');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [state, setState] = useState('active');
  const [dark, setDark] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const feed = state === 'loading' || state === 'error' ? null : state === 'empty' ? { has_any_messages: false, revenue_currency: 'USD' } : sample;
  const chats = [
    { id: 'sample-1', customers: { name: 'Alex Morgan' }, requires_owner: true, last_ai_action: 'drafted', last_intent: 'delivery', last_urgency: 'high', last_preview: 'Could this arrive before Friday?', last_message_at: new Date(Date.now() - 12 * 60000).toISOString(), platform: 'telegram' },
    { id: 'sample-2', customers: { name: 'Sam Rivera' }, requires_owner: true, last_ai_action: 'drafted', last_intent: 'order', last_preview: 'I would love two of the sage planters.', last_message_at: new Date(Date.now() - 6 * 60000).toISOString(), platform: 'telegram' },
    { id: 'sample-3', customers: { name: 'Jordan Lee' }, requires_owner: true, last_ai_action: 'drafted', last_preview: 'Do you offer gift wrapping?', last_message_at: new Date(Date.now() - 3 * 60000).toISOString(), platform: 'telegram' },
    { id: 'sample-4', customers: { name: 'Taylor Chen' }, requires_owner: false, last_ai_action: 'auto_sent', last_preview: 'Thank you, that helps!', last_message_at: new Date(Date.now() - 40 * 60000).toISOString(), platform: 'telegram' },
  ];
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: 'var(--paper)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: 11, padding: '8px 12px', flexShrink: 0, borderBottom: '1px solid var(--line)' }}><strong>Design preview · sample data</strong><label>Screen <select value={screen} onChange={e => setScreen(e.target.value)}><option value="home">Home</option><option value="chats">Chats</option></select></label><label>State <select value={state} onChange={e => setState(e.target.value)}>{['active', 'empty', 'loading', 'error', 'paused'].map(s => <option key={s}>{s}</option>)}</select></label><button onClick={() => { document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(!dark); }}>{dark ? 'Light theme' : 'Dark theme'}</button><a href="/design-preview?mobile=1" target="_top">Mobile</a><a href="/design-preview?desktop=1" target="_top">Desktop</a></div>
    <WorkspaceFrame pathname={screen === 'chats' ? '/conversations' : '/'} business={{ name: 'Studio Fern', panic_mode: state === 'paused' }} pendingCount={3} dark={dark}
      onTheme={() => { document.documentElement.dataset.theme = dark ? 'light' : 'dark'; setDark(!dark); }}
      onNavigate={e => { e.preventDefault(); const href = e.currentTarget.getAttribute('href'); if (href === '/') setScreen('home'); else if (href === '/conversations') setScreen('chats'); else setFeedback(true); }}>
    {screen === 'chats' ? <ConversationsView conversations={state === 'empty' || state === 'error' ? [] : chats.filter(c => filter === 'all' || c.requires_owner)}
      counts={{ drafts: 3 }} filter={filter} onFilter={setFilter} search={search} onSearch={setSearch}
      searchResults={chats.filter(c => c.customers.name.toLowerCase().includes(search.toLowerCase())).map(c => ({ id: c.id, customer_name: c.customers.name, requires_owner: c.requires_owner }))}
      loading={state === 'loading'} loadError={state === 'error'} onRetry={() => setState('active')} /> : <HomeOverview business={{ name: 'Sample shop', panic_mode: state === 'paused', currency: 'USD' }} feed={feed} error={state === 'error'} onRetry={() => setState('active')} onFeedback={() => setFeedback(!feedback)} />}
    {feedback && <p role="status" style={{ padding: 16 }}>Sample preview. Workspace destinations and feedback are available in the authenticated Telegram app. <button onClick={() => setFeedback(false)}>Dismiss</button></p>}
    </WorkspaceFrame>
  </div>;
}
