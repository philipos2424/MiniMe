'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { createClient } from '../../../../lib/supabase-browser';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

const TRUST_NAMES = {
  0: { name: 'Shadow', desc: 'watching only — never sends' },
  1: { name: 'Supervised', desc: 'drafts every reply for you to approve' },
  2: { name: 'Trusted', desc: 'auto-sends routine replies, flags the tricky ones' },
  3: { name: 'Full Agent', desc: 'handles everything, you read the daily recap' },
};

export default function ModesPage() {
  const { business: ctxBusiness, setBusiness } = useTelegram();
  const supabase = createClient();

  const [localPanic, setLocalPanic] = useState(null);
  const [localDisc, setLocalDisc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingDisc, setSavingDisc] = useState(false);
  // Local overrides for the AI-identity radios (so the UI stays snappy while the
  // network round-trip flies). Cleared on the next render that picks up the new
  // saved value from context.
  const [localIdentityCustomers, setLocalIdentityCustomers] = useState(null);
  const [localIdentityPersonal,  setLocalIdentityPersonal]  = useState(null);
  const [savingIdentity, setSavingIdentity] = useState(false);

  const biz = ctxBusiness || {};
  const panic = localPanic !== null ? localPanic : !!biz.panic_mode;
  const disclosure = localDisc !== null ? localDisc : !!biz.notification_prefs?.ai_disclosure;
  // AI identity policy — defaults match replyEngine.js (customers honest-when-asked,
  // personal contacts mimic-owner). Both are owner-overridable below.
  const savedIdentity = biz.notification_prefs?.ai_identity_mode || {};
  const identityCustomers = localIdentityCustomers !== null ? localIdentityCustomers : (savedIdentity.customers || 'honest_when_asked');
  const identityPersonal  = localIdentityPersonal  !== null ? localIdentityPersonal  : (savedIdentity.personal  || 'mimic_owner');

  // Which modes are live for this business
  const secretaryOn = !!biz.telegram_biz_conn_id;
  const botOn = !!(biz.telegram_bot_username || biz.shop_code);
  const trust = biz.trust_level ?? 1;
  const trustInfo = TRUST_NAMES[trust] || TRUST_NAMES[1];

  async function togglePanic() {
    if (!biz.id || saving) return;
    const next = !panic;
    setSaving(true);
    setLocalPanic(next);
    const { error } = await supabase.from('businesses')
      .update({ panic_mode: next }).eq('id', biz.id);
    setSaving(false);
    if (error) {
      setLocalPanic(!next);
      tgAlert('Could not save — check your connection and try again.');
      return;
    }
    setBusiness(b => ({ ...b, panic_mode: next }));
  }

  async function toggleDisclosure() {
    if (!biz.id || savingDisc) return;
    const next = !disclosure;
    setSavingDisc(true);
    setLocalDisc(next);
    const prefs = { ...(biz.notification_prefs || {}), ai_disclosure: next };
    const { error } = await supabase.from('businesses')
      .update({ notification_prefs: prefs }).eq('id', biz.id);
    setSavingDisc(false);
    if (error) {
      setLocalDisc(!next);
      tgAlert('Could not save — check your connection and try again.');
      return;
    }
    setBusiness(b => ({ ...b, notification_prefs: prefs }));
  }

  // Update the per-contact-type AI identity policy. We merge into the existing
  // ai_identity_mode object so flipping one side never wipes the other.
  async function updateIdentity(side, value) {
    if (!biz.id || savingIdentity) return;
    if (side === 'customers') setLocalIdentityCustomers(value);
    else                       setLocalIdentityPersonal(value);
    setSavingIdentity(true);
    const merged = {
      ...(biz.notification_prefs?.ai_identity_mode || {}),
      [side]: value,
    };
    const prefs = { ...(biz.notification_prefs || {}), ai_identity_mode: merged };
    const { error } = await supabase.from('businesses')
      .update({ notification_prefs: prefs }).eq('id', biz.id);
    setSavingIdentity(false);
    if (error) {
      // Roll back the optimistic update
      if (side === 'customers') setLocalIdentityCustomers(null);
      else                       setLocalIdentityPersonal(null);
      tgAlert('Could not save — check your connection and try again.');
      return;
    }
    setBusiness(b => ({ ...b, notification_prefs: prefs }));
  }

  const card = {
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
    borderRadius: RADII.lg, padding: 16, marginBottom: 12,
  };
  const pill = (on) => ({
    fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999,
    background: on ? COLORS.greenLight : 'rgba(138,149,144,0.12)',
    color: on ? COLORS.green : COLORS.textHint,
  });

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 6px', letterSpacing: '-0.02em', fontFamily: SERIF }}>
        How your assistant works
      </h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px', lineHeight: 1.5 }}>
        MiniMe can reply in two ways. Here's exactly what each one does and how it talks to people — so no one is ever confused about who they're chatting with.
      </p>

      {/* ── Emergency pause — the master control ───────────────────────── */}
      <div style={{
        ...card,
        border: `2px solid ${panic ? COLORS.red : COLORS.border}`,
        background: panic ? COLORS.redLight : COLORS.surface,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>{panic ? '⏸️' : '✅'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: panic ? COLORS.red : COLORS.textPrimary }}>
              {panic ? 'AI is paused' : 'AI is active'}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2, lineHeight: 1.4 }}>
              {panic
                ? 'MiniMe is completely silent on every channel. Nobody gets an automatic reply until you turn it back on.'
                : 'MiniMe replies according to your trust level and the mode rules below.'}
            </div>
          </div>
          <button
            onClick={togglePanic}
            disabled={saving}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: RADII.md,
              border: 'none', cursor: saving ? 'wait' : 'pointer',
              fontFamily: FONT.body, fontWeight: 600, fontSize: 13,
              background: panic ? COLORS.green : COLORS.red, color: '#fff',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {panic ? 'Resume' : 'Pause all'}
          </button>
        </div>
      </div>

      {/* ── Mode: Secretary ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>🕴️</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Secretary</span>
          <span style={pill(secretaryOn)}>{secretaryOn ? 'Active' : 'Not connected'}</span>
        </div>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
          Replies <strong>as you</strong>, from your own personal Telegram. People see <em>your</em> name —
          they're chatting with you, not a bot. MiniMe reads the full chat history and knows who each person is.
        </p>
        <div style={{ fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.6 }}>
          <div><strong>With customers:</strong> answers questions, shares prices, takes orders — like a great front-desk assistant who knows your business.</div>
          <div style={{ marginTop: 6 }}><strong>With family &amp; friends:</strong> chats warmly and naturally, remembers your history together, and <strong>never pitches the business or sends prices</strong> — unless they specifically ask. Then it answers, and goes back to being personal.</div>
        </div>
      </div>

      {/* ── Mode: Bot ───────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Bot</span>
          <span style={pill(botOn)}>{botOn ? 'Active' : 'Not connected'}</span>
        </div>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
          A clearly-labeled assistant bot ({biz.telegram_bot_username ? `@${biz.telegram_bot_username}` : 'your shop bot'}).
          Customers know they're talking to your shop's assistant, not to you personally. Best for a public storefront
          where everyone who writes in is a customer — so it can always be helpful about products, prices and orders.
        </p>
      </div>

      {/* ── AI disclosure — transparency toggle ─────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>📣</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Tell customers an AI may reply</div>
            <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
              When on, the first time a new customer messages you, MiniMe sends a one-line note that replies may be
              AI-assisted, with a link to your privacy policy. It never shows this to family or friends.
              Some places (e.g. the EU) require this — turn it on if you sell to customers there.
            </div>
          </div>
          <button
            onClick={toggleDisclosure}
            disabled={savingDisc}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: RADII.md,
              border: 'none', cursor: savingDisc ? 'wait' : 'pointer',
              fontFamily: FONT.body, fontWeight: 600, fontSize: 13,
              background: disclosure ? COLORS.green : 'rgba(138,149,144,0.18)',
              color: disclosure ? '#fff' : COLORS.textSecondary,
              opacity: savingDisc ? 0.6 : 1,
            }}
          >
            {disclosure ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* ── AI identity policy — what to do when asked "are you a bot?" ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 20 }}>🎭</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>When asked "are you a bot?"</div>
            <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
              How honest your assistant is about being AI when someone directly asks. You can set this differently for customers vs family / friends.
            </div>
          </div>
        </div>

        <IdentityGroup
          label="With customers"
          value={identityCustomers}
          onChange={(v) => updateIdentity('customers', v)}
          options={[
            { v: 'honest_when_asked', label: 'Honest when asked', desc: 'Speaks as you. Admits being AI only if directly asked.' },
            { v: 'always_disclose',   label: 'Always disclose',    desc: 'Mentions early it\'s an AI assistant. Most transparent — EU AI Act friendly.' },
            { v: 'mimic_owner',       label: 'Mimic me',           desc: 'Never breaks character, even if asked. May not meet EU rules — use only if you don\'t sell to the EU.' },
          ]}
          savingFlag={savingIdentity}
        />

        <div style={{ height: 1, background: COLORS.divider, margin: '14px 0 10px' }} />

        <IdentityGroup
          label="With family & friends"
          value={identityPersonal}
          onChange={(v) => updateIdentity('personal', v)}
          options={[
            { v: 'mimic_owner',       label: 'Mimic me',           desc: 'Speaks fully as you. Deflects warmly if asked. Most natural for personal chats.' },
            { v: 'honest_when_asked', label: 'Honest when asked', desc: 'Admits being AI if family / friends directly ask.' },
            { v: 'always_disclose',   label: 'Always disclose',    desc: 'Tells personal contacts upfront they\'re chatting with your assistant.' },
          ]}
          savingFlag={savingIdentity}
        />
      </div>

      {/* ── The rule that ties it together ──────────────────────────────── */}
      <div style={{ ...card, background: COLORS.cream, border: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, marginBottom: 6, letterSpacing: '0.04em' }}>
          THE GOLDEN RULE
        </div>
        <p style={{ fontSize: 13, color: COLORS.textPrimary, margin: 0, lineHeight: 1.55 }}>
          The <strong>Secretary</strong> protects your personal relationships — it will chat with your mother without
          ever trying to sell her a product. The <strong>Bot</strong> is for your public storefront, where being helpful
          about the business is exactly what people want. Same brain, two manners.
        </p>
      </div>

      {/* ── Quick links to the knobs that shape behavior ────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.textHint, margin: '18px 0 8px' }}>
        Tune the behavior
      </div>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.divider}`, borderRadius: RADII.md, overflow: 'hidden' }}>
        <RuleLink href="/settings/trust" label="Trust & autonomy" sub={`${trustInfo.name} — ${trustInfo.desc}`} />
        <RuleLink href="/settings/character" label="Personality" sub="Tone, energy and values it replies with" />
        <RuleLink href="/settings/hours" label="Availability" sub="24/7 or quiet hours when it stays silent" last />
      </div>
    </div>
  );
}

function RuleLink({ href, label, sub, last }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: COLORS.textPrimary }}>{label}</div>
          <div style={{ fontSize: 12.5, color: COLORS.textHint, marginTop: 2 }}>{sub}</div>
        </div>
        <span style={{ color: COLORS.textHint, fontSize: 18 }}>›</span>
      </div>
      {!last && <div style={{ height: 1, background: COLORS.divider, marginLeft: 14 }} />}
    </Link>
  );
}

// Compact radio group used by the AI-identity card above. Three rows per
// group, each with a label + tiny description. The active row has a tinted
// background + green border to match the toggles elsewhere on the page.
function IdentityGroup({ label, value, onChange, options, savingFlag }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: COLORS.textHint, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((opt) => {
          const selected = value === opt.v;
          return (
            <button
              key={opt.v}
              onClick={() => onChange(opt.v)}
              disabled={savingFlag}
              style={{
                appearance: 'none', textAlign: 'left',
                cursor: savingFlag ? 'wait' : 'pointer',
                background: selected ? COLORS.greenLight : COLORS.surface,
                border: `1.5px solid ${selected ? COLORS.green : COLORS.divider}`,
                borderRadius: RADII.md, padding: '10px 12px',
                fontFamily: FONT.body, color: COLORS.textPrimary,
                opacity: savingFlag ? 0.7 : 1,
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                border: `2px solid ${selected ? COLORS.green : COLORS.divider}`,
                background: selected ? COLORS.green : 'transparent',
                display: 'grid', placeItems: 'center',
              }}>
                {selected && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                )}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: selected ? COLORS.green : COLORS.textPrimary }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 1.4 }}>
                  {opt.desc}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
