'use client';
/**
 * Trust level card — editorial Espresso style.
 * Surfaces current trust level + this-week edit rate, and one-tap promotes
 * when the owner has earned it (≥ 10 AI replies, edit rate ≤ 15%).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../context/TelegramContext';

const SERIF = "'Fraunces', Georgia, serif";
const AMH = "'Noto Serif Ethiopic', serif";
const MONO = "'JetBrains Mono', monospace";

const LEVELS = {
  0: { name: 'Shadow',     am: 'ጥላ',       sub: 'You approve every reply.' },
  1: { name: 'Supervised', am: 'በቁጥጥር ስር', sub: 'Auto-sends safe replies; flags edge cases.' },
  2: { name: 'Trusted',    am: 'የተዛመነ',   sub: 'Auto-sends almost everything; you spot-check.' },
  3: { name: 'Full Agent', am: 'ሙሉ ወኪል',  sub: 'Full autonomy — runs end-to-end.' },
};

const PROMOTE_THRESHOLD_PCT = 15;
const PROMOTE_MIN_AI_REPLIES = 10;

export default function TrustLevelCard({ business, onUpdate }) {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const lvl = LEVELS[business.trust_level ?? 0] || LEVELS[0];
  const next = LEVELS[(business.trust_level ?? 0) + 1];

  useEffect(() => {
    if (!initData) return;
    (async () => {
      const r = await fetch('/api/analytics', { headers: { 'x-telegram-init-data': initData } });
      const j = await r.json().catch(() => ({}));
      setStats(j.totals || null);
    })();
  }, [initData]);

  const aiTotal = (stats?.aiSent || 0) + (stats?.aiEdited || 0);
  const editRate = stats?.edit_rate_pct ?? null;
  const eligibleForPromotion =
    next &&
    aiTotal >= PROMOTE_MIN_AI_REPLIES &&
    editRate != null && editRate <= PROMOTE_THRESHOLD_PCT &&
    !business.panic_mode;

  async function promote() {
    setBusy(true);
    try {
      const r = await fetch('/api/settings/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ trust_level: (business.trust_level ?? 0) + 1 }),
      });
      const j = await r.json();
      if (r.ok && j.business && onUpdate) onUpdate(j.business);
    } finally { setBusy(false); }
  }

  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E8DFD0', borderRadius: 4, padding: '18px 20px' }}>
      <Link href="/settings/trust" style={{ display: 'block', textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8A7560' }}>
            Trust level · {business.trust_level ?? 0}/3
          </div>
          {business.panic_mode && (
            <span style={{ fontFamily: MONO, fontSize: 9, padding: '2px 8px', borderRadius: 999, background: 'rgba(178,58,31,0.1)', color: '#B23A1F', letterSpacing: '0.1em' }}>🔴 PANIC</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.025em', color: '#1A0F08', lineHeight: 1 }}>
            <em style={{ fontStyle: 'italic', color: '#8B2E1F' }}>{lvl.name}</em>
          </h3>
          <span style={{ fontFamily: AMH, fontSize: 14, color: '#8B2E1F' }}>{lvl.am}</span>
        </div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: '#8A7560', marginTop: 2 }}>{lvl.sub}</div>
      </Link>

      {stats && aiTotal >= 3 && (
        <div style={{ marginTop: 16, paddingTop: 12, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid #E8DFD0' }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#8A7560' }}>
              Edit rate · this week
            </div>
            <div style={{ fontSize: 11, color: '#8A7560', marginTop: 2, fontFamily: SERIF, fontStyle: 'italic' }}>
              {aiTotal} AI replies · {stats.aiEdited} edited
            </div>
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.025em', color: editRate <= PROMOTE_THRESHOLD_PCT ? '#5A7A3F' : '#D9A441', lineHeight: 1 }}>
            {editRate}<span style={{ fontSize: 14, color: '#8A7560', fontStyle: 'italic' }}>%</span>
          </div>
        </div>
      )}

      {eligibleForPromotion && (
        <div style={{ marginTop: 16, padding: 16, background: '#1A0F08', color: '#FBF6EC', borderRadius: 4 }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#D9A441' }}>
            Promotion available
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 6, lineHeight: 1.3 }}>
            Ready for <em style={{ fontStyle: 'italic', color: '#D9A441' }}>{next.name}</em> mode?
          </div>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, color: 'rgba(245,236,220,0.7)', marginTop: 4, lineHeight: 1.45 }}>
            Your edit rate is {editRate}% — MiniMe is matching your voice. {next.sub.toLowerCase()}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={promote} disabled={busy} style={{
              appearance: 'none', border: 'none', background: '#D9A441', color: '#1A0F08',
              padding: '8px 16px', borderRadius: 999, fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {busy ? 'Promoting…' : `Promote to ${next.name} →`}
            </button>
            <button onClick={() => router.push('/settings/trust')} style={{
              appearance: 'none', border: '1px solid rgba(245,236,220,0.3)', background: 'transparent',
              color: '#FBF6EC', padding: '8px 14px', borderRadius: 999, fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Learn more
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
