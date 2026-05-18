'use client';
/**
 * CustomerProfile — redesigned with design tokens.
 */
import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { timeAgo, formatPrice } from '../../lib/utils';
import { createClient } from '../../lib/supabase-browser';
import { useTelegram } from '../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW, isAmharic } from '../../lib/design-tokens';

const TIER_ACCENT = { gold: '#B08A4A', silver: '#708090', bronze: '#B87333', vip: '#7C3AED', regular: '#059669', new: '#D97706' };
const TIER_BG     = { gold: '#FEF9EE', silver: '#F5F7F8', bronze: '#FDF4ED', vip: '#F3F0FF', regular: '#F0FDF4', new: '#FFFBEB' };

const ORDER_STATUS = {
  pending_payment: { label: 'Awaiting payment', color: COLORS.amber,    bg: COLORS.amberLight },
  paid:            { label: 'Paid',              color: COLORS.green,    bg: COLORS.greenLight },
  fulfilled:       { label: 'Fulfilled',         color: COLORS.teal,     bg: COLORS.tealLight  },
  cancelled:       { label: 'Cancelled',         color: COLORS.textHint, bg: COLORS.border     },
  refunded:        { label: 'Refunded',          color: COLORS.red,      bg: COLORS.redLight   },
};

// ─── Tag editor ───────────────────────────────────────────────────────────────
const PRESET_TAGS = ['vip', 'wholesale', 'regular', 'delivery', 'bole', 'new customer', 'follow up', 'catering'];

function TagEditor({ customerId, businessId, initialTags }) {
  const [tags, setTags] = useState(initialTags);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  async function persist(updated) {
    setSaving(true);
    await createClient().from('customers').update({ tags: updated }).eq('id', customerId);
    setSaving(false);
  }

  async function addTag(tag) {
    const t = tag.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    const updated = [...tags, t];
    setTags(updated);
    setNewTag('');
    await persist(updated);
  }

  async function removeTag(t) {
    const updated = tags.filter(x => x !== t);
    setTags(updated);
    await persist(updated);
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Labels</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map(t => (
          <span key={t} onClick={() => removeTag(t)} style={{
            fontSize: 12, padding: '4px 10px', borderRadius: 999,
            background: `${COLORS.teal}15`, border: `1px solid ${COLORS.teal}40`,
            color: COLORS.teal, cursor: 'pointer', fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {t} <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
          </span>
        ))}
        {tags.length === 0 && (
          <span style={{ fontSize: 12, color: COLORS.textHint, fontStyle: 'italic' }}>No labels yet — add one below</span>
        )}
      </div>
      {/* Preset quick-add */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
        {PRESET_TAGS.filter(t => !tags.includes(t)).map(t => (
          <button key={t} onClick={() => addTag(t)} style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 999,
            border: `1px dashed ${COLORS.border}`, background: 'transparent',
            color: COLORS.textHint, cursor: 'pointer', fontFamily: FONT.body,
          }}>+ {t}</button>
        ))}
      </div>
      {/* Custom tag input */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newTag} onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTag(newTag); }}
          placeholder="Custom label..."
          style={{
            flex: 1, padding: '7px 10px', border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.md, fontSize: 13, fontFamily: FONT.body,
            color: COLORS.textPrimary, background: COLORS.surface, outline: 'none',
          }}
        />
        <button onClick={() => addTag(newTag)} disabled={!newTag.trim() || saving} style={{
          padding: '7px 12px', borderRadius: RADII.md, border: 'none',
          background: newTag.trim() ? COLORS.teal : COLORS.border,
          color: '#fff', fontSize: 13, cursor: newTag.trim() ? 'pointer' : 'default',
          fontFamily: FONT.body,
        }}>Add</button>
      </div>
    </div>
  );
}

