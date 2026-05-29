'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { tgConfirm, tgAlert } from '../../../lib/utils';

const INK   = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const GOLD  = '#B08A4A';
const MINT  = '#4FA38A';
const LINE  = '#E4DED1';
const MUTED = '#8A9590';
const ERROR = '#B85450';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const STATUS_META = {
  pending:      { label: 'pending',      color: GOLD,  bg: 'rgba(176,138,74,0.12)' },
  delivered:    { label: 'awaiting',     color: GOLD,  bg: 'rgba(176,138,74,0.12)' },
  replied:      { label: 'replied',      color: MINT,  bg: 'rgba(79,163,138,0.12)' },
  declined:     { label: 'declined',     color: ERROR, bg: 'rgba(184,84,80,0.12)' },
  expired:      { label: 'expired',      color: MUTED, bg: 'rgba(138,149,144,0.12)' },
};

const THREAD_STATUS = {
  open:        { label: 'open',         color: MUTED },
  negotiating: { label: '🔄 negotiating', color: GOLD },
  agreed:      { label: '✅ deal agreed', color: MINT },
  declined:    { label: '✕ declined',    color: ERROR },
  expired:     { label: 'expired',       color: MUTED },
};

const INTENT_EMOJI = { inquiry: '❓', order: '🛒', coordination: '🤝', chat: '💬', reply: '↩️' };

