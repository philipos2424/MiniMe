'use client';
/**
 * People you know — teach the secretary who your family & friends are.
 *
 * In secretary mode the assistant replies AS you on your personal Telegram, so
 * it needs to know who each person is, the names/nicknames YOU call them, and a
 * little context — so it talks to them the way you actually would, and never
 * pitches the business to them.
 *
 * This screen edits `notification_prefs.personal_contacts` (the owner's source
 * of truth). Each entry: { telegram_id, name, relation, aliases[], context }.
 * The secretary ALSO auto-learns nicknames from your chats; anything you set
 * here is treated as authoritative and merged on top.
 *
 * Contacts are added by forwarding a message from the person and sending
 * /personal in Telegram (we need their Telegram ID). Here you teach & correct.
 */
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar from '../../../../components/ui/SaveBar';
import { tgAlert, tgConfirm } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

const INPUT = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', borderRadius: RADII.md,
  border: `1px solid ${COLORS.border}`, background: COLORS.surface,
  fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary, outline: 'none',
};

export default function PeoplePage() {
  const { business, setBusiness } = useTelegram() || {};
  const supabase = createClient();

  const [contacts, setContacts] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!business) return;
    const raw = business.notification_prefs?.personal_contacts || [];
    // Normalize: ensure aliases is an editable comma string, context a string.
    setContacts(raw.map(c => ({
      telegram_id: c.telegram_id,
      name: c.name || '',
      relation: c.relation === 'family' ? 'family' : 'friend',
      aliasesText: Array.isArray(c.aliases) ? c.aliases.join(', ') : (c.address_as || ''),
      context: c.context || '',
    })));
  }, [business?.id]); // eslint-disable-line

  function update(idx, key, val) {
    setContacts(cs => cs.map((c, i) => (i === idx ? { ...c, [key]: val } : c)));
    setDirty(true);
  }

  async function remove(idx) {
    const c = contacts[idx];
    const ok = await tgConfirm(`Remove ${c.name || 'this contact'}? The secretary will treat them as a normal contact again.`);
    if (!ok) return;
    setContacts(cs => cs.filter((_, i) => i !== idx));
    setDirty(true);
  }

  async function save() {
    if (!business?.id) return;
    setSaving(true);
    const cleaned = contacts.map(c => ({
      telegram_id: c.telegram_id,
      name: (c.name || '').trim().slice(0, 80),
      relation: c.relation === 'family' ? 'family' : 'friend',
      aliases: (c.aliasesText || '')
        .split(',').map(a => a.trim()).filter(Boolean).slice(0, 8),
      context: (c.context || '').trim().slice(0, 400),
    }));
    const prefs = { ...(business.notification_prefs || {}), personal_contacts: cleaned };
    const { error } = await supabase.from('businesses')
      .update({ notification_prefs: prefs }).eq('id', business.id);
    setSaving(false);
    if (error) { tgAlert('Could not save — check your connection and try again.'); return; }
    if (setBusiness) setBusiness(b => ({ ...b, notification_prefs: prefs }));
    setSaved(true); setDirty(false);
    setTimeout(() => setSaved(false), 2500);
  }

  const pill = (active) => ({
    flex: 1, padding: '8px 0', borderRadius: RADII.md, border: 'none',
    fontFamily: FONT.body, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: active ? COLORS.ink : 'rgba(138,149,144,0.12)',
    color: active ? '#fff' : COLORS.textSecondary,
  });

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, paddingBottom: 100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: SERIF }}>
        People you know
      </h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px', lineHeight: 1.5 }}>
        When the secretary replies as you, it should talk to your family and friends the way <em>you</em> do.
        Tell it who they are, the names you call them, and anything worth remembering. It also learns these from
        your chats — what you set here always wins.
      </p>

      {contacts.length === 0 ? (
        <div style={{ background: COLORS.cream, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No people added yet</div>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0, lineHeight: 1.55 }}>
            To add someone, open Telegram, <strong>forward a message from them</strong> to yourself and send
            <code style={{ background: COLORS.surface, padding: '1px 6px', borderRadius: 6, margin: '0 4px' }}>/personal</code>.
            They'll appear here, and you can teach the secretary their nicknames and context.
          </p>
        </div>
      ) : (
        contacts.map((c, idx) => (
          <div key={c.telegram_id || idx} style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: 16, marginBottom: 12, boxShadow: SHADOW.card,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 20 }}>{c.relation === 'family' ? '👨‍👩‍👧' : '👫'}</span>
              <input
                value={c.name}
                onChange={e => update(idx, 'name', e.target.value)}
                style={{ ...INPUT, fontWeight: 600, flex: 1 }}
                placeholder="Their name"
              />
              <button
                onClick={() => remove(idx)}
                style={{ border: 'none', background: 'transparent', color: COLORS.textHint, cursor: 'pointer', fontSize: 13, padding: 6 }}
              >
                Remove
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => update(idx, 'relation', 'family')} style={pill(c.relation === 'family')}>👨‍👩‍👧 Family</button>
              <button onClick={() => update(idx, 'relation', 'friend')} style={pill(c.relation === 'friend')}>👫 Friend</button>
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              What you call them
            </label>
            <input
              value={c.aliasesText}
              onChange={e => update(idx, 'aliasesText', e.target.value)}
              style={{ ...INPUT, marginBottom: 4 }}
              placeholder="e.g. bro, Sami, እማዬ"
            />
            <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 12, lineHeight: 1.4 }}>
              The nicknames you actually use — separate them with commas. The secretary will use these naturally.
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              Things to remember
            </label>
            <textarea
              value={c.context}
              onChange={e => update(idx, 'context', e.target.value)}
              rows={3}
              style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="e.g. My younger brother, studying in the US. Getting married in Meskerem. Never bring up the business with him."
            />
            <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 4, lineHeight: 1.4 }}>
              Context that helps the secretary sound like you — ongoing topics, plans, sensitivities.
            </div>
          </div>
        ))
      )}

      <SaveBar dirty={dirty} saving={saving} saved={saved} onSave={save} label="Save people" />
    </div>
  );
}