export default function CustomerProfile({ customer, messages }) {
  const { initData } = useTelegram() || {};
  const [name, setName] = useState(customer.name || 'Unknown');
  const [renamedByOwner, setRenamedByOwner] = useState(!!customer.meta?.renamed_by_owner);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState('');
  const [birthday, setBirthday] = useState(customer.birthday ? customer.birthday.slice(5) : ''); // MM-DD
  const [savingBirthday, setSavingBirthday] = useState(false);

  const tier   = customer.tier || 'new';
  const accent = TIER_ACCENT[tier] || COLORS.textHint;
  const tierBg = TIER_BG[tier]     || '#F3F4F6';

  async function saveName() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === name) { setEditing(false); return; }
    if (!initData) { setRenameErr('Open inside Telegram'); return; }
    setRenameBusy(true); setRenameErr('');
    try {
      const r = await fetch(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setName(trimmed);
      setRenamedByOwner(true);
      setEditing(false);
    } catch (e) {
      setRenameErr(e.message);
    } finally {
      setRenameBusy(false);
    }
  }

  // Orders for this customer
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    createClient()
      .from('orders')
      .select('id, status, total, currency, items, created_at, paid_at')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setOrders(data || []));
  }, [customer.id]);

  // Customer memory — auto-extracted facts the bot knows about this customer
  const [memory, setMemory] = useState([]);
  useEffect(() => {
    createClient()
      .from('customer_memory')
      .select('id, kind, content, source, created_at')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setMemory(data || []));
  }, [customer.id]);

  // Conversation link for "DM" button
  const [convId, setConvId] = useState(customer.conversation_id || null);
  useEffect(() => {
    if (convId || !customer.id) return;
    createClient()
      .from('conversations')
      .select('id')
      .eq('customer_id', customer.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.[0]) setConvId(data[0].id); });
  }, [customer.id, convId]);

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

  const loyaltyPts   = customer.loyalty_points || 0;
  const loyaltyBadge = loyaltyPts >= 500 ? '🥇 Gold' : loyaltyPts >= 100 ? '🥈 Silver' : '🥉 Bronze';
  const nextTierPts  = loyaltyPts >= 500 ? null : loyaltyPts >= 100 ? 500 - loyaltyPts : 100 - loyaltyPts;
  const nextTierName = loyaltyPts >= 500 ? null : loyaltyPts >= 100 ? 'Gold' : 'Silver';

  const stats = [
    { label: 'Loyalty',       value: `${loyaltyBadge} · ${loyaltyPts} pts` },
    { label: 'Total Orders',  value: customer.total_orders ?? 0 },
    { label: 'Total Spent',   value: formatPrice ? formatPrice(customer.total_spent) : `${Number(customer.total_spent || 0).toLocaleString()} ETB` },
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
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  autoFocus
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') { setEditing(false); setDraftName(name); setRenameErr(''); }
                  }}
                  maxLength={80}
                  style={{
                    flex: 1, minWidth: 0, fontSize: 20, fontWeight: 400,
                    fontFamily: "'Fraunces', Georgia, serif", letterSpacing: '-0.02em',
                    background: COLORS.bg, border: `1.5px solid ${COLORS.teal}`,
                    borderRadius: RADII.sm, padding: '4px 8px', outline: 'none',
                    color: COLORS.textPrimary, boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={saveName}
                  disabled={renameBusy}
                  style={{ background: COLORS.teal, color: '#FFF', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: renameBusy ? 'default' : 'pointer' }}
                  title="Save"
                ><Check size={14} /></button>
                <button
                  onClick={() => { setEditing(false); setDraftName(name); setRenameErr(''); }}
                  style={{ background: 'transparent', color: COLORS.textHint, border: `1px solid ${COLORS.border}`, borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  title="Cancel"
                ><X size={14} /></button>
              </div>
            ) : (
              <h1
                onClick={() => { setDraftName(name); setEditing(true); }}
                title="Click to rename"
                style={{
                  fontSize: 22, fontWeight: 400, margin: 0, letterSpacing: '-0.02em',
                  fontFamily: "'Fraunces', Georgia, serif",
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                {name}
                <Pencil size={13} color={COLORS.textHint} style={{ opacity: 0.7 }} />
              </h1>
            )}
            {renameErr && <div style={{ fontSize: 11, color: COLORS.red, marginTop: 3 }}>{renameErr}</div>}
            {customer.telegram_username && (
              <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
                @{customer.telegram_username}
                {renamedByOwner && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: COLORS.textHint, fontStyle: 'italic' }}>· renamed by you</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{
                fontSize: 10, padding: '3px 9px', borderRadius: 999,
                background: tierBg, color: accent, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{tier}</span>
              {customer.phone && (
                <span style={{ fontSize: 12, color: COLORS.textHint }}>📱 {customer.phone}</span>
              )}
            </div>
          </div>
          {/* DM button */}
          {convId && (
            <Link href={`/conversations/${convId}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: COLORS.teal, color: '#fff',
                padding: '8px 14px', borderRadius: RADII.md,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                <MessageCircle size={15} />
                Chat
              </div>
            </Link>
          )}
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

        {/* Loyalty progress bar */}
        {nextTierPts !== null && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary }}>{loyaltyBadge}</span>
              <span style={{ fontSize: 11, color: COLORS.textHint }}>{nextTierPts} pts to {nextTierName}</span>
            </div>
            <div style={{ height: 6, background: COLORS.border, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999, background: COLORS.teal,
                width: `${Math.min(100, (loyaltyPts / (loyaltyPts >= 100 ? 500 : 100)) * 100)}%`,
                transition: 'width .4s ease',
              }} />
            </div>
          </div>
        )}

        {/* Tags — editable */}
        <TagEditor customerId={customer.id} businessId={customer.business_id} initialTags={customer.tags || []} />

        {/* Birthday field */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>🎂 BIRTHDAY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="text"
              value={birthday}
              onChange={e => setBirthday(e.target.value.replace(/[^0-9\-]/g, '').slice(0, 5))}
              onBlur={async () => {
                if (!initData || savingBirthday) return;
                // Validate MM-DD format
                if (birthday && !/^\d{2}-\d{2}$/.test(birthday)) return;
                setSavingBirthday(true);
                const fullDate = birthday ? `2000-${birthday}` : null;
                try {
                  await createClient().from('customers').update({ birthday: fullDate }).eq('id', customer.id);
                } catch {}
                setSavingBirthday(false);
              }}
              placeholder="MM-DD (e.g. 07-15)"
              maxLength={5}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: RADII.md,
                border: `1px solid ${COLORS.border}`, background: COLORS.bg,
                fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary, outline: 'none',
              }}
            />
            {savingBirthday && <span style={{ fontSize: 11, color: COLORS.textHint }}>Saving…</span>}
            {birthday && !savingBirthday && (
              <span style={{ fontSize: 12, color: COLORS.textHint }}>
                {(() => {
                  try {
                    const [mm, dd] = birthday.split('-');
                    return new Date(2000, parseInt(mm) - 1, parseInt(dd)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
                  } catch { return ''; }
                })()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 6 }}>
            The bot will wish them a happy birthday automatically.
          </div>
        </div>

        {/* AI Notes */}
        {customer.ai_notes && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: COLORS.teal, fontWeight: 600, marginBottom: 6 }}>🧠 AI Notes</div>
            <p style={{ fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.6, margin: 0 }}>{customer.ai_notes}</p>
          </div>
        )}

        {/* What the bot knows about this customer */}
        {memory.length > 0 && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.teal, letterSpacing: '0.08em', marginBottom: 10 }}>🧠 WHAT THE BOT KNOWS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {memory.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: m.kind === 'preference' ? COLORS.teal : m.kind === 'feedback' ? COLORS.amber : COLORS.textHint,
                    background: m.kind === 'preference' ? `${COLORS.teal}15` : m.kind === 'feedback' ? `${COLORS.amber}20` : COLORS.border,
                    padding: '2px 6px', borderRadius: 4, marginTop: 2, flexShrink: 0,
                  }}>{m.kind}</span>
                  <span style={{ fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.45 }}>{m.content}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: COLORS.textHint, fontStyle: 'italic' }}>
              Auto-learned from conversations · the bot uses these to personalise replies
            </div>
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

        {/* Order history */}
        {orders.length > 0 && (
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>ORDER HISTORY</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orders.map(o => {
                const st = ORDER_STATUS[o.status] || ORDER_STATUS.pending_payment;
                const itemSummary = Array.isArray(o.items) && o.items.length
                  ? o.items.map(it => `${it.quantity || 1}× ${it.name || 'item'}`).join(', ')
                  : null;
                return (
                  <div key={o.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '10px 12px', background: COLORS.bg, borderRadius: RADII.md,
                    border: `1px solid ${COLORS.border}`,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>
                        {Number(o.total || 0).toLocaleString()} {o.currency || 'ETB'}
                      </div>
                      {itemSummary && (
                        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {itemSummary}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                        {timeAgo(o.paid_at || o.created_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
                      background: st.bg, color: st.color, flexShrink: 0,
                    }}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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


      {/* GDPR section */}
      <div style={{ padding: '0 20px 32px' }}>
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: RADII.lg, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', letterSpacing: '0.08em', marginBottom: 8 }}>DATA & PRIVACY (GDPR)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={'/api/customers/' + customer.id + '/export'}
              download
              style={{ padding: '8px 14px', borderRadius: RADII.md, background: COLORS.bg, border: '1px solid ' + COLORS.border, color: COLORS.textSecondary, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
            >
              📦 Export data
            </a>
          </div>
          <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 8 }}>GDPR Art. 20 (portability) · Art. 17 (erasure) — orders are kept for accounting.</div>
        </div>
      </div>
      </div>
    </div>
  );
}
