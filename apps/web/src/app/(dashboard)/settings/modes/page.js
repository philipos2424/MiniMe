'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';
import Collapse from '../../../../components/ui/Collapse';
import SegmentedChoice from '../../../../components/ui/SegmentedChoice';

const SERIF = "'Newsreader', Georgia, serif";

// Plain-language trust names. Stored values (0–3) are unchanged — only labels.
const TRUST_OPTIONS = [
  { value: 0, label: 'Just watch',       desc: 'Reads everything, never sends. You reply.' },
  { value: 1, label: 'Draft for me',     desc: 'Writes every reply; you tap Send.', recommended: true },
  { value: 2, label: 'Send the easy ones', desc: 'Sends routine replies, asks you on the tricky ones.' },
  { value: 3, label: 'Run it for me',    desc: 'Handles everything; you read the daily recap.' },
];

export default function ModesPage() {
  const { business: ctxBusiness, setBusiness, initData } = useTelegram();

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
  const [localSecMode, setLocalSecMode] = useState(null);
  const [savingSecMode, setSavingSecMode] = useState(false);
  const [localConfirm, setLocalConfirm] = useState(null);
  const [savingConfirm, setSavingConfirm] = useState(false);
  const [localTrust, setLocalTrust] = useState(null);
  const [savingTrust, setSavingTrust] = useState(false);

  const biz = ctxBusiness || {};
  const panic = localPanic !== null ? localPanic : !!biz.panic_mode;
  const disclosure = localDisc !== null ? localDisc : !!biz.notification_prefs?.ai_disclosure;
  // AI identity policy — defaults match replyEngine.js (customers honest-when-asked,
  // personal contacts mimic-owner). Both are owner-overridable below.
  const savedIdentity = biz.notification_prefs?.ai_identity_mode || {};
  const identityCustomers = localIdentityCustomers !== null ? localIdentityCustomers : (savedIdentity.customers || 'honest_when_asked');
  const identityPersonal  = localIdentityPersonal  !== null ? localIdentityPersonal  : (savedIdentity.personal  || 'mimic_owner');
  const secretaryMode = localSecMode !== null ? localSecMode : (biz.notification_prefs?.secretary_mode || 'ask_first');
  const confirmBeforeSend = localConfirm !== null ? localConfirm : (biz.notification_prefs?.confirm_before_send !== false);

  // Which modes are live for this business
  const secretaryOn = !!biz.telegram_biz_conn_id;
  const botOn = !!(biz.telegram_bot_username || biz.shop_code);
  const trust = localTrust !== null ? localTrust : (biz.trust_level ?? 1);

  // Which mode's details to expand. Default to whichever is live, else Secretary.
  const [focusMode, setFocusMode] = useState(secretaryOn ? 'secretary' : (botOn ? 'bot' : 'secretary'));

  async function togglePanic() {
    if (!biz.id || saving) return;
    const next = !panic;
    setSaving(true);
    setLocalPanic(next);
    try {
      await updateBusiness(initData, { panic_mode: next });
      setBusiness(b => ({ ...b, panic_mode: next }));
    } catch (e) {
      setLocalPanic(!next);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleDisclosure() {
    if (!biz.id || savingDisc) return;
    const next = !disclosure;
    setSavingDisc(true);
    setLocalDisc(next);
    const prefs = { ...(biz.notification_prefs || {}), ai_disclosure: next };
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
    } catch (e) {
      setLocalDisc(!next);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSavingDisc(false);
    }
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
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
    } catch (e) {
      // Roll back the optimistic update
      if (side === 'customers') setLocalIdentityCustomers(null);
      else                       setLocalIdentityPersonal(null);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSavingIdentity(false);
    }
  }

  async function updateSecretaryMode(value) {
    if (!biz.id || savingSecMode) return;
    setLocalSecMode(value);
    setSavingSecMode(true);
    const prefs = { ...(biz.notification_prefs || {}), secretary_mode: value };
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
    } catch (e) {
      setLocalSecMode(null);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSavingSecMode(false);
    }
  }

  async function toggleConfirm() {
    if (!biz.id || savingConfirm) return;
    const next = !confirmBeforeSend;
    setLocalConfirm(next);
    setSavingConfirm(true);
    const prefs = { ...(biz.notification_prefs || {}), confirm_before_send: next };
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
    } catch (e) {
      setLocalConfirm(!next);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSavingConfirm(false);
    }
  }

  async function updateTrust(value) {
    if (!biz.id || savingTrust) return;
    const prev = trust;
    setLocalTrust(value);
    setSavingTrust(true);
    try {
      await updateBusiness(initData, { trust_level: value });
      setBusiness(b => ({ ...b, trust_level: value }));
    } catch (e) {
      setLocalTrust(prev);
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSavingTrust(false);
    }
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
        Set how MiniMe answers people — and never confuse a customer with your mom.
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
                : 'MiniMe replies based on the settings below.'}
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

      {/* ── The one decision: how does MiniMe answer? ───────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.textHint, margin: '20px 0 8px' }}>
        How does MiniMe answer people?
      </div>
      <SegmentedChoice
        value={focusMode}
        onChange={setFocusMode}
        options={[
          {
            value: 'secretary',
            label: '🕴️  Secretary — replies as you',
            desc: 'From your own Telegram. People see your name, not a bot.',
            badge: secretaryOn ? 'Active' : 'Not set up',
          },
          {
            value: 'bot',
            label: '🤖  Bot — a separate shop bot answers',
            desc: 'Customers know they’re talking to your shop’s assistant.',
            badge: botOn ? 'Active' : 'Not set up',
          },
        ]}
      />

      {/* Details for whichever mode is in focus (progressive disclosure) */}
      {focusMode === 'secretary' && (
        <div style={{ ...card, marginTop: 12 }}>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
            Replies <strong>as you</strong>, from your own personal Telegram. People see <em>your</em> name —
            they're chatting with you, not a bot. MiniMe reads the full chat history and knows who each person is.
          </p>
          <div style={{ fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.6 }}>
            <div><strong>With customers:</strong> answers questions, shares prices, takes orders — like a great front-desk assistant who knows your business.</div>
            <div style={{ marginTop: 6 }}><strong>With family &amp; friends:</strong> chats warmly and naturally, remembers your history together, and <strong>never pitches the business or sends prices</strong> — unless they specifically ask. Then it answers, and goes back to being personal.</div>
          </div>

          {/* Activation steps — Telegram Business is required (a free-with-Premium
              Telegram feature). Link out so non-Premium owners can upgrade. */}
          {!secretaryOn && (
            <div style={{
              marginTop: 14, background: 'rgba(79,163,138,0.06)',
              border: '1px solid rgba(79,163,138,0.22)', borderRadius: RADII.md, padding: '12px 14px',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: COLORS.teal, marginBottom: 8,
              }}>
                Turn it on (1 minute)
              </div>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.55 }}>
                {[
                  <>Open Telegram → <strong>Settings</strong> → <strong>Telegram Business</strong> <span style={{ color: COLORS.textHint }}>(a free-with-Premium Telegram feature)</span>.<br/><span style={{ fontSize: 11.5, color: COLORS.textHint }}>Don't see it? You need Telegram Premium first.</span></>,
                  <>Tap <strong>Chatbots</strong> and add <a href="https://t.me/MiniMeAgentBot" target="_blank" rel="noreferrer" style={{ color: COLORS.teal, fontWeight: 600 }}>@MiniMeAgentBot</a> as your business bot.</>,
                  <>Allow it to <strong>Manage messages</strong> for the people you want it to handle (everyone, or just some chats).</>,
                  <>Come back here — this flips to <strong style={{ color: COLORS.green }}>Active</strong> automatically.</>,
                ].map((step, i) => (
                  <li key={i} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 10, padding: '7px 0', borderTop: i ? '1px dashed rgba(79,163,138,0.18)' : 'none' }}>
                    <span style={{ fontWeight: 700, color: COLORS.teal, fontFamily: SERIF }}>{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <a
                href="https://telegram.org/blog/telegram-business"
                target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: COLORS.textHint }}
              >
                What is Telegram Business? ↗
              </a>
            </div>
          )}
        </div>
      )}

      {focusMode === 'bot' && (
        <div style={{ ...card, marginTop: 12 }}>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '0 0 10px', lineHeight: 1.5 }}>
            A clearly-labeled assistant bot ({biz.telegram_bot_username ? `@${biz.telegram_bot_username}` : 'your shop bot'}).
            Customers know they're talking to your shop's assistant, not to you personally. Best for a public storefront
            where everyone who writes in is a customer — so it can always be helpful about products, prices and orders.
          </p>
          {!botOn && (
            <Link href="/settings/bot" style={{ textDecoration: 'none' }}>
              <div style={{
                marginTop: 4, padding: '10px 14px', borderRadius: RADII.md,
                background: COLORS.greenLight, color: COLORS.green,
                fontSize: 13, fontWeight: 600, textAlign: 'center',
              }}>
                Connect your shop bot →
              </div>
            </Link>
          )}
        </div>
      )}

      {/* ── Secretary safety — only relevant when Secretary is live ─────── */}
      {secretaryOn && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.textHint, margin: '20px 0 8px' }}>
            Secretary safety
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>👋</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>When a new person messages you</span>
            </div>
            <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: '0 0 12px', lineHeight: 1.5 }}>
              For someone who isn't a saved contact or known customer yet. Pick how the secretary handles them — you can change this anytime.
            </p>
            <SegmentedChoice
              value={secretaryMode}
              onChange={updateSecretaryMode}
              saving={savingSecMode}
              options={[
                { value: 'ask_first', label: 'Ask me first', desc: "I check with you before replying — tap who they are and I'll answer their message for you. Safest.", recommended: true },
                { value: 'auto', label: 'Auto-reply 24/7', desc: "I figure out who they are from the chat and reply right away, as you. You're never interrupted." },
                { value: 'ghost', label: 'Ghost — just brief me', desc: "I never reply. I read everything and send you summaries of what's happening." },
              ]}
            />
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📝</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Show me the draft before sending</div>
                <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
                  When on, anytime you ask me to message someone — a customer, your team, or family/friends — I write the draft and wait for your <strong>Send</strong> tap. Turn off to let me send right away.
                </div>
              </div>
              <button
                onClick={toggleConfirm}
                disabled={savingConfirm}
                style={{
                  flexShrink: 0, padding: '8px 14px', borderRadius: RADII.md,
                  border: 'none', cursor: savingConfirm ? 'wait' : 'pointer',
                  fontFamily: FONT.body, fontWeight: 600, fontSize: 13,
                  background: confirmBeforeSend ? COLORS.green : 'rgba(138,149,144,0.18)',
                  color: confirmBeforeSend ? '#fff' : COLORS.textSecondary,
                  opacity: savingConfirm ? 0.6 : 1,
                }}
              >
                {confirmBeforeSend ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── How much can MiniMe do on its own? (trust level) ───────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.textHint, margin: '20px 0 8px' }}>
        How much can MiniMe do on its own?
      </div>
      <div style={card}>
        <SegmentedChoice
          value={trust}
          onChange={updateTrust}
          saving={savingTrust}
          options={TRUST_OPTIONS}
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

      {/* ── Advanced: AI honesty & disclosure (EU / compliance) ─────────── */}
      <Collapse
        icon="🎭"
        label="AI honesty & disclosure"
        sub="Defaults are fine for most shops. Open only if you sell to the EU."
        style={{ marginBottom: 12 }}
      >
        {/* Tell customers an AI may reply */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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

        <div style={{
          fontWeight: 700, fontSize: 14, marginBottom: 4,
        }}>
          When asked "are you a bot?"
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
          How honest your assistant is about being AI when someone directly asks. You can set this differently for customers vs family / friends.
        </div>

        <SegmentedChoice
          label="With customers"
          value={identityCustomers}
          onChange={(v) => updateIdentity('customers', v)}
          saving={savingIdentity}
          options={[
            { value: 'honest_when_asked', label: 'Honest when asked', desc: 'Speaks as you. Admits being AI only if directly asked.', recommended: true },
            { value: 'always_disclose',   label: 'Always disclose',    desc: "Mentions early it's an AI assistant. Most transparent — EU AI Act friendly." },
            { value: 'mimic_owner',       label: 'Mimic me',           desc: "Never breaks character, even if asked. May not meet EU rules — use only if you don't sell to the EU." },
          ]}
        />

        <div style={{ height: 1, background: COLORS.divider, margin: '16px 0' }} />

        <SegmentedChoice
          label="With family & friends"
          value={identityPersonal}
          onChange={(v) => updateIdentity('personal', v)}
          saving={savingIdentity}
          options={[
            { value: 'mimic_owner',       label: 'Mimic me',           desc: 'Speaks fully as you. Deflects warmly if asked. Most natural for personal chats.', recommended: true },
            { value: 'honest_when_asked', label: 'Honest when asked', desc: 'Admits being AI if family / friends directly ask.' },
            { value: 'always_disclose',   label: 'Always disclose',    desc: "Tells personal contacts upfront they're chatting with your assistant." },
          ]}
        />
      </Collapse>

      {/* ── Quick links to the remaining knobs ──────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: COLORS.textHint, margin: '18px 0 8px' }}>
        Tune the behavior
      </div>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.divider}`, borderRadius: RADII.md, overflow: 'hidden' }}>
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
