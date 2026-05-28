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
  const [recentFiles, setRecentFiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('team'); // 'team' | 'files'

  const load = useCallback(async () => {
    if (!initData) return;
    const [teamRes, filesRes] = await Promise.all([
      fetch('/api/agent/team', { headers: { 'x-telegram-init-data': initData } }),
      fetch('/api/conversations/files', { headers: { 'x-telegram-init-data': initData } }).catch(() => null),
    ]);
    const j = await teamRes.json();
    setTeam(j.team || []);
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
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Team</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 3 }}>People MiniMe coordinates with</p>
        </div>
        <button onClick={() => setEditing('new')} style={{
          appearance: 'none', border: `1px solid ${COLORS.teal}`, background: COLORS.tealLight,
          color: COLORS.teal, borderRadius: RADII.md, padding: '8px 16px', fontSize: 14,
          fontWeight: 600, cursor: 'pointer', fontFamily: FONT.body,
        }}>+ Add</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}` }}>
        {[
          ['team', `👥 Members${team ? ` (${team.length})` : ''}`],
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
                  Add your designer, delivery person, or accountant so MiniMe can brief them directly.
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

        {/* ── Files Tab ── */}
        {tab === 'files' && (
          <FilesPanel files={recentFiles} />
        )}
      </div>
    </div>
  );
}

function MemberRow({ member, onEdit, onRemove, onPing, isLast }) {
  const handle = member.telegram_username ? `@${member.telegram_username}` : null;
  const sub = [handle, member.contact_phone, member.specialties].filter(Boolean).join(' · ');

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
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
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
