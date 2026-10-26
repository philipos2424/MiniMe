'use client';
/**
 * Support & Help. The Settings row used to open the AI assistant, with no FAQ
 * and no way to reach a person — an owner asked in admin feedback how to
 * contact the admin. Messages sent here land in the admin Feedback tab
 * (page='support') and ping the admin on Telegram with a link to reply.
 *
 * Every FAQ answer describes what the code does today; numbers come from
 * lib/plan.js so they can't drift from the paywalls.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { FREE_LIMITS, PRO_PRICE_ETB } from '../../../../lib/plan';
import { SUPPORT_EMAIL } from '../../../legal/_ui';

const SERIF = "'Newsreader', Georgia, serif";
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'MiniMeAgentBot';

const FAQ = [
  {
    q: 'How do customers pay me?',
    a: <>Turn on Telebirr or CBE in <Link href="/settings/payments">Payments</Link> and enter your number or account. When someone orders, MiniMe sends them your details and an &ldquo;I&apos;ve paid&rdquo; button. You then get a message with <strong>Confirm</strong> or <strong>Not yet</strong>; the order is marked paid when you confirm.</>,
  },
  {
    q: 'How do I pause MiniMe?',
    a: <>Tap <strong>Pause</strong> at the top of <Link href="/settings">Settings</Link>, or send <strong>/pause</strong> to your MiniMe bot. Tap Resume or send <strong>/resume</strong> to turn it back on. While paused, customers get no replies, but their messages still reach you.</>,
  },
  {
    q: 'What is free, and what does Pro add?',
    a: <>On Free, MiniMe answers every customer. He sends up to {FREE_LIMITS.aiRepliesPerMonth} replies a month himself, then writes drafts for you to send. Free also covers {FREE_LIMITS.products} products and {FREE_LIMITS.secretaryRepliesPerMonth} Secretary replies a month. Pro ({PRO_PRICE_ETB.toLocaleString()} ETB a month) removes those limits and adds Advisor, Broadcast and Market insights. See <Link href="/settings/billing">Billing &amp; Plan</Link>.</>,
  },
  {
    q: 'How do I connect my personal Telegram?',
    a: <>On your phone, open Telegram <strong>Settings → Business → Chatbots</strong>, type <strong>@{BOT_USERNAME}</strong> and add it. Telegram Business needs Telegram Premium. Then choose how MiniMe replies in <Link href="/settings/modes">Secretary Mode</Link>.</>,
  },
  {
    q: 'MiniMe told someone something wrong',
    a: <>Correct the answer in <Link href="/teach">Knowledge Base</Link>. If it was about you personally, remove the wrong line under &ldquo;What MiniMe believes about you&rdquo; in <Link href="/settings/modes">Secretary Mode</Link>.</>,
  },
  {
    q: 'How do I get a copy of my data?',
    a: <>Tap <strong>Export My Data</strong> in <Link href="/settings">Settings</Link>. The file arrives in your chat with the MiniMe bot.</>,
  },
  {
    q: 'How do I delete my account?',
    a: <>Open <Link href="/settings/profile">Business Profile</Link> and tap <strong>Delete Account</strong> at the bottom. This can&apos;t be undone, so export your data first.</>,
  },
];

export default function SupportPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/settings');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function send() {
    const text = note.trim();
    if (!text || state === 'sending') return;
    setState('sending');
    try {
      const r = await fetch('/api/platform/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData || '' },
        body: JSON.stringify({ category: 'general', page: 'support', note: text }),
      });
      if (!r.ok) throw new Error('send_failed');
      setNote('');
      setState('sent');
    } catch {
      setState('error');
    }
  }

  const card = { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 16, marginBottom: 16 };

  return (
    <div style={{ maxWidth: 560, fontFamily: FONT.body, color: COLORS.textPrimary, padding: '20px 16px 100px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, margin: '0 0 8px', letterSpacing: '-0.02em', fontFamily: SERIF }}>Support &amp; Help</h1>
      <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '0 0 20px', lineHeight: 1.5 }}>
        Quick answers below, or write to the MiniMe team.
      </p>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} style={{ borderTop: i ? `1px solid ${COLORS.border}` : 'none' }}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)} style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '14px 16px', minHeight: 48, border: 'none', background: 'transparent', cursor: 'pointer',
                fontFamily: FONT.body, fontSize: 14, fontWeight: 600, color: COLORS.textPrimary,
              }}>
                <span style={{ flex: 1 }}>{f.q}</span>
                <span aria-hidden style={{ color: COLORS.textHint, fontSize: 18, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 16px 14px', fontSize: 13.5, lineHeight: 1.55, color: COLORS.textSecondary }}>{f.a}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Message the MiniMe team</div>
        <div style={{ fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.45, marginBottom: 10 }}>
          A person reads every message and replies to you on Telegram.
        </div>
        <textarea
          value={note}
          onChange={e => { setNote(e.target.value); if (state !== 'sending') setState('idle'); }}
          maxLength={2000}
          rows={4}
          placeholder="What do you need help with?"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.md, background: COLORS.bg,
            fontFamily: FONT.body, fontSize: 14, color: COLORS.textPrimary, outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={send} disabled={!note.trim() || state === 'sending'} style={{
            minHeight: 40, padding: '8px 18px', borderRadius: 999, border: 'none',
            background: COLORS.ink, color: '#FFFFFF', fontFamily: FONT.body, fontSize: 13.5, fontWeight: 600,
            cursor: !note.trim() || state === 'sending' ? 'default' : 'pointer', opacity: !note.trim() || state === 'sending' ? 0.5 : 1,
          }}>
            {state === 'sending' ? 'Sending…' : 'Send'}
          </button>
          <span role="status" style={{ fontSize: 12.5, color: state === 'error' ? COLORS.red : COLORS.textSecondary }}>
            {state === 'sent' && 'Sent. We’ll reply to you on Telegram.'}
            {state === 'error' && 'Could not send. Check your connection and try again.'}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.6 }}>
        Questions about your account? <Link href="/assistant">Ask the MiniMe assistant</Link>.<br />
        Prefer email? Write to <strong style={{ userSelect: 'all' }}>{SUPPORT_EMAIL}</strong>.
      </div>
    </div>
  );
}
