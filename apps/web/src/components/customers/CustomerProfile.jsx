'use client';
/**
 * CustomerProfile — redesigned with design tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { timeAgo, formatPrice } from '../../lib/utils';
import { createClient } from '../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW, isAmharic } from '../../lib/design-tokens';

const TIER_ACCENT = { vip: '#7C3AED', regular: '#059669', new: '#D97706' };
const TIER_BG     = { vip: '#F3F0FF', regular: '#F0FDF4', new: '#FFFBEB' };

export default function CustomerProfile({ customer, messages }) {
  const name   = customer.name || 'Unknown';
  const tier   = customer.tier || 'new';
  const accent = TIER_ACCENT[tier] || COLORS.textHint;
  const tierBg = TIER_BG[tier]     || '#F3F4F6';

  // Editable owner notes
  const [notes, setNotes]     = useState(customer.owner_notes || '');
  const [saveState, setSave]  = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const saveTimer             = useRef(null);

  async function saveNotes(value) {
    if (value === (customer.owner_notes || '')) return; // no change
    setSave('saving');
    const { error } = await createClient()
      .from('customers')
      .update({ owner_notes: value })
      .eq('id', customer.id);
    setSave(error ? 'error' : 'saved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSave('idle'), 2500);
  }

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const stats = [
    { label: 'Total Orders',  value: customer.total_orders ?? 0 },
    { label: 'Total Spent',   value: formatPrice ? formatPrice(customer.total_spent) : `${Number(customer.total_spent || 0).toLocaleString()} ETB` },
    { label: 'First Contact', value: timeAgo(customer.first_contact_at) },
    { label: 'Last Active',   value: timeAgo(customer.last_active_at) },
  ];

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Hero header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${COLORS.teal}30, ${COLORS.teal}15)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: COLORS.teal, fontFamily: "'Fraunces', Georgia, serif",
            fontWeight: 400, fontSize: 28, flexShrink: 0,
          }}>
            {name[0].toUpperCase()}
          </div>
          <div>
            <h1 style={{
              fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em',
              fontFamily: "'Fraunces', Georgia, serif",
            }}>{name}</h1>
            {customer.telegram_username && (
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>@{customer.telegram_username}</div>
            )}
            <span style={{
              display: 'inline-block', marginTop: 6,
              fontSize: 10, padding: '3px 9px', borderRadius: 999,
              background: tierBg, color: accent, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>{tier}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {stats.map(({ label, value }) => (
            <div key={label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px', boxShadow: SHADOW.card }}>
              <div style={{ fontSize: 9.5, color: COLORS.textHint, letterSpacing: '0.12em', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
              <div style={{
                fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 400,
                color: COLORS.textPrimary, letterSpacing: '-0.015em', lineHeight: 1.2,
              }}>{value ?? '—'}</div>
            </div>
          ))}
        </div>

        {/* Tags */}
        {customer.tags?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {customer.tags.map(t => (
              <span key={t} style={{ fontSize: 12, padding: '4px 10px', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 999, color: COLORS.textSecondary }}>
                {t}
              </span>
            ))}
          </div>
        )}

        {/* AI Notes */}
        {customer.ai_notes && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: COLORS.teal, fontWeight: 600, marginBottom: 6 }}>🧠 AI Notes</div>
            <p style={{ fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.6, margin: 0 }}>{customer.ai_notes}</p>
          </div>
        )}

        {/* Owner notes */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em' }}>MY NOTES</div>
            {saveState === 'saving' && <span style={{ fontSize: 11, color: COLORS.textHint }}>Saving…</span>}
            {saveState === 'saved'  && <span style={{ fontSize: 11, color: COLORS.green }}>✓ Saved</span>}
            {saveState === 'error'  && <span style={{ fontSize: 11, color: COLORS.red }}>Error saving</span>}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onFocus={e => (e.target.style.borderColor = COLORS.teal)}
            onBlur={e => { e.target.style.borderColor = COLORS.border; saveNotes(e.target.value); }}
            placeholder="Add private notes about this client…"
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: COLORS.bg, border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.md, padding: '10px 12px',
              fontSize: 14, color: COLORS.textPrimary, fontFamily: FONT.body,
              lineHeight: 1.6, resize: 'vertical', outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
        </div>

        {/* Recent messages */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>RECENT MESSAGES</div>
          {messages.length === 0 ? (
            <p style={{ fontSize: 13, color: COLORS.textHint, textAlign: 'center', padding: '12px 0' }}>No messages yet</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map(m => {
                const isOwner = m.direction === 'outbound';
                const isAmh   = isAmharic(m.content);
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isOwner ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '80%', padding: '8px 12px', borderRadius: isOwner ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                      fontSize: 14, lineHeight: 1.5,
                      background: isOwner ? COLORS.teal : '#F3F4F6',
                      color: isOwner ? '#FFFFFF' : COLORS.textPrimary,
                      fontFamily: isAmh ? FONT.amharic : FONT.body,
                    }}>
                      {m.content}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
