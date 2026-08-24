'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../../context/TelegramContext';
import { updateBusiness } from '../../../../lib/updateBusiness';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

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
