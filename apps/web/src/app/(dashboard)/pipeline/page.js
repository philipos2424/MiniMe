'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';

const INK    = '#0E2823';
const PAPER  = '#FBF8F1';
const CREAM  = '#F4EEE1';
const GOLD   = '#B08A4A';
const MINT   = '#4FA38A';
const MUTED  = '#8A9590';
const LINE   = '#E4DED1';
const SERIF  = "'Newsreader', Georgia, serif";
const BODY   = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

const STAGES = [
  { key: 'new',          label: 'New',            color: '#D9A441', desc: 'Just came in' },
  { key: 'in_progress',  label: 'In Progress',    color: '#3F5D3F', desc: 'Active jobs' },
  { key: 'awaiting',     label: 'Awaiting Pay',   color: '#B08A4A', desc: 'Payment pending' },
  { key: 'paid',         label: 'Paid',           color: '#4FA38A', desc: 'Ready to fulfill' },
  { key: 'fulfilled',    label: 'Fulfilled',      color: '#8A9590', desc: 'Done (last 14d)' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Stage advance map for orders
const NEXT_STATUS = {
  pending:         { next: 'paid',      label: '✅ Mark paid' },
  pending_payment: { next: 'paid',      label: '✅ Mark paid' },
  paid:            { next: 'fulfilled', label: '📦 Fulfill' },
};

function Card({ card, onAdvance }) {
  const href = card.type === 'order' ? `/orders/${card.id}` : `/agent/${card.id}`;
  const total = card.total ? `${card.total.toLocaleString()} ${card.currency || 'ETB'}` : null;
  const advance = card.type === 'order' ? NEXT_STATUS[card.status] : null;
  const [advancing, setAdvancing] = useState(false);

  return (
    <div style={{
      background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
      padding: 12, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4,
      boxShadow: '0 1px 0 rgba(14,40,35,.03)',
    }}>
      <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: card.type === 'job' ? '#3F5D3F' : GOLD,
          }}>{card.type}</span>
          <span style={{ fontSize: 10.5, color: MUTED }}>{timeAgo(card.created_at)}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: INK, lineHeight: 1.25, marginTop: 2 }}>
          {card.title}
        </div>
        <div style={{ fontSize: 12.5, color: '#4A5E5A' }}>
          {card.customer}
        </div>
        {card.type === 'job' && card.total_steps ? (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            Step {card.current_step || 1} of {card.total_steps}
          </div>
        ) : null}
        {total && (
          <div style={{ fontFamily: SERIF, fontSize: 15, color: INK, marginTop: 2 }}>
            {total}
          </div>
        )}
      </Link>
      {/* Quick advance button */}
      {advance && (
        <button
          onClick={async e => {
            e.stopPropagation();
            if (advancing) return;
            setAdvancing(true);
            await onAdvance(card.id, advance.next).catch(() => {});
            setAdvancing(false);
          }}
          disabled={advancing}
          style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 8,
            background: advance.next === 'fulfilled' ? MINT : GOLD,
            color: '#fff', border: 'none', fontSize: 11, fontWeight: 600,
            cursor: advancing ? 'default' : 'pointer', fontFamily: BODY,
            opacity: advancing ? 0.7 : 1,
          }}
        >
          {advancing ? '…' : advance.label}
        </button>
      )}
    </div>
  );
}

function Column({ stage, cards, onAdvance }) {
  return (
    <div style={{
      flex: '0 0 280px', display: 'flex', flexDirection: 'column',
      background: CREAM, borderRadius: 14, padding: 12,
      maxHeight: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stage.color }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: INK, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{stage.label}</span>
        </div>
        <span style={{
          background: '#fff', borderRadius: 999, padding: '2px 8px',
          fontSize: 11, fontWeight: 600, color: stage.color, border: `1px solid ${LINE}`,
        }}>{cards.length}</span>
      </div>
      <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 10, fontStyle: 'italic' }}>
        {stage.desc}
      </div>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {cards.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>
            Nothing here yet.
          </div>
        ) : (
          cards.map(c => <Card key={c.type + c.id} card={c} onAdvance={onAdvance} />)
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { initData } = useTelegram() || {};
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const onAdvance = useCallback(async (orderId, newStatus) => {
    if (!initData) return;
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify({ id: orderId, status: newStatus }),
    });
    // Reload to show updated stage
    load();
  }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!initData) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/pipeline', {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Load failed');
      setData(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [initData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: BODY }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD }}>
          Workflow
        </div>
        <h1 style={{
          fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: '6px 0 2px',
          letterSpacing: '-0.02em', color: INK,
        }}>Pipeline</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
          Every order and job, grouped by stage. Tap any card for details.
        </p>
      </div>

      {err && (
        <div style={{
          background: 'rgba(184,84,80,0.1)', border: '1px solid rgba(184,84,80,0.25)',
          borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#B85450', marginBottom: 16,
        }}>{err}</div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: MUTED }}>Loading…</div>
      ) : (
        <>
        {/* Stage summary chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {STAGES.map(stage => {
            const count = data?.[stage.key]?.length || 0;
            if (!count) return null;
            return (
              <div key={stage.key} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: `${stage.color}18`, color: stage.color, border: `1px solid ${stage.color}30`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: stage.color }} />
                {count} {stage.label}
              </div>
            );
          })}
        </div>

        <div style={{
          display: 'flex', gap: 12, overflowX: 'auto', flex: 1, minHeight: 0,
          paddingBottom: 8, scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}>
          {STAGES.map(stage => (
            <Column
              key={stage.key}
              stage={stage}
              cards={data?.[stage.key] || []}
              onAdvance={onAdvance}
            />
          ))}
        </div>
        </>
      )}
    </div>
  );
}
