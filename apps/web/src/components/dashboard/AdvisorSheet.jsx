'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../context/TelegramContext';
import { UpgradeSheet } from '../ui/UpgradeSheet';

// ─── Advisor sheet — autonomy control + what MiniMe noticed ────────────────
// Opened from Home's "Advisor" card. The autonomy toggle maps onto the real
// trust-level system (POST /api/settings/trust — see settings/trust for the
// full 0..3 ladder); here we only expose the coarse choice the design calls
// for: "Draft & ask me" (level 1 = Supervised — writes every reply, you tap
// send) vs "Auto-reply" (level 2 = Trusted — sends routine replies itself,
// flags anything complex). Was previously wired to levels 0/1 (Shadow/
// Supervised), which meant tapping "Auto-reply" here set Supervised — a
// level that never auto-sends — so the toggle silently did nothing. Level 0
// (Shadow — fully silent, no drafts at all) and Full Agent stay on
// /settings/trust; this sheet only covers the two "MiniMe answers" modes.
//
// Suggestions are built from signals the app already computes (never
// invented): an unconnected secretary, low/out-of-stock items, an
// incomplete profile. Each links straight to where it's fixed.

const INK   = 'var(--ink)';
const GOLD  = 'var(--gold)';
const MINT  = 'var(--mint)';
const MUTED = 'var(--muted)';
const LINE  = 'var(--line)';
const SERIF = "'Newsreader', Georgia, serif";
const BODY  = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

function buildInsights({ business, feed }) {
  const items = [];
  if (business && !business.telegram_biz_conn_id) {
    items.push({
      key: 'secretary', e: '🕴️', tint: '#F4EEE1',
      t: 'Answer from your own Telegram too',
      b: 'Connect your secretary so personal chats stay personal.',
      cta: 'Connect', href: '/settings/modes',
    });
  }
  if (feed?.out_of_stock_count > 0 || feed?.low_stock_count > 0) {
    const n = feed.out_of_stock_count > 0 ? feed.out_of_stock_count : feed.low_stock_count;
    items.push({
      key: 'stock', e: '📦', tint: '#FCF1EF',
      t: feed.out_of_stock_count > 0 ? `${n} item${n > 1 ? 's' : ''} out of stock` : `${n} item${n > 1 ? 's' : ''} running low`,
      b: 'Update stock so MiniMe never over-promises.',
      cta: 'Update', href: '/products',
    });
  }
  if (business) {
    const incomplete = !business.address || !business.owner_phone || !business.business_hours
      || !business.instagram || (business.sample_replies?.length || 0) < 3;
    if (incomplete) {
      items.push({
        key: 'profile', e: '📝', tint: '#F4EEE1',
        t: 'Finish your shop profile',
        b: 'MiniMe uses this in every reply it sends.',
        cta: 'Finish', href: '/settings/profile',
      });
    }
  }
  return items;
}

export function AdvisorSheet({ open, business, feed, onClose, onBusinessUpdate }) {
  const { initData } = useTelegram() || {};
  const [busy, setBusy] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  if (!open) return null;

  const trustLevel = business?.trust_level ?? 0;
  const isAuto = trustLevel >= 2;

  async function setMode(auto) {
    if (busy || !initData) return;
    const wantLevel = auto ? 2 : 1;
    if (wantLevel === trustLevel) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ trust_level: wantLevel }),
      });
      // Free plan caps out below Trusted (see FREE_MAX_TRUST_LEVEL) — the API
      // 403s with a Pro-required payload rather than silently downgrading, so
      // tapping "Auto-reply" on Free needs to say why nothing changed instead
      // of just sitting there looking broken.
      if (r.status === 403) { setUpgradeOpen(true); return; }
      const j = await r.json();
      if (r.ok && j.business) onBusinessUpdate?.(j.business);
    } finally { setBusy(false); }
  }

  const insights = buildInsights({ business, feed });

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(14,40,35,.5)', zIndex: 100,
      display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} className="fade-up" style={{
        background: '#FFFFFF', borderRadius: '26px 26px 0 0', width: '100%',
        boxSizing: 'border-box', padding: '18px 22px calc(24px + env(safe-area-inset-bottom))',
        maxHeight: '86vh', overflowY: 'auto',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: '#E0D8C6', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 22, color: INK }}>Advisor</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>What MiniMe noticed in your shop</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: MUTED, cursor: 'pointer', lineHeight: 1, fontFamily: BODY }}>×</button>
        </div>

        {/* Autonomy control */}
        <div style={{ marginTop: 16, background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 16, padding: 15 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>
            How much should MiniMe do?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => setMode(false)}
              disabled={busy}
              style={{
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px',
                borderRadius: 12, cursor: busy ? 'default' : 'pointer', fontFamily: BODY,
                border: `1.5px solid ${!isAuto ? MINT : LINE}`,
                background: !isAuto ? 'rgba(79,163,138,.07)' : '#fff',
              }}
            >
              <span style={{ fontSize: 18 }}>✍️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>Draft &amp; ask me</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>MiniMe writes, you approve every reply</div>
              </div>
              <span style={{ color: !isAuto ? MINT : 'transparent', fontWeight: 700 }}>✓</span>
            </button>
            <button
              onClick={() => setMode(true)}
              disabled={busy}
              style={{
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 11, padding: '12px 13px',
                borderRadius: 12, cursor: busy ? 'default' : 'pointer', fontFamily: BODY,
                border: `1.5px solid ${isAuto ? MINT : LINE}`,
                background: isAuto ? 'rgba(79,163,138,.07)' : '#fff',
              }}
            >
              <span style={{ fontSize: 18 }}>⚡</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>Auto-reply</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>Sends simple answers, asks you on tricky ones</div>
              </div>
              <span style={{ color: isAuto ? MINT : 'transparent', fontWeight: 700 }}>✓</span>
            </button>
          </div>
          <Link href="/settings/trust" style={{ display: 'block', marginTop: 10, fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>
            Fine-tune trust level →
          </Link>
        </div>

        <UpgradeSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature="auto_send" />

        {/* Suggestions */}
        {insights.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: GOLD, margin: '20px 0 10px' }}>
              Suggestions
            </div>
            {insights.map(i => (
              <Link key={i.key} href={i.href} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', border: `1px solid ${LINE}`, borderRadius: 16, padding: 14,
                  marginBottom: 9, display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: i.tint, display: 'grid', placeItems: 'center', fontSize: 19, flexShrink: 0 }}>{i.e}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, lineHeight: 1.3 }}>{i.t}</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>{i.b}</div>
                  </div>
                  <span style={{
                    background: '#F4EEE1', color: INK, fontSize: 12, fontWeight: 600,
                    padding: '7px 12px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>{i.cta}</span>
                </div>
              </Link>
            ))}
          </>
        )}

        <Link href="/advisor" style={{ textDecoration: 'none' }}>
          <div style={{
            marginTop: insights.length > 0 ? 8 : 20, textAlign: 'center', padding: '13px', borderRadius: 999,
            border: `1px dashed ${GOLD}`, color: GOLD, fontSize: 13, fontWeight: 600,
          }}>
            Ask MiniMe anything →
          </div>
        </Link>
      </div>
    </div>
  );
}
