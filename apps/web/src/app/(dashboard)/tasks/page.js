'use client';
import { useEffect, useState, useCallback } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';
import { tgAlert } from '../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

function whenStr(iso) {
  if (!iso) return 'soon';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function recurrenceStr(rec) {
  if (!rec || !rec.kind || rec.kind === 'once') return null;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (rec.kind === 'weekly') return `Every ${days[rec.day_of_week] ?? 'week'} · ${rec.time_eat}`;
  return `Every day · ${rec.time_eat}`;
}
function actionStr(action) {
  if (action === 'broadcast') return 'Broadcast';
  if (action === 'dm_team') return 'Team message';
  return 'Customer message';
}

export default function TasksPage() {
  const { initData } = useTelegram() || {};
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!initData) return;
    try {
      const r = await fetch('/api/agent/owner-tasks', { headers: { 'x-telegram-init-data': initData }, cache: 'no-store' });
      const j = await r.json();
      setTasks(Array.isArray(j.tasks) ? j.tasks : []);
    } catch {} finally { setLoading(false); }
  }, [initData]);

  useEffect(() => { load(); }, [load]);

  async function cancelTask(id) {
    if (!initData) return;
    setTasks(prev => prev.filter(t => t.id !== id)); // optimistic
    try {
      await fetch(`/api/agent/owner-tasks?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'x-telegram-init-data': initData },
      });
    } catch { tgAlert('Could not cancel — check your connection.'); load(); }
  }

  async function sendTask(id) {
    if (!initData) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, _sending: true } : t));
    try {
      const r = await fetch('/api/agent/owner-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ taskId: id, action: 'send' }),
      });
      const j = await r.json();
      if (j.ok) setTasks(prev => prev.filter(t => t.id !== id));
      else { tgAlert('Could not send — try again.'); setTasks(prev => prev.map(t => t.id === id ? { ...t, _sending: false } : t)); }
    } catch { tgAlert('Could not send — try again.'); setTasks(prev => prev.map(t => t.id === id ? { ...t, _sending: false } : t)); }
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary, maxWidth: 560, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Tasks</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>What I&rsquo;m working on for you</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>
          Outreach you&rsquo;ve scheduled. I&rsquo;ll draft each one and ask you to approve before it sends. Just tell your bot &ldquo;message Sara on Friday&rdquo; or &ldquo;every Monday DM my VIPs&rdquo;.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.textHint, fontSize: 13 }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.textHint }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>&#128197;</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: COLORS.textPrimary, marginBottom: 6 }}>No scheduled tasks</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            Say &ldquo;message the printer tomorrow that the files are ready&rdquo; or &ldquo;every Friday 5pm thank this week&rsquo;s customers&rdquo; to your bot.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tasks.map(t => {
            const rec = recurrenceStr(t.recurrence);
            const awaiting = t.status === 'awaiting_approval';
            return (
              <div key={t.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{rec ? '🔁' : '📅'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{t.title || actionStr(t.action)}</div>
                    <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 3 }}>
                      {actionStr(t.action)} · {rec || whenStr(t.scheduled_at)}
                    </div>
                    {t.message ? (
                      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 8, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{t.message}</div>
                    ) : null}
                    {awaiting && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                        <button onClick={() => sendTask(t.id)} disabled={t._sending} style={{
                          background: COLORS.textPrimary, color: '#fff', border: 'none', borderRadius: 999,
                          padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: t._sending ? 'wait' : 'pointer',
                          fontFamily: FONT.body, opacity: t._sending ? 0.6 : 1,
                        }}>{t._sending ? 'Sending…' : '✅ Send now'}</button>
                        <span style={{ fontSize: 11, color: COLORS.textHint }}>or ✕ to cancel</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => cancelTask(t.id)} aria-label="Cancel task" style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.textHint, fontSize: 20, padding: '0 0 0 4px', flexShrink: 0 }}>&times;</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
