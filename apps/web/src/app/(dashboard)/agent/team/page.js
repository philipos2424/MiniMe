'use client';
/**
 * Team — roster + file notifications.
 * When clients send files, team members need to see them.
 * Redesigned with new design tokens.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';
import { COLORS, FONT, RADII, SHADOW } from '../../../../lib/design-tokens';
import { tgConfirm, tgAlert } from '../../../../lib/utils';

const ROLES = [
  { value: 'designer',     label: 'Designer' },
  { value: 'printer',      label: 'Printer' },
  { value: 'delivery',     label: 'Delivery' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'writer',       label: 'Writer' },
  { value: 'installer',    label: 'Installer' },
  { value: 'catering',     label: 'Catering' },
  { value: 'accountant',   label: 'Accountant' },
  { value: 'other',        label: 'Other' },
];

export default function TeamPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [team, setTeam] = useState(null);
  const [secretary, setSecretary] = useState(null);
  const [delegatedTasks, setDelegatedTasks] = useState([]);
  const [recentFiles, setRecentFiles] = useState([]);
  const [tab, setTab] = useState('team'); // 'team' | 'tasks' | 'files'
  const [howOpen, setHowOpen] = useState(false);
  const [editing, setEditing] = useState(null);



  const load = useCallback(async () => {
    if (!initData) return;
    const [teamRes, filesRes] = await Promise.all([
      fetch('/api/agent/team', { headers: { 'x-telegram-init-data': initData } }),
      fetch('/api/conversations/files', { headers: { 'x-telegram-init-data': initData } }).catch(() => null),
    ]);
    const j = await teamRes.json();
    setTeam(j.team || []);
    setSecretary(j.secretary || null);
    setDelegatedTasks(j.delegatedTasks || []);
    if (filesRes?.ok) {
      const fj = await filesRes.json();
      setRecentFiles(fj.files || []);
    }
  }, [initData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function remove(id) {
    if (!(await tgConfirm('Remove this team member?'))) return;
    await fetch(`/api/agent/team/${id}`, { method: 'DELETE', headers: { 'x-telegram-init-data': initData } });
    await load();
  }

  async function testPing(id) {
    const r = await fetch(`/api/agent/team/${id}/ping`, {
      method: 'POST', headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    if (j.ok) {
      await tgAlert(`Test message sent to ${j.diag?.name} via Telegram.`);
    } else {
      await tgAlert(`Failed: ${j.reason || 'unknown error'}`);
    }
  }

  const grouped = {};
  for (const m of team || []) {
    const key = m.role || 'other';
    (grouped[key] ||= []).push(m);
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 100, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      {/* Header */}
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Team Delegation</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 3 }}>MiniMe messages your team, tracks work, and updates you</p>
        </div>
        <button onClick={() => setEditing('new')} style={{
          appearance: 'none', border: `1px solid ${COLORS.teal}`, background: COLORS.tealLight,
          color: COLORS.teal, borderRadius: RADII.md, padding: '8px 16px', fontSize: 14,
          fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
        }}>+ Add</button>
      </div>

      {/* How delegation works — collapsed by default, one tap away */}
      <div style={{ padding: '12px 20px 0' }}>
        <button onClick={() => setHowOpen(v => !v)} style={{
          width: '100%', appearance: 'none', border: `1px solid ${COLORS.border}`, background: COLORS.surface,
          borderRadius: RADII.md, padding: '10px 14px', fontSize: 13, fontWeight: 600, color: COLORS.textSecondary,
          cursor: 'pointer', fontFamily: FONT.body, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>ℹ️ How delegation works</span>
          <span style={{ fontSize: 11, color: COLORS.textHint }}>{howOpen ? '▲ Hide' : '▼ Show'}</span>
        </button>
        {howOpen && (
          <div style={{
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderTop: 'none',
            borderRadius: `0 0 ${RADII.md}px ${RADII.md}px`, padding: '14px 16px', fontSize: 13,
            color: COLORS.textSecondary, lineHeight: 1.6,
          }}>
            <p style={{ margin: '0 0 10px' }}>
              When MiniMe hands work to someone here, they get a Telegram message explaining
              what's needed and can just reply naturally — no app to open, no forms to fill.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <strong>Who gets picked:</strong> depends on your{' '}
              <a href="/settings/trust" style={{ color: COLORS.teal }}>trust level</a>. On Supervised,
              MiniMe asks you who should take it. On Trusted or above, it auto-assigns by role and
              current workload, and tells you who got it.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              MiniMe follows up on its own — reminding before a deadline, chasing if it's overdue,
              and looping you in if someone goes quiet.
            </p>
            <p style={{ margin: 0 }}>
              Add the bot to a Telegram group and assignments + a daily wrap-up post there too, so
              the whole team sees who's doing what.
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        {[
          ['team', `👥 Members${team ? ` (${team.length})` : ''}`],
          ['tasks', `✅ Active Work${delegatedTasks.length > 0 ? ` (${delegatedTasks.length})` : ''}`],
          ['files', `📎 Client Files${recentFiles.length > 0 ? ` (${recentFiles.length})` : ''}`],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, appearance: 'none', border: 'none', background: 'transparent',
            padding: '12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            color: tab === k ? COLORS.teal : COLORS.textSecondary,
            borderBottom: tab === k ? `2px solid ${COLORS.teal}` : '2px solid transparent',
            fontFamily: FONT.body,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: '16px 20px' }}>
        <DelegationIntro secretary={secretary} team={team || []} onAdd={() => setEditing('new')} />

        {/* Edit modal */}
        {editing && (
          <EditModal
            initData={initData}
            member={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        )}

        {/* ── Team Tab ── */}
        {tab === 'team' && (
          <>
            {team === null && <TeamSkeleton />}

            {team !== null && team.length === 0 && (
              <div style={{
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: '32px 20px', textAlign: 'center', boxShadow: SHADOW.card,
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>No team members yet</div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, marginBottom: 16, lineHeight: 1.5 }}>
                  Add a teammate with Telegram ID so MiniMe can contact them, assign work, and follow up.
                </div>
                <button onClick={() => setEditing('new')} style={{
                  appearance: 'none', border: 'none', background: COLORS.teal, color: '#FFFFFF',
                  borderRadius: RADII.md, padding: '12px 24px', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', fontFamily: FONT.body,
                }}>+ Add first team member</button>
              </div>
            )}

            {team !== null && team.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {ROLES.filter(r => grouped[r.value]?.length).map(role => (
                  <div key={role.value}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
                      {role.label.toUpperCase()}
                    </div>
                    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card }}>
                      {grouped[role.value].map((m, i) => (
                        <MemberRow
                          key={m.id} member={m}
                          onEdit={() => setEditing(m)}
                          onRemove={() => remove(m.id)}
                          onPing={() => testPing(m.id)}
                          isLast={i === grouped[role.value].length - 1}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'tasks' && (
          <ActiveDelegatedWork tasks={delegatedTasks} team={team || []} secretary={secretary} />
        )}

        {/* ── Files Tab ── */}
        {tab === 'files' && (
          <FilesPanel files={recentFiles} />
        )}
      </div>
    </div>
  );
}

function DelegationIntro({ secretary, team, onAdd }) {
  const dmAble = team.filter(m => m.contact_telegram).length;
  const personalAble = team.filter(m => m.channel === 'personal').length;
  const examples = [
    'Tell Yonas to fix the Dell by 5pm',
    'Ask my designer to make the flyer today',
    'Message delivery: the Bole order is ready',
    'What is my team working on?',
  ];

  async function copyPrompt(text) {
    try {
      await navigator.clipboard?.writeText(text);
      await tgAlert('Copied. Send this to MiniMe in Telegram.');
    } catch {
      await tgAlert(text);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>How delegation works</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 6 }}>
          {['You ask', 'MiniMe contacts team', 'Teammate replies', 'MiniMe follows up', 'You get updates'].map((step, i) => (
            <div key={step} style={{ minHeight: 54, border: `1px solid ${COLORS.border}`, borderRadius: RADII.md, padding: 8, background: i === 0 ? COLORS.tealLight : COLORS.bg }}>
              <div style={{ fontSize: 10, color: COLORS.textHint, marginBottom: 3 }}>Step {i + 1}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary, lineHeight: 1.25 }}>{step}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: secretary?.connected ? COLORS.greenLight : COLORS.amberLight, border: `1px solid ${secretary?.connected ? COLORS.green : COLORS.amber}40`, borderRadius: RADII.lg, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>
          {secretary?.connected ? 'Secretary connected' : 'Secretary not connected'}
        </div>
        <div style={{ fontSize: 12.5, color: COLORS.textSecondary, marginTop: 5, lineHeight: 1.5 }}>
          {secretary?.connected
            ? `MiniMe can contact ${personalAble || 'reachable'} teammate${personalAble === 1 ? '' : 's'} as you when Telegram allows it. If not, it safely sends from the bot.`
            : 'MiniMe will contact teammates through the bot. Connect Secretary Mode if you want reachable teammates to get messages from your personal Telegram.'}
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.textHint, marginTop: 8, lineHeight: 1.45 }}>
          MiniMe can only send as you to people your Telegram Business connection has already seen.
        </div>
      </section>

      <section style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: 14, boxShadow: SHADOW.card }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Try it with MiniMe</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>{dmAble} teammate{dmAble === 1 ? '' : 's'} can be messaged now</div>
          </div>
          {!dmAble && <button onClick={onAdd} style={{ border: 'none', background: COLORS.teal, color: '#fff', borderRadius: RADII.md, padding: '8px 12px', fontSize: 12, fontWeight: 600, fontFamily: FONT.body }}>Add teammate</button>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {examples.map(ex => (
            <button key={ex} onClick={() => copyPrompt(ex)} style={{ appearance: 'none', border: `1px solid ${COLORS.border}`, background: COLORS.bg, borderRadius: RADII.md, padding: '10px 12px', textAlign: 'left', color: COLORS.textPrimary, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT.body }}>
              {ex}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActiveDelegatedWork({ tasks, team, secretary }) {
  if (!tasks.length) {
    return (
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '30px 20px', textAlign: 'center', boxShadow: SHADOW.card }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary }}>No active delegated work yet</div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 7, lineHeight: 1.5 }}>
          Ask MiniMe to give real work to a teammate. It will confirm, remind, chase, collect proof, and update you.
        </div>
      </div>
    );
  }

  const memberById = new Map(team.map(m => [m.id, m]));
  const byGroup = {
    blocked: tasks.filter(t => t.status === 'blocked'),
    overdue: tasks.filter(t => t.status !== 'blocked' && t.due_at && Date.parse(t.due_at) < Date.now()),
    in_progress: tasks.filter(t => t.status === 'in_progress' && (!t.due_at || Date.parse(t.due_at) >= Date.now())),
    pending: tasks.filter(t => t.status === 'pending' && (!t.due_at || Date.parse(t.due_at) >= Date.now())),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[
        ['blocked', 'Blocked'],
        ['overdue', 'Overdue'],
        ['in_progress', 'In progress'],
        ['pending', 'Pending'],
      ].filter(([key]) => byGroup[key].length).map(([key, label]) => (
        <div key={key}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.textHint, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, overflow: 'hidden', boxShadow: SHADOW.card }}>
            {byGroup[key].map((task, i) => (
              <DelegatedTaskRow key={task.id} task={task} member={memberById.get(task.supplier_id)} secretary={secretary} isLast={i === byGroup[key].length - 1} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DelegatedTaskRow({ task, member, secretary, isLast }) {
  const [open, setOpen] = useState(false);
  const due = task.due_at ? new Date(task.due_at) : null;
  const overdue = due && due.getTime() < Date.now() && task.status !== 'completed';
  const sentAs = task.last_channel === 'owner' || member?.channel === 'personal'
    ? 'You'
    : secretary?.connected ? 'Bot fallback' : 'Bot';
  return (
    <div style={{ borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}` }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', appearance: 'none', border: 'none', background: 'transparent', padding: 14, textAlign: 'left', cursor: 'pointer', fontFamily: FONT.body }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
            <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3 }}>
              {task.supplier_name || 'Unassigned'}{due ? ` - due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: overdue ? COLORS.red : task.status === 'blocked' ? COLORS.amber : COLORS.teal, flexShrink: 0 }}>{overdue ? 'Overdue' : task.status}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', fontSize: 12.5, color: COLORS.textSecondary, lineHeight: 1.5 }}>
          {task.description && <div style={{ marginBottom: 8 }}>{task.description}</div>}
          {task.blocked_reason && <div style={{ marginBottom: 8, color: '#92400E' }}>Blocked: {task.blocked_reason}</div>}
          <div>Last contact channel: {sentAs}</div>
          {task.latest_event?.note && <div>Latest update: {task.latest_event.note}</div>}
          {task.completion_file_id && <div>Proof file received in Telegram.</div>}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member, onEdit, onRemove, onPing, isLast }) {
  const handle = member.telegram_username ? `@${member.telegram_username}` : null;
  const sub = [handle, member.contact_phone, member.specialties].filter(Boolean).join(' · ');

  const preferred = member.contact_channel === 'personal' ? 'Secretary preferred' : member.contact_channel === 'bot' ? 'Bot only' : 'Auto';
  const current = member.channel === 'personal' ? 'Sends as you' : 'Sends as bot';
  const onTime = member.on_time_rate === null || member.on_time_rate === undefined ? 'No due tasks yet' : `${member.on_time_rate}% on time`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${COLORS.teal}, #0F766E)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#FFFFFF', fontWeight: 700, fontSize: 16,
      }}>
        {(member.name || '?')[0].toUpperCase()}
      </div>
      <button onClick={onEdit} style={{ flex: 1, appearance: 'none', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: FONT.body, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>{member.name}</span>
          {!member.contact_telegram && (
            <span style={{ fontSize: 10, padding: '2px 6px', background: '#FFFBEB', color: COLORS.amber, borderRadius: 999, fontWeight: 600 }}>No Telegram ID</span>
          )}
        </div>
        {sub && <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
          <ReadinessPill tone={member.contact_telegram ? 'good' : 'warn'}>{member.contact_telegram ? 'Telegram ID' : 'No Telegram ID'}</ReadinessPill>
          <ReadinessPill tone={member.channel === 'personal' ? 'good' : 'neutral'}>{current}</ReadinessPill>
          <ReadinessPill tone="neutral">{preferred}</ReadinessPill>
          <ReadinessPill tone={(member.open_tasks || 0) ? 'warn' : 'neutral'}>{member.open_tasks || 0} open</ReadinessPill>
          <ReadinessPill tone="neutral">{onTime}</ReadinessPill>
        </div>
      </button>
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        {member.contact_telegram && (
          <button onClick={onPing} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 12, color: COLORS.green, cursor: 'pointer', fontFamily: FONT.body, fontWeight: 500 }}>
            Test DM
          </button>
        )}
        <button onClick={onRemove} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 12, color: COLORS.textHint, cursor: 'pointer', fontFamily: FONT.body }}>
          Remove
        </button>
      </div>
    </div>
  );
}

function ReadinessPill({ children, tone }) {
  const color = tone === 'good' ? COLORS.green : tone === 'warn' ? COLORS.amber : COLORS.textHint;
  const bg = tone === 'good' ? COLORS.greenLight : tone === 'warn' ? COLORS.amberLight : COLORS.bg;
  return (
    <span style={{ fontSize: 10.5, color, background: bg, border: `1px solid ${color}30`, borderRadius: 999, padding: '3px 7px', fontWeight: 600 }}>
      {children}
    </span>
  );
}

function FilesPanel({ files }) {
  if (!files.length) {
    return (
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg, padding: '32px 20px', textAlign: 'center', boxShadow: SHADOW.card }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📎</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>No files yet</div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 1.5 }}>
          When clients send photos, PDFs or documents, they'll appear here so your team can access them.
        </div>
      </div>
    );
  }

  const images = files.filter(f => (f.file_type || '').startsWith('image/'));
  const others  = files.filter(f => !(f.file_type || '').startsWith('image/'));

  return (
    <div>
      <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
        All files clients sent — your team can access these anytime.
      </div>

      {images.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>PHOTOS ({images.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {images.map((f, i) => (
              <a key={i} href={f.file_url} target="_blank" rel="noreferrer" style={{ display: 'block', aspectRatio: '1', overflow: 'hidden', borderRadius: RADII.md }}>
                <img src={f.file_url} alt={f.file_name || 'photo'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>DOCUMENTS ({others.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {others.map((f, i) => (
              <a key={i} href={f.file_url} target="_blank" rel="noreferrer" style={{
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12,
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.lg, padding: '12px 14px', boxShadow: SHADOW.card,
              }}>
                <span style={{ fontSize: 26 }}>{(f.file_type || '').includes('pdf') ? '📄' : (f.file_type || '').includes('audio') ? '🎵' : '📎'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name || 'Attachment'}</div>
                  <div style={{ fontSize: 11, color: COLORS.textHint, marginTop: 2 }}>
                    From {f.customer_name || 'client'} · {f.created_at ? new Date(f.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: COLORS.teal, fontWeight: 500, flexShrink: 0 }}>Open →</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({ initData, member, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: member?.name || '',
    role: member?.role || 'designer',
    telegramUsername: member?.telegram_username || '',
    telegramId: member?.contact_telegram || '',
    phone: member?.contact_phone || '',
    specialties: member?.specialties || '',
    notes: member?.notes || '',
    contactChannel: member?.contact_channel || 'auto',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e?.preventDefault?.();
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    setSaving(true); setErr('');
    try {
      const url = member ? `/api/agent/team/${member.id}` : '/api/agent/team';
      const method = member ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role,
          telegramUsername: form.telegramUsername.trim().replace(/^@/, '') || null,
          telegramId: form.telegramId ? Number(form.telegramId) : null,
          phone: form.phone.trim() || null,
          specialties: form.specialties.trim() || null,
          notes: form.notes.trim() || null,
          contactChannel: form.contactChannel,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Failed');
      // Adding a member sends them a welcome DM — if Telegram rejected it
      // (they've never opened the bot), don't fail the add, just say so.
      if (!member && j.welcome && j.welcome.ok === false) {
        await tgAlert(`${form.name.trim()} was added, but I couldn't message them yet: ${j.welcome.reason}`);
      }
      onSaved();
    } catch (e) { setErr(e.message || 'Failed to save.'); } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end',
    }}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} style={{
        width: '100%', background: COLORS.bg, borderRadius: '20px 20px 0 0',
        padding: 20, maxHeight: '92vh', overflowY: 'auto', fontFamily: FONT.body,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{member ? 'Edit member' : 'Add team member'}</h2>
          <button type="button" onClick={onClose} style={{ appearance: 'none', border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', color: COLORS.textHint }}>×</button>
        </div>

        <FormField label="Name *">
          <input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Yared Design Studio" style={inputStyle} />
        </FormField>
        <FormField label="Role *">
          <select value={form.role} onChange={e => update('role', e.target.value)} style={inputStyle}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FormField label="Telegram username">
            <input value={form.telegramUsername} onChange={e => update('telegramUsername', e.target.value)} placeholder="username" style={inputStyle} />
          </FormField>
          <FormField label="Telegram ID">
            <input type="number" value={form.telegramId} onChange={e => update('telegramId', e.target.value)} placeholder="123456789" style={inputStyle} />
          </FormField>
        </div>
        <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 12, lineHeight: 1.5 }}>
          Telegram ID lets MiniMe DM this person. Get it from @userinfobot.
        </div>
        <FormField label="Phone">
          <input value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="0911…" style={inputStyle} />
        </FormField>
        <FormField label="Specialties">
          <input value={form.specialties} onChange={e => update('specialties', e.target.value)} placeholder="logos, brochures" style={inputStyle} />
        </FormField>
        <FormField label="How MiniMe should contact them">
          <select value={form.contactChannel} onChange={e => update('contactChannel', e.target.value)} style={inputStyle}>
            <option value="auto">Auto recommended</option>
            <option value="personal">Use my secretary when possible</option>
            <option value="bot">Always use bot</option>
          </select>
        </FormField>
        <div style={{ fontSize: 11, color: COLORS.textHint, marginBottom: 12, lineHeight: 1.5 }}>
          Auto tries your secretary only when Telegram has proven this chat is reachable, then falls back to the bot.
        </div>
        <FormField label="Notes">
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Preferred contact. Rush jobs ok." rows={2} style={{ ...inputStyle, resize: 'none' }} />
        </FormField>

        {err && <div style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} style={{
            flex: 1, appearance: 'none', border: `1px solid ${COLORS.border}`, background: 'transparent',
            color: COLORS.textPrimary, borderRadius: RADII.md, padding: '14px', fontSize: 15,
            cursor: 'pointer', fontFamily: FONT.body,
          }}>Cancel</button>
          <button type="submit" disabled={saving} style={{
            flex: 2, appearance: 'none', border: 'none', background: COLORS.teal, color: '#FFFFFF',
            borderRadius: RADII.md, padding: '14px', fontSize: 15, fontWeight: 600,
            cursor: saving ? 'default' : 'pointer', fontFamily: FONT.body,
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Saving…' : member ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: COLORS.textSecondary, display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', border: `1px solid ${COLORS.border}`, background: COLORS.surface,
  borderRadius: RADII.md, padding: '11px 12px', fontSize: 14, fontFamily: FONT.body,
  color: COLORS.textPrimary, outline: 'none', boxSizing: 'border-box',
};

function TeamSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...Array(3)].map((_, i) => (
        <div key={i} style={{ height: 68, background: COLORS.border, borderRadius: RADII.lg, animation: 'pulse 1.5s infinite', opacity: 1 - i * 0.2 }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}
