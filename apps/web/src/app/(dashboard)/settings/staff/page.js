'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { useToast } from '../../../../components/ui/Toast';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';
import { tgConfirm } from '../../../../lib/utils';

export default function StaffPage() {
  const { initData } = useTelegram() || {};
  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);

  async function load() {
    if (!initData) return;
    setLoading(true);
    const r = await fetch('/api/team/staff', { headers: { 'x-telegram-init-data': initData } });
    if (r.ok) {
      const j = await r.json();
      setStaff(j.staff || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [initData]);

  async function addStaff() {
    if (!initData || !input.trim() || adding) return;
    setAdding(true);
    const raw = input.trim();
    const body = /^\d+$/.test(raw) ? { telegram_id: raw } : { username: raw };
    const r = await fetch('/api/team/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = j.detail || j.error || 'Failed to add staff';
      toast(msg, { variant: 'error' });
    } else {
      setStaff(prev => [...prev, j.staff_member]);
      setInput('');
      toast(`✅ Staff member added`, { variant: 'success' });
    }
    setAdding(false);
  }

  async function removeStaff(telegramId) {
    if (!initData) return;
    if (!(await tgConfirm('Remove this staff member?'))) return;
    const r = await fetch(`/api/team/staff?telegram_id=${telegramId}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    if (r.ok) {
      setStaff(prev => prev.filter(s => s.telegram_id !== telegramId));
      toast('Staff member removed', { variant: 'success' });
    }
  }

  const inputStyle = {
    flex: 1, padding: '11px 14px', border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
    fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary, background: COLORS.bg, outline: 'none',
  };

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: COLORS.amber, marginBottom: 4 }}>
          Team
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Staff Access</h1>
        <p style={{ fontSize: 13, color: COLORS.textHint, margin: '4px 0 0', lineHeight: 1.45 }}>
          Staff members can view orders, chats, and stock in your bot — but cannot change settings or teach MiniMe.
        </p>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* Permissions explainer */}
        <div style={{
          background: 'rgba(176,138,74,0.07)', border: '1px solid rgba(176,138,74,0.2)',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, color: COLORS.amber, fontWeight: 600, marginBottom: 6 }}>👷 What staff can do</div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.6 }}>
            ✅ /orders · /sales · /stock · /customers · /search<br />
            ❌ /dm · /teach · /rule · /forget · /discount<br />
            <br />
            Staff type commands in your bot, just like you do. Destructive actions are blocked.
          </div>
        </div>

        {/* Add staff input */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
            ADD STAFF MEMBER
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStaff(); }}
              placeholder="@username or Telegram ID"
              style={inputStyle}
            />
            <button onClick={addStaff} disabled={!input.trim() || adding} style={{
              padding: '11px 16px', background: !input.trim() || adding ? COLORS.textHint : COLORS.ink,
              color: '#fff', border: 'none', borderRadius: RADII.md,
              fontSize: 14, fontWeight: 600, cursor: !input.trim() || adding ? 'default' : 'pointer',
              fontFamily: FONT.body, flexShrink: 0,
            }}>
              {adding ? '…' : 'Add'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 6 }}>
            Find the Telegram ID by having them message your bot first, or use @username.
          </div>
        </div>

        {/* Staff list */}
        {loading ? (
          <div style={{ color: COLORS.textHint, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
        ) : staff.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: COLORS.textHint }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👷</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No staff members yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Add a Telegram username or ID above</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>
              STAFF ({staff.length})
            </div>
            {staff.map(s => (
              <div key={s.telegram_id} style={{
                background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
                padding: '12px 16px', marginBottom: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {s.name || `ID: ${s.telegram_id}`}
                  </div>
                  {s.name && (
                    <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                      Telegram ID: {s.telegram_id}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: COLORS.teal, marginTop: 3, fontWeight: 500 }}>
                    Can view · Cannot modify
                  </div>
                </div>
                <button onClick={() => removeStaff(s.telegram_id)} style={{
                  background: 'none', border: `1px solid ${COLORS.border}`,
                  color: COLORS.red, borderRadius: RADII.md, padding: '7px 12px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
                }}>
                  Remove
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
