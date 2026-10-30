'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';
import { isPaymentDetailFact } from '../../../../lib/paymentFacts.mjs';

const SERIF = "'Newsreader', Georgia, serif";
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'MiniMeAgentBot';

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

function PersonalAccountCard({ initData, card, onStatus }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/settings/secretary', { headers: { 'x-telegram-init-data': initData } })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (d) { setS(d); onStatus?.(!!d.connected); } }).catch(() => {});
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
      {/* Say what Secretary is doing right now, in one sentence. */}
      <div style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {s.connected ? '✅ Connected to your Telegram account' : '○ Not connected to your Telegram account yet'}
        </div>
        {s.connected && <div style={{ color: COLORS.textSecondary }}>{s.explainer}</div>}
        {s.connected && s.waiting > 0 && s.secretary_mode === 'ask_first' && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: RADII.md, background: 'rgba(200,140,40,0.12)' }}>
            <strong>{s.waiting} {s.waiting === 1 ? 'person is' : 'people are'} waiting</strong> for you to say who they are — I haven&apos;t replied to them.
            Their cards are in your MiniMe chat on Telegram. Or pick <strong>Smart</strong> below and I&apos;ll answer the clear customers myself.
          </div>
        )}
      </div>

      <div style={{ ...label, marginTop: 0 }}>When someone new messages you</div>
      <div role="radiogroup" aria-label="When someone new messages you" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {NEW_PEOPLE.map(o => {
          const on = s.secretary_mode === o.key;
          return (
            <button key={o.key} role="radio" aria-checked={on} onClick={() => !on && save({ secretary_mode: o.key })} disabled={busy}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                textAlign: 'left', padding: '12px 14px', borderRadius: RADII.md, cursor: busy ? 'wait' : 'pointer',
                border: `1.5px solid ${on ? COLORS.ink : COLORS.border}`,
                background: on ? COLORS.cream : COLORS.surface, fontFamily: FONT.body, color: COLORS.textPrimary,
              }}>
              <span aria-hidden style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                border: `2px solid ${on ? COLORS.ink : COLORS.border}`, display: 'grid', placeItems: 'center',
              }}>
                {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.ink }} />}
              </span>
              <span>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{o.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 1.4 }}>{o.sub}</span>
              </span>
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 13, lineHeight: 1.4, cursor: busy ? 'wait' : 'pointer' }}>
        <input type="checkbox" disabled={busy} checked={s.alerts_personal !== false}
          onChange={e => save({ alerts_personal: e.target.checked })}
          style={{ width: 18, height: 18, margin: 0, flexShrink: 0, accentColor: COLORS.ink }} />
        <span>Also alert me about family &amp; friends</span>
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
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
            {f}
            {isPaymentDetailFact(f) && (
              <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                Not used. MiniMe only gives customers the payment details in <Link href="/settings/payments">Payments</Link>.
              </div>
            )}
          </div>
          <button disabled={busy} onClick={() => save({ owner_facts: s.owner_facts.filter((_, j) => j !== i) })}
            style={{ border: 'none', background: 'transparent', color: COLORS.textHint, cursor: 'pointer', fontSize: 12, padding: 6 }}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Secretary Mode — how MiniMe replies as the owner on their personal Telegram.
 *
 * This page used to be a second, older "Settings" page: Edit Profile, Trust,
 * Hours and Personality all duplicated the grouped Settings menu, and its
 * "Pause" button wrote notification_prefs.bot_enabled, which nothing reads,
 * so owners were told their bot was paused while it kept replying. Those
 * cards are gone; pausing lives in Business Profile (panic_mode).
 */
export default function ModesPage() {
  const { initData } = useTelegram();
  // null = still loading; the connect steps show until we know it's connected.
  const [connected, setConnected] = useState(null);


  const card = {
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    borderRadius: RADII.lg, padding: 20, marginBottom: 16,
    textDecoration: 'none', color: 'inherit', display: 'block',
  };

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, padding: '20px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 8px', letterSpacing: '-0.02em', fontFamily: SERIF }}>
        Secretary Mode
      </h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 24px', lineHeight: 1.5 }}>
        How MiniMe replies as you on your own Telegram when you&apos;re busy.
      </p>

      <PersonalAccountCard initData={initData} card={card} onStatus={setConnected} />

      {/* Team and Advisor send "Connect" taps here, so say how. Same steps as onboarding. */}
      {connected !== true && <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Not connected yet?</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.7 }}>
          <li>Open <strong>Telegram Settings</strong> on your phone</li>
          <li>Tap <strong>Business</strong>, then <strong>Chatbots</strong></li>
          <li>Type <strong>@{BOT_USERNAME}</strong> and add it</li>
        </ol>
        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 8, lineHeight: 1.4 }}>
          Telegram Business needs Telegram Premium. When you add MiniMe, turn on <strong>Reply to messages</strong>.
        </div>
      </div>}
    </div>
  );
}
