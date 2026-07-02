'use client';
/**
 * Aggregated "what the bot knows" across all customers — searchable, filterable
 * by kind, each entry links back to the customer it's about.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { apiGet } from '../../lib/api';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const KINDS = [
  { key: '', label: 'All' },
  { key: 'preference', label: 'Preferences' },
  { key: 'fact', label: 'Facts' },
  { key: 'commitment', label: 'Commitments' },
  { key: 'note', label: 'Notes' },
  { key: 'feedback', label: 'Feedback' },
];

function kindStyle(kind) {
  if (kind === 'preference') return { color: COLORS.teal, background: `${COLORS.teal}15` };
  if (kind === 'feedback') return { color: COLORS.amber, background: `${COLORS.amber}20` };
  return { color: COLORS.textHint, background: COLORS.border };
}

export default function MemoryPage() {
  const { initData } = useTelegram() || {};
  const [memory, setMemory] = useState([]);
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!initData) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (search.trim()) params.set('search', search.trim());
    apiGet(`/api/customer-memory?${params.toString()}`, initData)
      .then(j => setMemory(j.memory || []))
      .catch(() => setMemory([]))
      .finally(() => setLoading(false));
  }, [initData, kind, search]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div style={{ fontFamily: FONT.body, maxWidth: 720, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: FONT.serif, fontWeight: 400, fontSize: 28, margin: '0 0 6px', letterSpacing: '-0.02em', color: COLORS.textPrimary }}>
          Memory
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textHint, margin: 0, lineHeight: 1.5 }}>
          Everything the bot has learned about your customers, in one place.
        </p>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search what the bot knows…"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 14px',
          borderRadius: RADII.md, border: `1px solid ${COLORS.border}`,
          fontFamily: FONT.body, fontSize: 14, color: COLORS.textPrimary,
          marginBottom: 12, outline: 'none',
        }}
      />

      {/* Kind filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {KINDS.map(k => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            style={{
              padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              border: `1px solid ${kind === k.key ? COLORS.teal : COLORS.border}`,
              background: kind === k.key ? `${COLORS.teal}15` : 'transparent',
              color: kind === k.key ? COLORS.teal : COLORS.textSecondary,
              cursor: 'pointer', fontFamily: FONT.body,
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ fontSize: 13, color: COLORS.textHint }}>Loading…</div>
      ) : memory.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textHint }}>Nothing here yet — the bot learns as customers chat with it.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {memory.map(m => {
            const style = kindStyle(m.kind);
            return (
              <div key={m.id} style={{
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
                padding: '12px 14px', boxShadow: SHADOW.card,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: style.color, background: style.background,
                  padding: '2px 6px', borderRadius: 4, marginTop: 2, flexShrink: 0,
                }}>{m.kind}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.45 }}>{m.content}</div>
                  <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4 }}>
                    {m.customers ? (
                      <Link href={`/customers/${m.customers.id}`} style={{ color: COLORS.teal, textDecoration: 'none' }}>
                        {m.customers.name || 'Unnamed customer'}
                      </Link>
                    ) : 'Unknown customer'}
                    {' · '}
                    {new Date(m.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
