'use client';
/**
 * MiniMe Brain — toggle autonomous mode, watch reasoning, see what MiniMe learned.
 * Redesigned: clean mobile UI, lessons panel.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgAlert } from '../../../../lib/utils';

export default function BrainPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [enabled, setEnabled] = useState(null);
  const [recent, setRecent] = useState([]);
  const [team, setTeam] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [busy, setBusy] = useState(false);
  const [secBusy, setSecBusy] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [memories, setMemories] = useState([]);
  const [mirror, setMirror] = useState([]);
  const [tab, setTab] = useState('status'); // 'status' | 'learned' | 'activity'

  const load = useCallback(async () => {
    if (!initData) return;
    const [brainRes, lessonsRes] = await Promise.all([
      fetch('/api/agent/brain', { headers: { 'x-telegram-init-data': initData } }),
      fetch('/api/agent/knowledge', { headers: { 'x-telegram-init-data': initData } }),
    ]);
    const j = await brainRes.json();
    setEnabled(!!j.enabled);
    setRecent(j.recent || []);
    setTeam(j.team || []);
    if (lessonsRes.ok) {
      const lj = await lessonsRes.json();
      setLessons((lj.sources || []).filter(s => s.tag === 'auto-learned'));
    }
  }, [initData]);

  async function loadSecretaryData() {
    if (!initData) return;
    setSecBusy(true);
    try {
      const [tRes, mRes, vRes] = await Promise.all([
        fetch('/api/agent/tasks', { headers: { 'x-telegram-init-data': initData } }),
        fetch('/api/agent/memories', { headers: { 'x-telegram-init-data': initData } }),
        fetch('/api/agent/voice-mirror', { headers: { 'x-telegram-init-data': initData } }),
      ]);
      setTasks(await tRes.json());
      setMemories(await mRes.json());
      setMirror(await vRes.json());
    } catch (e) {
      console.error('Secretary load error', e);
    } finally {
      setSecBusy(false);
    }
  }

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function toggle() {
    if (!initData) return;
    setBusy(true);
    const prev = enabled;
    const next = !enabled;
    setEnabled(next);
    try {
      const r = await fetch('/api/agent/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error('fail');
      const j = await r.json();
      setEnabled(!!j.enabled);
    } catch {
      setEnabled(prev);
      await tgAlert('Could not flip brain mode. Try again.');
    } finally { setBusy(false); }
  }

  const dmable = team.filter(t => t.dm_able && t.active);
  const teamWarning = !team.length
    ? 'No team members yet.'
    : !dmable.length ? 'No team member has a Telegram ID — MiniMe can\'t DM anyone.' : null;

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>MiniMe Brain</h1>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 3 }}>
          Autonomous mode · {lessons.length} things learned so far
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        {[
          ['status',   'Status'],
          ['learned',  `Learned (${lessons.length})`],
          ['activity', 'Activity'],
          ['secretary', 'Secretary'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, appearance: 'none', border: 'none', background: 'transparent',
            padding: '12px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            color: tab === k ? COLORS.teal : COLORS.textSecondary,
            borderBottom: tab === k ? `2px solid ${COLORS.teal}` : '2px solid transparent',
            fontFamily: FONT.body,
          }}>{l}</button>
        ))}
      </div>
      <div style={{ padding: '16px 20px' }}>

        {/* ── Status Tab ── */}
        {tab === 'status' && (
          <>
            {/* Brain toggle */}
            <div style={{
              background: enabled ? `linear-gradient(135deg, ${COLORS.teal}, #0F766E)` : COLORS.surface,
              border: `1px solid ${enabled ? 'transparent' : COLORS.border}`,
              borderRadius: RADII.lg, padding: '20px', marginBottom: 16,
              boxShadow: enabled ? '0 8px 32px rgba(13,148,136,0.25)' : SHADOW.card,
              transition: 'all 0.3s ease',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: enabled ? '#FFFFFF' : COLORS.textPrimary }}>
                    Autonomous mode {enabled === null ? '…' : enabled ? 'ON ✓' : 'OFF'}
                  </div>
                  <p style={{ fontSize: 13, color: enabled ? 'rgba(255,255,255,0.8)' : COLORS.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
                    {enabled
                      ? 'MiniMe is thinking for itself — choosing when to reply, ask for info, or brief your team.'
                      : 'Off — MiniMe follows a fixed pipeline. Turn on for full AI autonomy.'}
                  </p>
                </div>
                {/* Toggle switch */}
                <button onClick={toggle} disabled={busy || enabled === null} style={{
                  appearance: 'none', border: 'none', cursor: busy ? 'default' : 'pointer',
                  width: 52, height: 30, borderRadius: 999, flexShrink: 0, position: 'relative',
                  background: enabled ? 'rgba(255,255,255,0.3)' : COLORS.border,
                  transition: 'background 0.2s',
                }}>
                  <span style={{
                    position: 'absolute', top: 3, width: 24, height: 24, borderRadius: '50%',
                    background: '#FFFFFF', transition: 'left 0.2s',
                    left: enabled ? 25 : 3,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  }} />
                </button>
              </div>
            </div>

            {/* Team status */}
            <div style={{ background: COLORS.surface, border: `1px solid ${teamWarning ? COLORS.amber : COLORS.border}`, borderRadius: RADII.lg, padding: '14px 16px', boxShadow: SHADOW.card, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em' }}>TEAM READINESS</div>
                <button onClick={() => router.push('/agent/team')} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 13, color: COLORS.teal, cursor: 'pointer', fontFamily: FONT.body }}>
                  Manage →
                </button>
              </div>
              {teamWarning ? (
                <div style={{ fontSize: 13, color: '#92400E', lineHeight: 1.5 }}>⚠️ {teamWarning}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {team.map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: COLORS.textPrimary }}>{t.name} <span style={{ color: COLORS.textHint }}>· {t.role}</span></span>
                      <span style={{ color: t.dm_able && t.active ? COLORS.green : COLORS.amber, fontWeight: 500 }}>
                        {t.active ? (t.dm_able ? '✓ Ready' : '⚠ No ID') : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* What MiniMe can do */}
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>CAPABILITIES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { icon: '💬', label: 'Reply to clients', desc: 'In your exact voice, 24/7' },
                { icon: '🧠', label: 'Learn from conversations', desc: `${lessons.length} lessons extracted so far` },
                { icon: '📋', label: 'Brief your team', desc: `${dmable.length} team member${dmable.length !== 1 ? 's' : ''} reachable via Telegram DM` },
                { icon: '⏰', label: 'Follow up automatically', desc: 'Remind clients, chase approvals' },
              ].map((cap, i) => (
                <div key={i} style={{
                  background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.lg, padding: '12px 14px', boxShadow: SHADOW.card,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{cap.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{cap.label}</div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 1 }}>{cap.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Learned Tab ── */}
        {tab === 'learned' && (
          <>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
              MiniMe automatically extracts lessons from your real conversations every night. These go straight into the knowledge base.
            </div>

            {lessons.length === 0 ? (
              <div style={{
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: '32px 20px', textAlign: 'center', boxShadow: SHADOW.card,
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>Nothing learned yet</div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 1.5, maxWidth: 280, margin: '6px auto 0' }}>
                  MiniMe mines your conversations every night. Come back tomorrow!
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {lessons.map(l => (
                  <div key={l.id} style={{
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: RADII.lg, padding: '14px', boxShadow: SHADOW.card,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>{l.title}</div>
                        <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 3 }}>
                          Auto-learned · {new Date(l.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, padding: '3px 8px', background: '#F3F0FF', color: '#7C3AED', borderRadius: 999, fontWeight: 600, flexShrink: 0 }}>
                        auto
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Secretary Tab */}
        {tab === 'secretary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.textPrimary }}>Command Center</div>
              <button
                onClick={() => loadSecretaryData()}
                disabled={secBusy}
                style={{ background: COLORS.teal, color: '#FFF', border: 'none', borderRadius: RADII.sm, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body }}
              >
                {secBusy ? 'Loading...' : 'Refresh Data'}
              </button>
            </div>

            {/* Tasks */}
            <section>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>PENDING COMMITMENTS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tasks.length === 0 ? (
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', padding: 20, background: COLORS.surface, borderRadius: RADII.lg, border: `1px solid ${COLORS.border}` }}>No pending tasks extracted.</div>
                ) : tasks.map((t, i) => (
                  <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px', boxShadow: SHADOW.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{t.description}</div>
                      <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>Priority {t.priority} · Due: {t.deadline ? new Date(t.deadline).toLocaleDateString() : 'No date'}</div>
                    </div>
                    <input type='checkbox' checked={t.status === 'completed'} onChange={async () => {
                      await fetch('/api/agent/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
                        body: JSON.stringify({ taskId: t.id }),
                      });
                      setTasks(tasks.filter(x => x.id !== t.id));
                    }} style={{ width: 18, height: 18, accentColor: COLORS.teal }} />
                  </div>
                ))}
              </div>
            </section>

            {/* Memories */}
            <section>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>CUSTOMER DOSSIERS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {memories.length === 0 ? (
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', padding: 20, background: COLORS.surface, borderRadius: RADII.lg, border: `1px solid ${COLORS.border}` }}>No memories stored yet.</div>
                ) : memories.slice(0, 10).map((m, i) => (
                  <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px', boxShadow: SHADOW.card }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: COLORS.teal, fontWeight: 600 }}>{m.category}</span>
                      <span style={{ fontSize: 10, color: COLORS.textHint }}>{new Date(m.created_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, lineHeight: 1.4 }}>{m.fact}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Voice Evolution */}
            <section>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 12 }}>VOICE MIRROR EVOLUTION</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {mirror.length === 0 ? (
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', padding: 20, background: COLORS.surface, borderRadius: RADII.lg, border: `1px solid ${COLORS.border}` }}>No mirrored edits captured yet.</div>
                ) : mirror.slice(0, 5).map((m, i) => (
                  <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '12px', boxShadow: SHADOW.card }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, marginBottom: 8 }}>Draft → Refined</div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic', marginBottom: 6, padding: '6px', background: '#F9FAFB', borderRadius: RADII.sm }}>&quot;{m.draft_text}&quot;</div>
                    <div style={{ fontSize: 13, color: COLORS.textPrimary, fontWeight: 500, padding: '6px', background: '#F0FDFA', border: `1px solid #99F6E4`, borderRadius: RADII.sm }}>&quot;{m.corrected_text}&quot;</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function ThoughtCard({ t }) {
  const [open, setOpen] = useState(false);
  const calls = Array.isArray(t.tool_calls) ? t.tool_calls : [];
  const failures = calls.filter(c => c.result?.ok === false);
  const timeStr = new Date(t.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${failures.length ? COLORS.amber : COLORS.border}`, borderRadius: RADII.lg, boxShadow: SHADOW.card }}>
      <button onClick={() => setOpen(!open)} style={{
        appearance: 'none', border: 'none', background: 'transparent', textAlign: 'left',
        width: '100%', padding: '14px', cursor: 'pointer', fontFamily: FONT.body,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.outcome || 'Processed'}
          </span>
          <span style={{ fontSize: 11, color: COLORS.textHint, flexShrink: 0 }}>{timeStr}</span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
          {t.trigger} · {t.duration_ms ? `${t.duration_ms}ms` : ''} · {calls.length} action{calls.length !== 1 ? 's' : ''}
          {failures.length > 0 && <span style={{ color: COLORS.red }}> · {failures.length} failed</span>}
        </div>
        {calls.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
            {calls.map((c, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '3px 8px', borderRadius: 999,
                background: c.result?.ok === false ? '#FEF2F2' : '#F0FDFA',
                color: c.result?.ok === false ? COLORS.red : COLORS.teal,
                border: `1px solid ${c.result?.ok === false ? '#FECACA' : '#99F6E4'}`,
                fontWeight: 500,
              }}>{c.name}</span>
            ))}
          </div>
        )}
      </button>
      {open && failures.length > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          <div style={{ background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: RADII.sm, padding: '10px 12px' }}>
            {failures.map((f, i) => (
              <div key={i} style={{ fontSize: 12, color: COLORS.red, marginTop: i > 0 ? 6 : 0 }}>
                <code style={{ fontWeight: 700 }}>{f.name}</code> — {f.result?.error || 'failed'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
