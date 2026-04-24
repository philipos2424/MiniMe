'use client';
/**
 * Team — roster of suppliers the Agent coordinates with.
 * Classic flat dark list, matching /agent/page.js style.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTelegram } from '../../../../context/TelegramContext';

const ROLES = [
  { value: 'designer',     label: 'Designer' },
  { value: 'printer',      label: 'Printer' },
  { value: 'delivery',     label: 'Delivery' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'writer',       label: 'Writer' },
  { value: 'installer',    label: 'Installer' },
  { value: 'catering',     label: 'Catering' },
  { value: 'other',        label: 'Other' },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.value, r.label]));
const GROUP_ORDER = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'];

export default function TeamPage() {
  const router = useRouter();
  const { initData } = useTelegram() || {};
  const [team, setTeam] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | member object

  const load = useCallback(async () => {
    if (!initData) return;
    const r = await fetch('/api/agent/team', {
      headers: { 'x-telegram-init-data': initData },
    });
    const j = await r.json();
    setTeam(j.team || []);
  }, [initData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const twa = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    const bb = twa?.BackButton;
    if (!bb) return;
    const onBack = () => router.push('/agent');
    bb.show(); bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  async function remove(id) {
    if (!confirm('Remove this team member?')) return;
    await fetch(`/api/agent/team/${id}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData },
    });
    await load();
  }

  const grouped = {};
  for (const m of team || []) {
    const key = m.role || 'other';
    (grouped[key] ||= []).push(m);
  }

  return (
    <div className="max-w-xl mx-auto pb-6">
      <header className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl text-gold-light">Team</h1>
          <p className="text-muted text-sm mt-0.5">People your Agent will coordinate with</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="text-sm font-medium text-gold hover:text-gold-light transition"
        >
          + Add
        </button>
      </header>

      {editing && (
        <EditModal
          initData={initData}
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {team === null && <ListSkeleton />}
      {team !== null && team.length === 0 && (
        <EmptyState onAdd={() => setEditing('new')} />
      )}
      {team !== null && team.length > 0 && (
        <div className="space-y-5">
          {GROUP_ORDER.filter(r => grouped[r]?.length).map(role => (
            <section key={role}>
              <h2 className="text-xs uppercase tracking-wider text-muted mb-2 px-1">
                {ROLE_LABEL[role]}
              </h2>
              <ul className="divide-y divide-border border border-border rounded-2xl overflow-hidden bg-card">
                {grouped[role].map(m => (
                  <MemberRow key={m.id} member={m} onEdit={() => setEditing(m)} onRemove={() => remove(m.id)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member, onEdit, onRemove }) {
  const handle = member.telegram_username ? `@${member.telegram_username}` : null;
  const lineParts = [];
  if (handle) lineParts.push(handle);
  if (member.contact_phone) lineParts.push(member.contact_phone);
  if (member.specialties) lineParts.push(member.specialties);
  const sub = lineParts.join(' · ');

  return (
    <li className="flex items-start gap-3 p-4 hover:bg-border/20 transition">
      <button onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-medium text-gold-light truncate">{member.name}</h3>
          {!member.contact_telegram && (
            <span className="text-xs text-amber-400 flex-shrink-0">no TG ID</span>
          )}
        </div>
        {sub && <p className="text-muted text-xs mt-0.5 truncate">{sub}</p>}
      </button>
      <button onClick={onRemove} className="text-xs text-muted hover:text-red-400 transition flex-shrink-0">
        Remove
      </button>
    </li>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="text-center py-10">
      <p className="text-muted text-sm mb-4">
        No team members yet. Add a designer, printer, or delivery person so the Agent knows who to brief.
      </p>
      <button
        onClick={onAdd}
        className="text-sm font-medium text-gold hover:text-gold-light transition"
      >
        + Add first team member
      </button>
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
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Failed');
      }
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg text-gold-light">
            {member ? 'Edit team member' : 'Add team member'}
          </h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-gold-light text-sm">Close</button>
        </div>

        <Field label="Name *">
          <input
            value={form.name} onChange={e => update('name', e.target.value)}
            placeholder="Yared Design Studio"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
          />
        </Field>

        <Field label="Role *">
          <select
            value={form.role} onChange={e => update('role', e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telegram username">
            <input
              value={form.telegramUsername} onChange={e => update('telegramUsername', e.target.value)}
              placeholder="yared_designs"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
          <Field label="Telegram ID">
            <input
              type="number" inputMode="numeric"
              value={form.telegramId} onChange={e => update('telegramId', e.target.value)}
              placeholder="123456789"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
            />
          </Field>
        </div>
        <p className="text-muted text-xs -mt-2 mb-3 px-1">
          Numeric Telegram ID is required for the Agent to DM them. Ask them to forward a message to @userinfobot.
        </p>

        <Field label="Phone">
          <input
            value={form.phone} onChange={e => update('phone', e.target.value)}
            placeholder="0911…"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
          />
        </Field>

        <Field label="Specialties">
          <input
            value={form.specialties} onChange={e => update('specialties', e.target.value)}
            placeholder="logos, brochures"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50"
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={form.notes} onChange={e => update('notes', e.target.value)}
            placeholder="Best for rush jobs. Prefers Telegram."
            rows={2}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-body outline-none focus:border-gold/50 resize-none"
          />
        </Field>

        {err && <p className="text-red-400 text-xs mt-2">{err}</p>}

        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-gold-light transition">
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="text-sm font-medium bg-gold/15 border border-gold/30 text-gold-light hover:bg-gold/25 transition rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : (member ? 'Save' : 'Add')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="text-muted text-xs block mb-1">{label}</span>
      {children}
    </label>
  );
}

function ListSkeleton() {
  return (
    <div className="border border-border rounded-2xl divide-y divide-border bg-card">
      {[0, 1, 2].map(i => (
        <div key={i} className="p-4 animate-pulse flex items-start gap-3">
          <div className="flex-1">
            <div className="h-4 w-3/5 bg-border rounded mb-2" />
            <div className="h-3 w-2/5 bg-border rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
