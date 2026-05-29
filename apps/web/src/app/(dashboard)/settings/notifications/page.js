'use client';
/**
 * Morning summary push notification settings.
 * Stored in businesses.notification_prefs.morning_summary
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { Bell } from 'lucide-react';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import SaveBar from '../../../../components/ui/SaveBar';

function buildPreviews(name) {
  const greeting = name ? `Good morning, ${name}!` : 'Good morning!';
  return {
    brief: `☀️ *${greeting}*\n\nYesterday's recap:\n• 12 chats handled by MiniMe\n• 3 orders created · 1 paid\n• 2 new clients\n\n💬 2 drafts need your review.`,
    detailed: `☀️ *${greeting}*\n\n📊 *Yesterday's full report*\n\nChats handled: 12 auto · 3 by you\nNew clients: Almaz T., Daniel B.\nOrders: 3 created · 1 paid (4,500 ETB)\n\nTop topics: pricing, availability, delivery\nAvg response time: 1.2s (AI) · 4.5min (you)\n\n💬 2 drafts pending · Tap to review`,
  };
}

export default function NotificationsPage() {
  const router = useRouter();
  const { initData, business: ctxBusiness } = useTelegram() || {};
  const [cfg, setCfg] = useState({ enabled: true, hour: 8, format: 'brief' });
  const [silentDrafts, setSilentDrafts] = useState(true); // default to "important only"
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!initData) return;
    (async () => {
      const r = await fetch('/api/settings/notifications', {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
      });
      const j = await r.json();
      if (j.morning_summary) setCfg(c => ({ ...c, ...j.morning_summary }));
      if (typeof j.silent_drafts === 'boolean') setSilentDrafts(j.silent_drafts);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initData]);

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/settings');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ ...cfg, silent_drafts: silentDrafts }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setSavedAt(new Date());
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const ownerFirstName = ctxBusiness?.owner_name?.split(' ')[0] || '';
  const previews = buildPreviews(ownerFirstName);
  const previewText = previews[cfg.format] || previews.brief;
  const hourLabel = `${String(cfg.hour).padStart(2, '0')}:00`;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: '0 0 4px', letterSpacing: '-0.02em', fontFamily: "'Fraunces', Georgia, serif" }}>
          Morning Summary
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
          Get a daily recap from MiniMe in your Telegram chat.
        </p>
      </header>

      {/* What pings me in the bot? */}
      <div style={{
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.lg, padding: 20, marginBottom: 14, boxShadow: SHADOW.card,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>
          What pings me in the bot?
        </div>
        <div style={{ fontSize: 12, color: COLORS.textHint, marginBottom: 14, lineHeight: 1.5 }}>
          Every conversation always appears in MiniMe. Choose what wakes up your Telegram bot.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { v: false, title: 'Every customer message', desc: 'Get a Telegram notification for each customer reply MiniMe drafts.' },
            { v: true,  title: 'Only important messages', desc: 'Low confidence, complaints, new customers, negative sentiment, scams. Routine questions stay silent in MiniMe.' },
          ].map(o => (
            <button
              key={String(o.v)}
              onClick={() => setSilentDrafts(o.v)}
              style={{
                width: '100%', textAlign: 'left',
                background: silentDrafts === o.v ? COLORS.tealLight : 'transparent',
                border: `2px solid ${silentDrafts === o.v ? COLORS.teal : COLORS.border}`,
                borderRadius: RADII.md, padding: '12px 14px',
                cursor: 'pointer', fontFamily: FONT.body,
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>
                {silentDrafts === o.v ? '●' : '○'} {o.title}
                {o.v === true && <span style={{ fontSize: 10, color: COLORS.teal, marginLeft: 8, fontWeight: 500 }}>recommended</span>}
              </div>
              <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 4, lineHeight: 1.5 }}>{o.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Enable toggle */}
      <div style={{
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.lg, padding: 20, marginBottom: 14, boxShadow: SHADOW.card,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <Bell size={20} color={COLORS.teal} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>Daily morning brief</div>
              <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>
                MiniMe sends you a Telegram message each morning
              </div>
            </div>
          </div>
          <div
            onClick={() => setCfg(c => ({ ...c, enabled: !c.enabled }))}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: cfg.enabled ? COLORS.teal : COLORS.border,
              cursor: 'pointer', position: 'relative', flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 3,
              left: cfg.enabled ? 23 : 3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#FFF', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>
      </div>

      {cfg.enabled && (
        <>
          {/* Delivery time */}
          <div style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: 20, marginBottom: 14, boxShadow: SHADOW.card,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 14 }}>Send time</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <select
                value={cfg.hour}
                onChange={e => setCfg(c => ({ ...c, hour: Number(e.target.value) }))}
                style={{
                  flex: 1, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.md, padding: '10px 12px', fontSize: 14,
                  color: COLORS.textPrimary, fontFamily: 'monospace', outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: COLORS.textSecondary }}>Addis Ababa time</span>
            </div>
            <p style={{ fontSize: 11, color: COLORS.textHint, margin: '8px 0 0' }}>
              Most owners set 07:00 – 08:00 to read before opening.
            </p>
          </div>

          {/* Format */}
          <div style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: 20, marginBottom: 14, boxShadow: SHADOW.card,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 12 }}>Summary style</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { v: 'brief',    icon: '⚡', title: 'Brief',    desc: '5 lines — numbers, pending drafts. Done in 10 seconds.' },
                { v: 'detailed', icon: '📋', title: 'Detailed', desc: 'Full breakdown: top topics, response times, client names.' },
              ].map(o => (
                <button
                  key={o.v}
                  onClick={() => setCfg(c => ({ ...c, format: o.v }))}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: cfg.format === o.v ? COLORS.tealLight : 'transparent',
                    border: `2px solid ${cfg.format === o.v ? COLORS.teal : COLORS.border}`,
                    borderRadius: RADII.md, padding: '12px 14px',
                    cursor: 'pointer', fontFamily: FONT.body,
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{o.icon}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{o.title}</div>
                    <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 2 }}>{o.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.lg, padding: 16, marginBottom: 16, boxShadow: SHADOW.card,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>
              PREVIEW — {hourLabel}
            </div>
            {/* Telegram-style message bubble */}
            <div style={{
              background: '#F0FDF4', border: `1px solid ${COLORS.green}30`,
              borderRadius: '4px 12px 12px 12px',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 10, color: COLORS.teal, fontWeight: 600, marginBottom: 6 }}>MiniMe</div>
              <pre style={{
                fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.6, margin: 0,
                fontFamily: FONT.body, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{previewText}</pre>
            </div>
            <p style={{ fontSize: 11, color: COLORS.textHint, margin: '8px 0 0', textAlign: 'center' }}>
              Actual numbers come from your real data.
            </p>
          </div>
        </>
      )}

      {err && (
        <div style={{
          background: COLORS.redLight, border: `1px solid ${COLORS.red}40`,
          borderRadius: RADII.md, padding: '10px 14px', fontSize: 13, color: COLORS.red, marginBottom: 12,
        }}>
          {err}
        </div>
      )}

      <SaveBar saving={busy} saved={!!savedAt} onSave={save} />
    </div>
  );
}
