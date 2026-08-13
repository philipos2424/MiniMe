'use client';
/**
 * Referral card — give 30%, get 30%.
 *
 * Fetches the owner's referral link lazily; hides itself entirely if the
 * server says the program isn't available (schema not migrated yet) so it
 * can never break wherever it's rendered. Shown on both post-activation
 * success screens (onboarding) and on Settings → Billing — the durable
 * surface, since an owner may want to reshare the link long after signup.
 */
import { useEffect, useState } from 'react';

const INK  = 'var(--ink)';
const PAPER = 'var(--paper)';
const GOLD = 'var(--gold)';
const MINT = 'var(--mint)';
const LINE = 'var(--line)';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";
const MONO  = "'Geist Mono', ui-monospace, monospace";

export default function ReferralCard({ initData, onTrack, preview = false }) {
  const [link, setLink] = useState(preview ? 'https://t.me/MiniMeAgentBot?startapp=ref_preview' : '');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (preview || !initData) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/referral', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
        const j = await r.json();
        if (!dead && j?.ok && j.link) setLink(j.link);
      } catch { /* hide card */ }
    })();
    return () => { dead = true; };
  }, [initData, preview]);

  if (!link) return null;
  const shareText = 'My shop answers customers by itself now 🤯 MiniMe replies on Telegram in my own words. This link gives you 30% off your first month — and I get 30% too:';

  function copy() {
    try {
      navigator.clipboard?.writeText(link).then(() => {
        setCopied(true);
        onTrack?.('referral_link_shared');
        setTimeout(() => setCopied(false), 1600);
      });
    } catch {}
  }

  return (
    <div className="fade-up delay-2" style={{
      marginTop: 20, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, rgba(176,138,74,0.12), rgba(176,138,74,0.04))',
      border: `1px solid rgba(176,138,74,0.4)`, borderRadius: 16, padding: '16px 16px 14px',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0, fontSize: 20,
          background: 'rgba(176,138,74,0.15)', border: '1px solid rgba(176,138,74,0.3)',
          display: 'grid', placeItems: 'center',
        }}>🤝</div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD }}>
            give 30% · get 30%
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 17, color: INK, marginTop: 2, lineHeight: 1.25 }}>
            Know another shop owner?
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: '#4A5E5A', margin: '10px 0 12px', lineHeight: 1.5 }}>
        Send them your link — they get <strong>30% off their first month</strong>, you get
        <strong> 30% off your next one</strong>. Everybody wins except your competition.
      </p>
      <div style={{
        fontFamily: MONO, fontSize: 11, color: '#4A5E5A', background: 'var(--card)',
        border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 11px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{link}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={copy} style={{
          flex: 1, appearance: 'none', cursor: 'pointer', fontFamily: BODY,
          background: copied ? MINT : '#fff', color: copied ? '#fff' : INK,
          border: `1px solid ${copied ? MINT : LINE}`, borderRadius: 999,
          padding: '10px', fontSize: 13, fontWeight: 500, transition: 'background .15s',
        }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`}
          target="_blank" rel="noopener noreferrer"
          onClick={() => onTrack?.('referral_link_shared')}
          style={{
            flex: 1, textDecoration: 'none', textAlign: 'center', fontFamily: BODY,
            background: INK, color: PAPER, borderRadius: 999,
            padding: '10px', fontSize: 13, fontWeight: 500,
          }}>Share on Telegram</a>
      </div>
    </div>
  );
}