export default function B2BPage() {
  const { initData, business } = useTelegram() || {};
  const [tab, setTab]             = useState('inbox');
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [openThread, setOpenThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending]     = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [autoNeg, setAutoNeg]     = useState(false);
  const [togglingAutoNeg, setTogglingAutoNeg] = useState(false);
  const [openCampaign, setOpenCampaign] = useState(null);

  // Load auto-negotiate state from business
  useEffect(() => {
    if (business) setAutoNeg(!!business.b2b_auto_negotiate);
  }, [business]);

  const load = useCallback(async () => {
    if (!initData) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/b2b?tab=${tab}`, { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setItems(j.items || []);
    } catch {}
    setLoading(false);
  }, [initData, tab]);

  useEffect(() => { load(); }, [load]);

  const openConversation = async (threadId) => {
    setOpenThread(threadId);
    setThreadMessages([]);
    try {
      const r = await fetch(`/api/b2b?thread=${threadId}`, { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setThreadMessages(j.messages || []);
    } catch {}
  };

  const sendReply = async (originalMsgId) => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    try {
      await fetch('/api/b2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'reply', original_msg_id: originalMsgId, content: replyText.trim() }),
      });
      setReplyText('');
      if (openThread) await openConversation(openThread);
      await load();
    } catch {}
    setSending(false);
  };

  const decline = async (msgId) => {
    if (!(await tgConfirm('Decline this message?'))) return;
    await fetch('/api/b2b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'decline', msg_id: msgId }),
    });
    if (openThread) await openConversation(openThread);
    await load();
  };

  const toggleAutoNegotiate = async () => {
    setTogglingAutoNeg(true);
    const next = !autoNeg;
    try {
      await fetch('/api/b2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'set_auto_negotiate', enabled: next }),
      });
      setAutoNeg(next);
    } catch {}
    setTogglingAutoNeg(false);
  };

  // ── Thread view ──────────────────────────────────────────────────────────
  if (openThread) {
    const myBizId = business?.id;
    const threadStatus = threadMessages.find(m => m.thread_status)?.thread_status;
    const isDeal = threadStatus === 'agreed';
    const dealRow = isDeal ? [...threadMessages].reverse().find(m => m.thread_status === 'agreed') : null;
    const partner = threadMessages[0]
      ? (threadMessages[0].sender_id === myBizId ? threadMessages[0].recipient : threadMessages[0].sender)
      : null;
    const partnerName = partner?.name || 'Business';
    const lastIncoming = [...threadMessages].reverse().find(m =>
      m.recipient_id === myBizId && ['delivered','pending'].includes(m.status)
    );

    return (
      <div style={{ fontFamily: BODY, color: INK, background: PAPER, minHeight: '100vh' }}>
        <header style={{ padding: '14px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: PAPER, zIndex: 5 }}>
          <button onClick={() => setOpenThread(null)} style={btnGhost}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>{partnerName}</div>
            {threadStatus && THREAD_STATUS[threadStatus] && (
              <div style={{ fontSize: 11, color: THREAD_STATUS[threadStatus].color, fontWeight: 600 }}>
                {THREAD_STATUS[threadStatus].label}
              </div>
            )}
          </div>
        </header>

        {/* Deal banner */}
        {isDeal && dealRow && (
          <div style={{ margin: 16, background: 'rgba(79,163,138,0.1)', border: `1px solid ${MINT}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, color: MINT, marginBottom: 6 }}>✅ Deal agreed{dealRow.ai_drafted ? ' by MiniMe' : ''}</div>
            {dealRow.offer_data && Object.keys(dealRow.offer_data).length > 0 && (
              <div style={{ fontSize: 13, color: INK, lineHeight: 1.6 }}>
                {dealRow.offer_data.product && <div>📦 {dealRow.offer_data.product}</div>}
                {dealRow.offer_data.qty && <div>📊 {dealRow.offer_data.qty}{dealRow.offer_data.unit ? ' ' + dealRow.offer_data.unit : ''}</div>}
                {dealRow.offer_data.price_per_unit && <div>💰 {dealRow.offer_data.price_per_unit} {dealRow.offer_data.currency || 'ETB'}/unit</div>}
                {dealRow.offer_data.total && <div>🧾 Total: {Number(dealRow.offer_data.total).toLocaleString()} {dealRow.offer_data.currency || 'ETB'}</div>}
                {dealRow.offer_data.delivery && <div>🚚 {dealRow.offer_data.delivery}</div>}
                {dealRow.offer_data.payment_terms && <div>💳 {dealRow.offer_data.payment_terms}</div>}
              </div>
            )}
          </div>
        )}

        <div style={{ padding: '16px', paddingBottom: 200 }}>
          {threadMessages.filter(m => m.thread_status !== 'agreed' || m.content !== 'Deal agreed.').map(m => {
            const mine = m.sender_id === myBizId;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div style={{
                  maxWidth: '78%',
                  background: mine ? INK : '#fff',
                  color: mine ? '#fff' : INK,
                  border: mine ? 'none' : `1px solid ${LINE}`,
                  padding: '10px 14px', borderRadius: 14, fontSize: 14, lineHeight: 1.45,
                }}>
                  <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {INTENT_EMOJI[m.intent] || ''} {m.intent}{m.ai_drafted ? ' · 🤖 AI' : ''}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  {/* Show offer data inline if present */}
                  {m.offer_data && m.offer_data.product && (
                    <div style={{ marginTop: 8, padding: '8px', background: mine ? 'rgba(255,255,255,0.1)' : CREAM, borderRadius: 8, fontSize: 12 }}>
                      {m.offer_data.product && <div>📦 {m.offer_data.product}</div>}
                      {m.offer_data.qty && <div>📊 {m.offer_data.qty}{m.offer_data.unit ? ' ' + m.offer_data.unit : ''}</div>}
                      {m.offer_data.price_per_unit && <div>💰 {m.offer_data.price_per_unit} {m.offer_data.currency || 'ETB'}/unit</div>}
                      {m.offer_data.total && <div>🧾 {Number(m.offer_data.total).toLocaleString()} {m.offer_data.currency || 'ETB'} total</div>}
                    </div>
                  )}
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6 }}>
                    {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {lastIncoming && !isDeal && (
          <div style={{ position: 'fixed', bottom: 'calc(72px + env(safe-area-inset-bottom))', left: 0, right: 0, padding: '10px 12px', background: PAPER, borderTop: `1px solid ${LINE}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={replyText} onChange={e => setReplyText(e.target.value)}
                placeholder={`Reply to ${partnerName}…`} rows={1}
                style={{ flex: 1, resize: 'none', padding: '10px 14px', border: `1px solid ${LINE}`, borderRadius: 18, fontSize: 14, fontFamily: BODY, outline: 'none', background: '#fff' }}
              />
              <button onClick={() => decline(lastIncoming.id)} disabled={sending} style={{ ...btnGhost, color: ERROR, padding: '8px 12px', fontSize: 12 }}>Decline</button>
              <button onClick={() => sendReply(lastIncoming.id)} disabled={!replyText.trim() || sending} style={{ ...btnPrimary, opacity: replyText.trim() ? 1 : 0.5 }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: BODY, color: INK }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.01em', marginBottom: 4 }}>Partners</h1>
        <p style={{ fontSize: 13, color: MUTED }}>Messaging and negotiations with other businesses on MiniMe.</p>
      </header>

      {/* Auto-Negotiate toggle */}
      <div style={{ background: autoNeg ? 'rgba(79,163,138,0.08)' : CREAM, border: `1px solid ${autoNeg ? MINT : LINE}`, borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: INK }}>🤖 Auto-negotiate</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {autoNeg
              ? 'MiniMe is negotiating on your behalf. You\'ll be notified of every move.'
              : 'Turn on to let MiniMe handle negotiations automatically — counter-offers, deals, the works.'}
          </div>
        </div>
        <button
          onClick={toggleAutoNegotiate}
          disabled={togglingAutoNeg}
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: autoNeg ? MINT : LINE, position: 'relative', flexShrink: 0, transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: autoNeg ? 22 : 2,
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>

      {/* Tab bar + compose */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: `1px solid ${LINE}`, alignItems: 'center' }}>
        {[
          ['inbox',    'Inbox'],
          ['sent',     'Sent'],
          ['deals',    'Deals'],
          ['research', '🔍 Research'],
          ['browse',   '🏢 Browse'],
        ].map(([t, lbl]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '10px 4px', fontSize: 13, fontWeight: 500, fontFamily: BODY,
            color: tab === t ? INK : MUTED,
            borderBottom: tab === t ? `2px solid ${INK}` : '2px solid transparent',
            marginRight: 12,
          }}>{lbl}</button>
        ))}
        {tab !== 'browse' && (
          <button onClick={() => setComposeOpen(v => !v)} style={{ ...btnPrimary, marginLeft: 'auto', marginBottom: 8, fontSize: 12, padding: '7px 14px' }}>
            {tab === 'research' ? '+ Research' : '+ Message'}
          </button>
        )}
      </div>

      {composeOpen && tab !== 'research' && (
        <ComposeForm initData={initData} onSent={() => { setComposeOpen(false); load(); }} onCancel={() => setComposeOpen(false)} />
      )}
      {composeOpen && tab === 'research' && (
        <ResearchForm initData={initData} onSent={() => { setComposeOpen(false); load(); }} onCancel={() => setComposeOpen(false)} />
      )}

      {tab === 'research' && !composeOpen && (
        <ResearchList items={items} loading={loading} onOpen={setOpenCampaign} />
      )}
      {tab === 'browse' && (
        <BrowseView initData={initData} myBizId={business?.id} />
      )}
      {openCampaign && (
        <CampaignDetail
          id={openCampaign}
          initData={initData}
          onClose={() => { setOpenCampaign(null); load(); }}
        />
      )}

      {tab !== 'research' && (loading ? (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40, fontFamily: SERIF, fontStyle: 'italic' }}>
          {tab === 'inbox'  && 'No messages from partners yet.'}
          {tab === 'sent'   && "You haven't messaged any partners yet."}
          {tab === 'deals'  && 'No deals yet. Start a negotiation to get started.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(it => {
            const partner = tab === 'sent' ? it.recipient : it.sender;
            const s = STATUS_META[it.status] || STATUS_META.pending;
            const ts = it.thread_status ? THREAD_STATUS[it.thread_status] : null;
            const isDeal = it.thread_status === 'agreed';
            return (
              <button key={it.id} onClick={() => openConversation(it.thread_id)} style={{
                appearance: 'none', textAlign: 'left',
                background: isDeal ? 'rgba(79,163,138,0.06)' : '#fff',
                border: `1px solid ${isDeal ? MINT : LINE}`,
                borderRadius: 12, padding: '14px', cursor: 'pointer', fontFamily: BODY,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: INK }}>{partner?.name || 'Unknown'}</span>
                    {partner?.telegram_bot_username && <span style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>@{partner.telegram_bot_username}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {ts && ts.label !== 'open' && (
                      <span style={{ fontSize: 10, color: ts.color, fontWeight: 600 }}>{ts.label}</span>
                    )}
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 999,
                      background: s.bg, color: s.color, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                    }}>{s.label}</span>
                  </div>
                </div>
                {/* Offer summary if present */}
                {it.offer_data?.product && (
                  <div style={{ fontSize: 12, color: MINT, fontWeight: 500 }}>
                    📦 {it.offer_data.product}{it.offer_data.qty ? ` · ${it.offer_data.qty}${it.offer_data.unit || ''}` : ''}{it.offer_data.total ? ` · ${Number(it.offer_data.total).toLocaleString()} ${it.offer_data.currency || 'ETB'}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 13, color: INK, opacity: 0.8, lineHeight: 1.45 }}>
                  <span style={{ marginRight: 6 }}>{INTENT_EMOJI[it.intent] || ''}</span>
                  {it.content.length > 120 ? it.content.slice(0, 120) + '…' : it.content}
                  {it.ai_drafted && <span style={{ fontSize: 11, color: GOLD, marginLeft: 6 }}>🤖 AI</span>}
                </div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {new Date(it.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ResearchList({ items, loading, onOpen }) {
  if (loading) return <div style={{ textAlign: 'center', color: MUTED, padding: 40 }}>Loading…</div>;
  if (!items || items.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: MUTED, padding: 40, fontFamily: SERIF, fontStyle: 'italic' }}>
        No research campaigns yet.<br/>Tap <strong>+ Research</strong> to ask MiniMe to find businesses for you.
      </div>
    );
  }
  const STATUS_COLORS = {
    open:      { label: '⏳ collecting', color: GOLD },
    reporting: { label: '📊 summarizing', color: GOLD },
    complete:  { label: '✅ complete',    color: MINT },
    cancelled: { label: '✕ cancelled',    color: MUTED },
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(c => {
        const s = STATUS_COLORS[c.status] || STATUS_COLORS.open;
        const total = (c.target_ids || []).length;
        const responded = c.reply_count || 0;
        const winner = c.report?.recommendation?.winner_name;
        return (
          <button key={c.id} onClick={() => onOpen(c.id)} style={{
            appearance: 'none', textAlign: 'left',
            background: c.status === 'complete' ? 'rgba(79,163,138,0.06)' : '#fff',
            border: `1px solid ${c.status === 'complete' ? MINT : LINE}`,
            borderRadius: 12, padding: '14px', cursor: 'pointer', fontFamily: BODY,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: SERIF, fontSize: 16, color: INK }}>{c.query}</span>
              <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>
              {responded}/{total} replies{c.category ? ` · ${c.category}` : ''}
              {c.budget?.max ? ` · up to ${c.budget.max} ${c.budget.currency || 'ETB'}` : ''}
            </div>
            {winner && (
              <div style={{ fontSize: 12, color: MINT, fontWeight: 500 }}>🏆 {winner}</div>
            )}
            <div style={{ fontSize: 11, color: MUTED }}>
              {new Date(c.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CampaignDetail({ id, initData, onClose }) {
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch(`/api/b2b?tab=research&id=${id}`, { headers: { 'x-telegram-init-data': initData } });
        const j = await r.json();
        if (mounted) setCampaign(j.campaign || null);
      } catch {}
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [id, initData]);

  const cancel = async () => {
    if (!(await tgConfirm('Cancel this research campaign?'))) return;
    await fetch('/api/b2b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ action: 'cancel_campaign', campaign_id: id }),
    });
    onClose?.();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: PAPER, zIndex: 50, overflow: 'auto', fontFamily: BODY }}>
      <header style={{ padding: '14px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: PAPER, zIndex: 10 }}>
        <button onClick={onClose} style={btnGhost}>← Back</button>
        <div style={{ flex: 1, fontFamily: SERIF, fontSize: 18 }}>Research</div>
        {campaign?.status === 'open' && (
          <button onClick={cancel} style={{ ...btnGhost, color: ERROR }}>Cancel</button>
        )}
      </header>

      <div style={{ padding: 16 }}>
        {loading ? <div style={{ color: MUTED }}>Loading…</div> : !campaign ? (
          <div style={{ color: MUTED }}>Campaign not found.</div>
        ) : (
          <>
            <div style={{ fontFamily: SERIF, fontSize: 20, color: INK, marginBottom: 4 }}>{campaign.query}</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
              {campaign.category && <span>Category: {campaign.category} · </span>}
              {campaign.budget?.max && <span>Budget up to {campaign.budget.max} {campaign.budget.currency || 'ETB'} · </span>}
              {campaign.reply_count || 0}/{(campaign.target_ids || []).length} replies
            </div>

            {/* Questions asked */}
            {Array.isArray(campaign.questions) && campaign.questions.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Questions asked</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: INK, lineHeight: 1.7 }}>
                  {campaign.questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </section>
            )}

            {/* Comparison */}
            {campaign.report?.comparison?.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Comparison</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {campaign.report.comparison.map((c, i) => (
                    <div key={i} style={{
                      background: c.candidate_id === campaign.report.recommendation?.winner_id ? 'rgba(79,163,138,0.08)' : '#fff',
                      border: `1px solid ${c.candidate_id === campaign.report.recommendation?.winner_id ? MINT : LINE}`,
                      borderRadius: 12, padding: '12px 14px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <strong>{c.name || 'Unknown'}{c.username ? ` (@${c.username})` : ''}</strong>
                        <span style={{ fontSize: 11, color: c.score >= 7 ? MINT : c.score >= 4 ? GOLD : MUTED, fontWeight: 600 }}>
                          {c.responded ? `score ${c.score || '—'}/10` : 'no reply'}
                        </span>
                      </div>
                      {c.price     && <div style={{ fontSize: 13, color: INK, marginTop: 4 }}>💰 {c.price}</div>}
                      {c.lead_time && <div style={{ fontSize: 13, color: INK }}>⏱ {c.lead_time}</div>}
                      {c.included  && <div style={{ fontSize: 13, color: INK }}>📦 {c.included}</div>}
                      {c.terms     && <div style={{ fontSize: 13, color: INK }}>📝 {c.terms}</div>}
                      {Array.isArray(c.pros) && c.pros.length > 0 && (
                        <div style={{ fontSize: 12, color: MINT, marginTop: 4 }}>+ {c.pros.join(', ')}</div>
                      )}
                      {Array.isArray(c.cons) && c.cons.length > 0 && (
                        <div style={{ fontSize: 12, color: ERROR }}>− {c.cons.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recommendation */}
            {campaign.report?.recommendation && (
              <section style={{ background: 'rgba(79,163,138,0.08)', border: `1px solid ${MINT}`, borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MINT, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>🏆 MiniMe recommends</div>
                <div style={{ fontFamily: SERIF, fontSize: 18, color: INK }}>{campaign.report.recommendation.winner_name}</div>
                {campaign.report.recommendation.winner_username && (
                  <div style={{ fontSize: 12, color: MUTED }}>@{campaign.report.recommendation.winner_username}</div>
                )}
                {campaign.report.recommendation.why && (
                  <div style={{ fontSize: 14, color: INK, marginTop: 6, lineHeight: 1.5 }}>{campaign.report.recommendation.why}</div>
                )}
              </section>
            )}

            {/* Web candidates section intentionally removed — MiniMe-only network */}
          </>
        )}
      </div>
    </div>
  );
}

function ResearchForm({ initData, onSent, onCancel }) {
  const [query, setQuery]     = useState('');
  const [category, setCategory] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [maxTargets, setMaxTargets] = useState('5');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');

  const submit = async () => {
    setError('');
    if (!query.trim()) { setError('What should I research?'); return; }
    setSending(true);
    try {
      const r = await fetch('/api/b2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          action: 'start_research',
          query: query.trim(),
          category: category.trim() || undefined,
          budget: maxBudget ? { max: Number(maxBudget), currency: 'ETB' } : undefined,
          max_targets: Number(maxTargets) || 5,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Failed'); setSending(false); return; }
      onSent?.();
    } catch (e) { setError(e.message); setSending(false); }
  };

  return (
    <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>🔍 Start research</div>

      <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>What are you looking for?</label>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder='e.g. "branding agency for logo + business cards"' style={{ ...inp, width: '100%', marginBottom: 10 }} />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>Category (optional)</label>
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="branding, packaging…" style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>Max budget ETB</label>
          <input type="number" value={maxBudget} onChange={e => setMaxBudget(e.target.value)} placeholder="20000" style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>Max targets</label>
          <input type="number" value={maxTargets} onChange={e => setMaxTargets(e.target.value)} min={1} max={10} style={inp} />
        </div>
      </div>

      {error && <div style={{ color: ERROR, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={submit} disabled={sending} style={btnPrimary}>
          {sending ? 'Starting…' : '🔍 Start research'}
        </button>
      </div>
    </div>
  );
}

function ComposeForm({ initData, onSent, onCancel }) {
  const [target, setTarget]     = useState('');
  const [message, setMessage]   = useState('');
  const [intent, setIntent]     = useState('inquiry');
  const [negotiate, setNegotiate] = useState(false);
  const [maxBudget, setMaxBudget] = useState('');
  const [minPrice, setMinPrice]   = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');

  const submit = async () => {
    setError('');
    if (!target.trim() || !message.trim()) { setError('Target and message are required'); return; }
    setSending(true);
    const limits = {};
    if (negotiate && maxBudget) limits.max_budget_buy = Number(maxBudget);
    if (negotiate && minPrice)  limits.min_sell_price = Number(minPrice);
    try {
      const r = await fetch('/api/b2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          action: 'send',
          target_username: target.trim(),
          intent: negotiate ? 'coordination' : intent,
          message: message.trim(),
          negotiate,
          limits: Object.keys(limits).length ? limits : undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error === 'not_on_minime' ? `@${target.replace(/^@/,'')} isn't on MiniMe yet.` : (j.error || 'Failed'));
        setSending(false); return;
      }
      onSent?.();
    } catch (e) { setError(e.message); setSending(false); }
  };

  return (
    <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <span style={{ color: MUTED, fontSize: 14, flexShrink: 0 }}>To</span>
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="@bot_username" style={inp} />
      </div>

      {!negotiate && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {['inquiry', 'order', 'coordination', 'chat'].map(i => (
            <button key={i} onClick={() => setIntent(i)} style={{
              background: intent === i ? INK : '#fff', color: intent === i ? '#fff' : INK,
              border: `1px solid ${intent === i ? INK : LINE}`, borderRadius: 999,
              padding: '4px 12px', fontSize: 12, fontFamily: BODY, cursor: 'pointer', textTransform: 'capitalize',
            }}>{INTENT_EMOJI[i]} {i}</button>
          ))}
        </div>
      )}

      <textarea
        value={message} onChange={e => setMessage(e.target.value)}
        placeholder={negotiate ? 'What do you want to negotiate? Be specific — MiniMe will take it from here.' : 'What do you want to say?'}
        rows={3}
        style={{ ...inp, width: '100%', resize: 'vertical', minHeight: 70, marginBottom: 10 }}
      />

      {/* Negotiate toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: negotiate ? 10 : 0 }}>
        <button onClick={() => setNegotiate(v => !v)} style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: negotiate ? MINT : LINE, position: 'relative', transition: 'background 0.2s',
        }}>
          <span style={{ position: 'absolute', top: 2, left: negotiate ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </button>
        <span style={{ fontSize: 13, color: INK }}>Let MiniMe negotiate for me</span>
      </div>

      {negotiate && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>Max budget (buying, ETB)</label>
            <input type="number" value={maxBudget} onChange={e => setMaxBudget(e.target.value)} placeholder="e.g. 50000" style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: MUTED, display: 'block', marginBottom: 4 }}>Min price/unit (selling, ETB)</label>
            <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="e.g. 800" style={inp} />
          </div>
        </div>
      )}

      {error && <div style={{ color: ERROR, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button onClick={submit} disabled={sending} style={btnPrimary}>
          {sending ? 'Sending…' : negotiate ? '🤝 Start negotiation' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ─── Browse View ─────────────────────────────────────────────────────────────
function BrowseView({ initData, myBizId }) {
  const [query, setQuery]       = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults]   = useState(null); // null = not searched yet
  const [loading, setLoading]   = useState(false);
  const [connecting, setConnecting] = useState(null);

  async function search() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tab: 'browse' });
      if (category) params.set('category', category);
      if (query)    params.set('q', query);
      const r = await fetch(`/api/b2b?${params}`, { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json();
      setResults(j.items || []);
    } catch { setResults([]); }
    setLoading(false);
  }

  async function connect(biz) {
    if (connecting) return;
    setConnecting(biz.id);
    try {
      await fetch('/api/b2b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ action: 'connect', target_username: biz.telegram_bot_username, context: query || category }),
      });
    } catch {}
    setConnecting(null);
    await tgAlert(`Intro sent to ${biz.name}! They'll reply through their bot.`);
  }

  const CATEGORIES = [
    ['', 'All categories'],
    ['branding_design', '🎨 Branding & Design'],
    ['printing_signage', '🖨️ Printing & Signage'],
    ['photography_video', '📸 Photography & Video'],
    ['catering_food', '🍽️ Catering & Food'],
    ['food_beverage', '🍕 Restaurant & Café'],
    ['it_tech', '💻 IT & Tech'],
    ['events_entertainment', '🎉 Events'],
    ['clothing_fashion', '👗 Clothing & Fashion'],
    ['beauty_wellness', '💅 Beauty & Wellness'],
    ['construction_interior', '🏗️ Construction & Interior'],
    ['transport_delivery', '🚚 Transport & Delivery'],
    ['training_consulting', '📚 Training & Consulting'],
    ['wholesale_supply', '📦 Wholesale & Supply'],
    ['electronics_phones', '📱 Electronics & Phones'],
  ];

  return (
    <div>
      <div style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>🏢 Browse MiniMe Network</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={category} onChange={e => setCategory(e.target.value)}
            style={{ ...inp, flex: '1 1 140px' }}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or keyword…"
            style={{ ...inp, flex: '2 1 160px' }} onKeyDown={e => e.key === 'Enter' && search()} />
          <button onClick={search} disabled={loading} style={btnPrimary}>{loading ? '…' : 'Search'}</button>
        </div>
      </div>

      {results === null && (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40, fontFamily: SERIF, fontStyle: 'italic' }}>
          Select a category or search to browse businesses on MiniMe.
        </div>
      )}

      {results !== null && results.length === 0 && !loading && (
        <div style={{ textAlign: 'center', color: MUTED, padding: 40, fontFamily: SERIF, fontStyle: 'italic' }}>
          No businesses found. Try a different category or keyword.
        </div>
      )}

      {results && results.map(biz => (
        <div key={biz.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: CREAM, display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 18 }}>
              🏢
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{biz.name}</div>
              {biz.telegram_bot_username && (
                <div style={{ fontSize: 12, color: MUTED }}>@{biz.telegram_bot_username}</div>
              )}
              {biz.location && (
                <div style={{ fontSize: 12, color: MUTED }}>📍 {biz.location}</div>
              )}
              {biz.description && (
                <div style={{ fontSize: 13, color: INK, marginTop: 4, lineHeight: 1.4 }}>{biz.description.slice(0, 120)}{biz.description.length > 120 ? '…' : ''}</div>
              )}
              {Array.isArray(biz.tags) && biz.tags.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {biz.tags.slice(0, 5).map(t => (
                    <span key={t} style={{ background: CREAM, border: `1px solid ${LINE}`, borderRadius: 999, fontSize: 11, padding: '2px 8px', color: MUTED }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
            {biz.telegram_bot_username && biz.id !== myBizId && (
              <button
                onClick={() => connect(biz)}
                disabled={connecting === biz.id}
                style={{ ...btnPrimary, fontSize: 12, padding: '6px 12px', flexShrink: 0 }}
              >
                {connecting === biz.id ? '…' : '🤝 Connect'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const inp = {
  padding: '8px 12px', border: `1px solid ${LINE}`, borderRadius: 8,
  fontSize: 14, fontFamily: BODY, outline: 'none', background: '#fff', color: INK, flex: 1,
};
const btnPrimary = {
  background: INK, color: '#fff', border: 'none', borderRadius: 999,
  padding: '8px 16px', fontSize: 13, fontWeight: 500, fontFamily: BODY, cursor: 'pointer',
};
const btnGhost = {
  background: 'transparent', color: INK, border: `1px solid ${LINE}`, borderRadius: 999,
  padding: '8px 14px', fontSize: 13, fontFamily: BODY, cursor: 'pointer',
};
