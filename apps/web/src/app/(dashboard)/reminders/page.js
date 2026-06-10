'use client';
import { useEffect, useState } from 'react';
import { useTelegram } from '../../../context/TelegramContext';
import { updateBusiness } from '../../../lib/updateBusiness';
import { COLORS, FONT, RADII, SHADOW } from '../../../lib/design-tokens';
import { tgAlert } from '../../../lib/utils';

const SERIF = "'Newsreader', Georgia, serif";

function timeStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function isPast(iso) { return iso && new Date(iso) < new Date(); }

export default function RemindersPage() {
  const { business, setBusiness, initData } = useTelegram() || {};
  const [reminders, setReminders] = useState([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (business?.notification_prefs?.reminders) {
      setReminders(business.notification_prefs.reminders);
    }
  }, [business?.id]); // eslint-disable-line

  async function addReminder() {
    if (!text.trim() || !date || !time || !business?.id) return;
    setSaving(true);
    const due_at = new Date(`${date}T${time}`).toISOString();
    const newReminder = { id: Date.now().toString(), text: text.trim(), due_at, created_at: new Date().toISOString() };
    const updated = [...reminders, newReminder].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const prefs = { ...(business.notification_prefs || {}), reminders: updated };
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
      setReminders(updated);
      setText(''); setDate(''); setTime('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      tgAlert('Could not save — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteReminder(id) {
    if (!business?.id) return;
    const updated = reminders.filter(r => r.id !== id);
    const prefs = { ...(business.notification_prefs || {}), reminders: updated };
    try {
      await updateBusiness(initData, { notification_prefs: prefs });
      setBusiness(b => ({ ...b, notification_prefs: prefs }));
      setReminders(updated);
    } catch (e) { tgAlert('Could not delete reminder.'); }
  }

  const upcoming = reminders.filter(r => !isPast(r.due_at));
  const past     = reminders.filter(r => isPast(r.due_at));
  const today    = new Date().toISOString().slice(0, 10);

  const INP = {
    padding: '10px 12px', borderRadius: RADII.md,
    border: `1px solid ${COLORS.border}`, background: COLORS.surface,
    fontSize: 14, fontFamily: FONT.body, color: COLORS.textPrimary,
    outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary, maxWidth: 560, paddingBottom: 100 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#B08A4A', marginBottom: 6 }}>Reminders</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 26, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Your reminders</h1>
        <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: 0 }}>MiniMe DMs you at the scheduled time. You can also say "remind me..." to your bot.</p>
      </div>

      {/* Add */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '16px', boxShadow: SHADOW.card, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Add reminder</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="What should I remind you about?" style={INP} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 4 }}>Date</div>
              <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} style={INP} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 4 }}>Time</div>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={INP} />
            </div>
          </div>
          {saved && <div style={{ color: COLORS.green, fontSize: 13, fontWeight: 600 }}>Reminder set!</div>}
          <button onClick={addReminder} disabled={!text.trim() || !date || !time || saving} style={{
            background: text.trim() && date && time ? COLORS.textPrimary : COLORS.border,
            color: text.trim() && date && time ? '#fff' : COLORS.textHint,
            border: 'none', borderRadius: RADII.lg, padding: '12px',
            fontSize: 14, fontWeight: 600, cursor: text.trim() && date && time ? 'pointer' : 'default',
            fontFamily: FONT.body,
          }}>
            {saving ? 'Setting...' : 'Set reminder'}
          </button>
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Upcoming ({upcoming.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.map(r => (
              <div key={r.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', boxShadow: SHADOW.card }}>
                <span style={{ fontSize: 20 }}>&#9200;</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary }}>{r.text}</div>
                  <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 3 }}>{timeStr(r.due_at)}</div>
                </div>
                <button onClick={() => deleteReminder(r.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.textHint, fontSize: 20, padding: '0 0 0 4px', flexShrink: 0 }}>x</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Past ({past.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: 0.5 }}>
            {past.slice(0, 5).map(r => (
              <div key={r.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>&#10003;</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: COLORS.textSecondary }}>{r.text}</div>
                  <div style={{ fontSize: 11, color: COLORS.textHint }}>{timeStr(r.due_at)}</div>
                </div>
                <button onClick={() => deleteReminder(r.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.textHint, fontSize: 16, padding: 0 }}>x</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.textHint }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>&#9200;</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: COLORS.textPrimary, marginBottom: 6 }}>No reminders yet</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            Set a reminder above, or say "remind me to restock bags tomorrow at 9am" to your bot.
          </div>
        </div>
      )}
    </div>
  );
}
