'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

// What happens when someone NEW messages your personal account. These lived only
// in the database (and the "Always reply, stop asking" button) until now.
const NEW_PEOPLE = [
  { key: 'ask_first', label: 'Ask me who they are', sub: 'I hold the reply and send you a card: Family, Friend or Customer.' },
  { key: 'smart',     label: 'Smart — reply when it’s clear',  sub: 'I reply on my own when the first message clearly shows a customer, friend or family. If I’m unsure, I hold it and ask you once.' },
  { key: 'auto',      label: "Don't ask — just reply", sub: 'I read the chat, work out who they are myself, and answer.' },
  { key: 'ghost',     label: 'Stay silent',           sub: 'I never reply on your personal account. You still get the daily summary.' },
];
const ALERTS = [
  { key: 'all',   label: 'Every reply' },
  { key: 'first', label: 'First reply only' },
  { key: 'off',   label: 'None' },
];
const IDENTITY = [
  { key: 'always_disclose',   label: 'Always say' },
  { key: 'honest_when_asked', label: 'Only if asked' },
  { key: 'mimic_owner',       label: 'Never say' },
];

function PersonalAccountCard({ initData, card }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/settings/secretary', { headers: { 'x-telegram-init-data': initData } })
      .then(r => (r.ok ? r.json() : null)).then(d => d && setS(d)).catch(() => {});
  }, [initData]);

  async function save(patch) {
    if (busy) return;
    const prev = s;
    setS(cur => ({ ...cur, ...patch, ai_identity_mode: { ...cur.ai_identity_mode, ...(patch.ai_identity_mode || {}) } }));
    setBusy(true);
    try {
      const r = await fetch('/api/settings/secretary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error('save_failed');
      setS(await r.json());
    } catch {
      setS(prev);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;

  const label = { fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '16px 0 8px' };
  const pill = (active) => ({
    flex: 1, padding: '8px 4px', borderRadius: RADII.md, border: 'none',
    fontFamily: FONT.body, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
    background: active ? COLORS.ink : 'rgba(138,149,144,0.12)',
    color: active ? '#fff' : COLORS.textSecondary,
  });

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Your personal account</div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.4 }}>
        How MiniMe behaves when it replies as you on your own Telegram.
      </div>

      <div style={label}>When someone new messages you</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {NEW_PEOPLE.map(o => {
          const on = s.secretary_mode === o.key;
          return (
            <button key={o.key} onClick={() => !on && save({ secretary_mode: o.key })} disabled={busy}
              style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: RADII.md, cursor: busy ? 'wait' : 'pointer',
                border: `1.5px solid ${on ? COLORS.ink : COLORS.border}`,
                background: on ? COLORS.cream : COLORS.surface, fontFamily: FONT.body, color: COLORS.textPrimary,
              }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{on ? '● ' : '○ '}{o.label}</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 1.4 }}>{o.sub}</div>
            </button>
          );
        })}
      </div>

      <div style={label}>Alerts when I reply as you</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {ALERTS.map(o => (
          <button key={o.key} disabled={busy} style={pill(s.secretary_alerts === o.key)}
            onClick={() => save({ secretary_alerts: o.key })}>{o.label}</button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
        <input type="checkbox" disabled={busy} checked={s.alerts_personal !== false}
          onChange={e => save({ alerts_personal: e.target.checked })} />
        Also alert me about family &amp; friends
      </label>
      <div style={{ fontSize: 11, color: COLORS.textHint, lineHeight: 1.4, marginTop: 4 }}>
        Replies are still sent — this only controls the "Replied as you" message. Anything unsure still reaches you.
      </div>

      {(s.contact_rules || []).length > 0 && (
        <>
          <div style={label}>People with their own rule</div>
          {s.contact_rules.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i ? `1px solid ${COLORS.border}` : 'none' }}>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
                {c.name}
                <span style={{ color: COLORS.textHint }}> · {c.rule === 'never' ? 'never reply' : c.rule === 'auto' ? 'always reply' : 'ask me'}</span>
              </div>
              <button disabled={busy} onClick={() => save({ contact_rule: { id: c.id, rule: null } })}
                style={{ border: 'none', background: 'transparent', color: COLORS.textHint, cursor: 'pointer', fontSize: 12, padding: 6 }}>
                Reset
              </button>
            </div>
          ))}
        </>
      )}

      <div style={label}>Tell people it's an AI?</div>
      {[['customers', 'Customers'], ['personal', 'Friends & family']].map(([k, name]) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{name}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {IDENTITY.map(o => (
              <button key={o.key} disabled={busy} style={pill(s.ai_identity_mode[k] === o.key)}
                onClick={() => save({ ai_identity_mode: { [k]: o.key } })}>{o.label}</button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: COLORS.textHint, lineHeight: 1.4 }}>
        "Never say" never lies if someone asks directly — it changes the subject.
      </div>

      <div style={label}>What MiniMe believes about you</div>
      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 8, lineHeight: 1.4 }}>
        Learned from your chats and used when people ask about your life. Remove anything wrong — it will repeat it otherwise.
      </div>
      {s.owner_facts.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.textHint }}>Nothing learned yet.</div>
      ) : s.owner_facts.map((f, i) => (
        <div key={`${i}-${f}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: i ? `1px solid ${COLORS.border}` : 'none' }}>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{f}</div>
          <button disabled={busy} onClick={() => save({ owner_facts: s.owner_facts.filter((_, j) => j !== i) })}
            style={{ border: 'none', background: 'transparent', color: COLORS.textHint, cursor: 'pointer', fontSize: 12, padding: 6 }}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export default function ModesPage() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();
  const [saving, setSaving] = useState(false);

  const biz = ctxBusiness || {};
  const botOn = !!(biz.telegram_bot_username || biz.shop_code);

  async function toggleBot() {
    if (!biz.id || saving) return;
    setSaving(true);
    try {
      // Toggle the bot on/off by setting/clearing the shop_code
      const next = !botOn;
      await updateBusiness(initData, { 
        notification_prefs: { 
          ...(biz.notification_prefs || {}),
          bot_enabled: next 
        } 
      });
      setBusiness(b => ({ 
        ...b, 
        notification_prefs: { 
          ...(b.notification_prefs || {}),
          bot_enabled: next 
        } 
      }));
    } catch (e) {
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const card = {
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    borderRadius: RADII.lg, padding: 20, marginBottom: 16,
    textDecoration: 'none', color: 'inherit', display: 'block',
  };

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, padding: '20px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 8px', letterSpacing: '-0.02em', fontFamily: SERIF }}>
        Settings
      </h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 24px', lineHeight: 1.5 }}>
        Manage your shop profile, chat automation, and app settings.
      </p>

      {/* ── Card 1: Edit Profile ─────────────────────────────────────── */}
      <Link href="/settings/profile" style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ 
            width: 48, height: 48, borderRadius: 14, 
            background: 'rgba(79,163,138,0.1)', display: 'grid', placeItems: 'center',
            fontSize: 24, flexShrink: 0,
          }}>
            🏪
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Edit Profile</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.4 }}>
              Business name, category, contact info, and social links
            </div>
          </div>
          <span style={{ color: COLORS.textHint, fontSize: 20 }}>›</span>
        </div>
      </Link>

      {/* ── Card 2: Chat Automation ──────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ 
            width: 48, height: 48, borderRadius: 14, 
            background: 'rgba(79,163,138,0.1)', display: 'grid', placeItems: 'center',
            fontSize: 24, flexShrink: 0,
          }}>
            🤖
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Chat Automation</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.4 }}>
              Auto-reply to customers, set working hours, and manage trust levels
            </div>
          </div>
        </div>

        {/* Bot status + toggle */}
        <div style={{ 
          background: COLORS.cream, borderRadius: RADII.md, padding: 14, 
          marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.textPrimary }}>
              {botOn ? '🟢 Bot Active' : '⚪ Bot Paused'}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
              {botOn 
                ? 'Auto-replying to customer messages' 
                : 'Bot is paused — no auto-replies'}
            </div>
          </div>
          <button
            onClick={toggleBot}
            disabled={saving}
            style={{
              padding: '8px 16px', borderRadius: RADII.md,
              border: 'none', cursor: saving ? 'wait' : 'pointer',
              fontFamily: FONT.body, fontWeight: 600, fontSize: 13,
              background: botOn ? COLORS.red : COLORS.green, color: '#fff',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {botOn ? 'Pause' : 'Activate'}
          </button>
        </div>

        {/* Quick settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Link href="/settings/trust" style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', background: COLORS.surface, borderRadius: RADII.md,
            border: `1px solid ${COLORS.border}`, textDecoration: 'none', color: 'inherit',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Trust Level</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary }}>How much autonomy the bot has</div>
            </div>
            <span style={{ color: COLORS.textHint, fontSize: 18 }}>›</span>
          </Link>

          <Link href="/settings/hours" style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', background: COLORS.surface, borderRadius: RADII.md,
            border: `1px solid ${COLORS.border}`, textDecoration: 'none', color: 'inherit',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Working Hours</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary }}>When the bot should reply</div>
            </div>
            <span style={{ color: COLORS.textHint, fontSize: 18 }}>›</span>
          </Link>

          <Link href="/settings/character" style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', background: COLORS.surface, borderRadius: RADII.md,
            border: `1px solid ${COLORS.border}`, textDecoration: 'none', color: 'inherit',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Personality</div>
              <div style={{ fontSize: 12, color: COLORS.textSecondary }}>Tone and style of replies</div>
            </div>
            <span style={{ color: COLORS.textHint, fontSize: 18 }}>›</span>
          </Link>
        </div>
      </div>

      <PersonalAccountCard initData={initData} card={card} />

      {/* ── Card 3: Enter MiniMe ─────────────────────────────────────── */}
      <Link href="/dashboard" style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ 
            width: 48, height: 48, borderRadius: 14, 
            background: 'rgba(79,163,138,0.1)', display: 'grid', placeItems: 'center',
            fontSize: 24, flexShrink: 0,
          }}>
            💬
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Enter MiniMe</div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.4 }}>
              View conversations, manage customers, and see activity
            </div>
          </div>
          <span style={{ color: COLORS.textHint, fontSize: 20 }}>›</span>
        </div>
      </Link>
    </div>
  );
}
