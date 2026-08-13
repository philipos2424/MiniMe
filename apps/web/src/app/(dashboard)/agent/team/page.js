'use client';
/**
 * Team control center — redesign for managing teammates, viewing work status,
 * and configuring AI delegation with full light & dark mode theme support.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Users, CheckCircle2, Clock, ChevronRight, X,
  Send, Trash2, HelpCircle, ShieldCheck, AlertCircle, Pencil
} from 'lucide-react';
import { useTelegram } from '../../../../context/TelegramContext';
import { tgConfirm, tgAlert } from '../../../../lib/utils';

// Kept in sync with api/agent/team/route.js's ROLES. "Other" always stays
// last — picking it reveals a free-text field for whatever isn't listed.
const ROLES = [
  { value: 'designer',     label: 'Designer' },
  { value: 'printer',      label: 'Printer' },
  { value: 'delivery',     label: 'Delivery' },
  { value: 'photographer', label: 'Photographer' },
  { value: 'writer',       label: 'Writer' },
  { value: 'installer',    label: 'Installer' },
  { value: 'catering',     label: 'Catering' },
  { value: 'accountant',   label: 'Accountant' },
  { value: 'cashier',      label: 'Cashier' },
  { value: 'sales',        label: 'Sales' },
  { value: 'cleaner',      label: 'Cleaner' },
  { value: 'security',     label: 'Security' },
  { value: 'other',        label: 'Other' },
];

export default function TeamPage() {
  const router = useRouter();
  const { initData, business } = useTelegram() || {};
  const [team, setTeam] = useState(null);
  const [delegatedTasks, setDelegatedTasks] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | supplier object
  const [howOpen, setHowOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteShare, setInviteShare] = useState(null); // { name, url } | null

  // Form state
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('designer');
  const [formSpecialty, setFormSpecialty] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formTgUser, setFormTgUser] = useState('');
  const [formTgId, setFormTgId] = useState('');
  const [formActiveStart, setFormActiveStart] = useState('');
  const [formActiveEnd, setFormActiveEnd] = useState('');
  const [formMaxTasks, setFormMaxTasks] = useState('');

  const isEditing = editing && editing !== 'new';

  const load = useCallback(async () => {
    if (!initData) return;
    try {
      const teamRes = await fetch('/api/agent/team', {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store'
      });
      if (teamRes.ok) {
        const j = await teamRes.json();
        setTeam(j.team || []);
        setDelegatedTasks(j.delegatedTasks || []);
        setRecentEvents(j.recentEvents || j.delegatedTasks?.slice(0, 10) || []);
      }
    } catch (e) {
      console.error('[TeamPage] Load error:', e);
      setTeam([]);
    }
  }, [initData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const bb = typeof window !== 'undefined' ? window.Telegram?.WebApp?.BackButton : null;
    if (!bb) return;
    const onBack = () => router.push('/');
    bb.show();
    bb.onClick(onBack);
    return () => { try { bb.offClick(onBack); bb.hide(); } catch {} };
  }, [router]);

  function openAddModal() {
    setFormName('');
    setFormRole('designer');
    setFormSpecialty('');
    setFormPhone('');
    setFormTgUser('');
    setFormTgId('');
    setFormActiveStart('');
    setFormActiveEnd('');
    setFormMaxTasks('');
    setEditing('new');
  }

  function openEditModal(member) {
    setFormName(member.name || '');
    setFormRole(member.role || 'designer');
    setFormSpecialty(member.role === 'other' ? (member.specialties || '') : '');
    setFormPhone(member.contact_phone || '');
    setFormTgUser(member.telegram_username || '');
    setFormTgId('');
    const [start, end] = (member.active_hours || '').split('-');
    setFormActiveStart(start?.trim() || '');
    setFormActiveEnd(end?.trim() || '');
    setFormMaxTasks(member.max_daily_tasks != null ? String(member.max_daily_tasks) : '');
    setEditing(member);
  }

  async function saveTeammate(e) {
    e.preventDefault();
    if (!formName.trim()) {
      await tgAlert('Please enter teammate name');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: formName.trim(),
        role: formRole,
        // null (not undefined) so editing away from "Other" — or clearing the
        // text — actually clears a previously-saved specialty on PATCH.
        specialties: formRole === 'other' ? (formSpecialty.trim() || null) : null,
        phone: formPhone.trim() || undefined,
        activeHours: formActiveStart && formActiveEnd ? `${formActiveStart}-${formActiveEnd}` : null,
        maxDailyTasks: formMaxTasks.trim() || null,
        // The @username label is harmless to edit either way. The numeric
        // Telegram ID (contact_telegram — who MiniMe actually messages) has
        // no input in this form at all, add or edit, on purpose: changing
        // who someone is should go through remove + re-invite, not a typo fix.
        telegramUsername: formTgUser.trim() || undefined,
        ...(isEditing ? {} : { telegramId: formTgId.trim() || undefined }),
      };

      const res = await fetch(isEditing ? `/api/agent/team/${editing.id}` : '/api/agent/team', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-init-data': initData,
        },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (j.error) {
        await tgAlert(`Error: ${j.error}`);
      } else {
        setEditing(null);
        await load();
        // No direct DM reachable yet (no username/ID given, or the welcome
        // DM couldn't send) — offer the invite link right away instead of
        // leaving the owner to discover it's needed later. Only relevant on
        // add — editing an existing member never returns one.
        if (j.inviteUrl) setInviteShare({ name: formName.trim(), url: j.inviteUrl });
      }
    } catch (err) {
      await tgAlert(`Failed to save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function shareInvite(url, name) {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `Join ${name ? `${name}'s ` : ''}team on MiniMe`, url });
        return;
      } catch {
        // user cancelled the share sheet, or it's unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      await tgAlert('Invite link copied — send it to them however you like.');
    } catch {
      await tgAlert(url);
    }
  }

  async function removeMember(id, name, openTasks) {
    const prompt = openTasks > 0
      ? `Remove ${name} from your team? They have ${openTasks} open task${openTasks === 1 ? '' : 's'} — I'll flag those to you instead of reassigning them automatically.`
      : `Remove ${name} from your team?`;
    if (!(await tgConfirm(prompt))) return;
    try {
      await fetch(`/api/agent/team/${id}`, {
        method: 'DELETE',
        headers: { 'x-telegram-init-data': initData },
      });
      await load();
    } catch (e) {
      await tgAlert(`Error: ${e.message}`);
    }
  }

  async function testPing(id, name) {
    try {
      const r = await fetch(`/api/agent/team/${id}/ping`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData },
      });
      const j = await r.json();
      if (j.ok) {
        await tgAlert(`Test message sent to ${name} on Telegram.`);
      } else {
        await tgAlert(`Failed to send: ${j.reason || 'Member has not started Telegram bot'}`);
      }
    } catch (e) {
      await tgAlert(`Error: ${e.message}`);
    }
  }

  // Derive stats
  const activeTasksCount = (delegatedTasks || []).filter(t => ['pending', 'in_progress'].includes(t.status)).length;
  const pendingRepliesCount = (delegatedTasks || []).filter(t => t.status === 'blocked' || !t.accepted_at).length;
  const isTgConnected = !!(business?.telegram_biz_conn_id || business?.telegram_bot_username);

  // Latest 3 activity items
  const latestActivity = (recentEvents || []).slice(0, 3);

  return (
    <div style={{
      background: 'var(--paper)',
      minHeight: '100vh',
      paddingBottom: 110,
      fontFamily: "'Geist', 'Inter', -apple-system, sans-serif",
      color: 'var(--ink)',
      maxWidth: 600,
      margin: '0 auto',
    }}>
      {/* ── Top Navigation Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line-soft)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: 'var(--ink)', display: 'grid', placeItems: 'center'
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
              Team
            </h1>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
              Manage your teammates
            </p>
          </div>
        </div>

        <button
          onClick={openAddModal}
          style={{
            appearance: 'none',
            border: 'none',
            background: 'var(--mint)',
            color: '#FFFFFF',
            borderRadius: 999,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
          }}
        >
          <Plus size={15} /> Add
        </button>
      </header>

      <main style={{ padding: '20px 20px 0' }}>
        {/* ── Section 1: Team Members Roster ── */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: 0 }}>
              Team Members
            </h2>
            {team && team.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
                {team.length} member{team.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {!team ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Loading teammates...
            </div>
          ) : team.length === 0 ? (
            /* Clean Empty State */
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--line-soft)',
              borderRadius: 20,
              padding: '36px 24px',
              textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.12)',
                display: 'grid', placeItems: 'center', color: 'var(--mint)', fontSize: 26, marginBottom: 14
              }}>
                👥
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px' }}>
                No teammates yet
              </h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', maxWidth: 280, lineHeight: 1.45 }}>
                MiniMe can only delegate work after teammates are added.
              </p>
              <button
                onClick={openAddModal}
                style={{
                  appearance: 'none', border: 'none',
                  background: 'var(--mint)', color: '#FFFFFF',
                  borderRadius: 999, padding: '10px 22px',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                }}
              >
                <Plus size={16} /> Add Teammate
              </button>
            </div>
          ) : (
            /* Compact Teammates List */
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--line-soft)',
              borderRadius: 20,
              overflow: 'hidden',
            }}>
              {team.map((m, idx) => {
                const initials = (m.name || 'TM').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const isLast = idx === team.length - 1;
                const isPending = !m.contact_telegram;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 16px',
                      borderBottom: isLast ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    {/* Avatar with Status Ring */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--mint)', fontWeight: 700, fontSize: 15,
                        display: 'grid', placeItems: 'center',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                      }}>
                        {initials}
                      </div>
                      <span style={{
                        position: 'absolute', bottom: 1, right: 1,
                        width: 10, height: 10, borderRadius: '50%',
                        background: isPending ? '#F59E0B' : (m.open_tasks > 0 ? '#F59E0B' : 'var(--mint)'),
                        border: '2px solid var(--card)',
                      }} />
                    </div>

                    {/* Name & Role */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
                          {m.name}
                        </span>
                        <span style={{
                          background: 'var(--cream-2)', color: 'var(--ink-soft)',
                          borderRadius: 999, padding: '2px 8px',
                          fontSize: 11, fontWeight: 500, textTransform: 'capitalize',
                        }}>
                          {m.role === 'other' && m.specialties ? m.specialties : (m.role || 'team')}
                        </span>
                        {isPending && (
                          <span style={{
                            background: 'rgba(245, 158, 11, 0.15)', color: '#B45309',
                            borderRadius: 999, padding: '2px 8px',
                            fontSize: 11, fontWeight: 600,
                          }}>
                            Invited — not joined yet
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {isPending
                          ? 'Waiting for them to tap the invite link'
                          : (m.open_tasks > 0 ? `${m.open_tasks} active task${m.open_tasks === 1 ? '' : 's'}` : 'Available')}
                        {m.contact_phone ? ` · ${m.contact_phone}` : ''}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => openEditModal(m)}
                        title="Edit teammate"
                        style={{
                          background: 'var(--cream-2)', border: 'none', borderRadius: 8,
                          width: 32, height: 32, cursor: 'pointer',
                          display: 'grid', placeItems: 'center', color: 'var(--ink)',
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      {isPending ? (
                        <button
                          onClick={() => (m.invite_url ? shareInvite(m.invite_url, m.name) : tgAlert("No invite link on file — try removing and re-adding this teammate."))}
                          title="Share invite again"
                          style={{
                            background: 'var(--cream-2)', border: 'none', borderRadius: 8,
                            width: 32, height: 32, cursor: 'pointer',
                            display: 'grid', placeItems: 'center', color: 'var(--ink)',
                          }}
                        >
                          <Send size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => testPing(m.id, m.name)}
                          title="Send test DM on Telegram"
                          style={{
                            background: 'var(--cream-2)', border: 'none', borderRadius: 8,
                            width: 32, height: 32, cursor: 'pointer',
                            display: 'grid', placeItems: 'center', color: 'var(--ink)',
                          }}
                        >
                          <Send size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => removeMember(m.id, m.name, m.open_tasks)}
                        title="Remove member"
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)', border: 'none', borderRadius: 8,
                          width: 32, height: 32, cursor: 'pointer',
                          display: 'grid', placeItems: 'center', color: 'var(--error)',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 2: Overview Statistics ── */}
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: '0 0 12px' }}>
            Overview
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {/* Stat 1: Members */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--line-soft)', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--mint)', marginBottom: 6 }}>
                <Users size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>
                {team ? team.length : '0'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 500 }}>
                Members
              </div>
            </div>

            {/* Stat 2: Active Tasks */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--line-soft)', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#3B82F6', marginBottom: 6 }}>
                <CheckCircle2 size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>
                {activeTasksCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 500 }}>
                Active Tasks
              </div>
            </div>

            {/* Stat 3: Pending Replies */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--line-soft)', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#F59E0B', marginBottom: 6 }}>
                <Clock size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>
                {pendingRepliesCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, fontWeight: 500 }}>
                Pending Replies
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Recent Activity (Latest 3) ── */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: 0 }}>
              Recent Activity
            </h2>
          </div>

          <div style={{
            background: 'var(--card)', border: '1px solid var(--line-soft)', borderRadius: 20,
            padding: '4px 0', overflow: 'hidden'
          }}>
            {latestActivity.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                No recent task activity. Tell MiniMe to assign a task on Telegram!
              </div>
            ) : (
              latestActivity.map((act, i) => {
                const isDone = act.status === 'completed';
                const isBlocked = act.status === 'blocked';
                const icon = isDone ? '✓' : isBlocked ? '⛔' : '⏳';
                const iconColor = isDone ? 'var(--mint)' : isBlocked ? 'var(--error)' : '#F59E0B';
                const isLast = i === latestActivity.length - 1;

                return (
                  <div
                    key={act.id || i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      borderBottom: isLast ? 'none' : '1px solid var(--line-soft)'
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: 'rgba(16, 185, 129, 0.12)', color: iconColor,
                      fontSize: 12, fontWeight: 800, display: 'grid', placeItems: 'center',
                      flexShrink: 0
                    }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                        {act.title || act.note || 'Task update'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                        {act.supplier_name ? `${act.supplier_name} · ` : ''}
                        {act.due_at ? `Due ${new Date(act.due_at).toLocaleDateString()}` : 'In progress'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── Section 4: Telegram Connection (No "Secretary Mode" phrasing) ── */}
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: '0 0 12px' }}>
            Telegram Connection
          </h2>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--line-soft)', borderRadius: 20,
            padding: 16, display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14,
              background: isTgConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              color: isTgConnected ? 'var(--mint)' : '#F59E0B',
              display: 'grid', placeItems: 'center', flexShrink: 0
            }}>
              {isTgConnected ? <ShieldCheck size={22} /> : <AlertCircle size={22} />}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                {isTgConnected ? 'Telegram Connected' : 'Telegram Not Connected'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>
                {isTgConnected
                  ? 'MiniMe sends & receives task updates via your Telegram account.'
                  : 'Connect Telegram so MiniMe can message teammates directly.'}
              </div>
            </div>

            {!isTgConnected && (
              <Link
                href="/settings/modes"
                style={{
                  textDecoration: 'none', background: 'var(--mint)', color: '#FFFFFF',
                  borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  flexShrink: 0, boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)'
                }}
              >
                Connect Telegram
              </Link>
            )}
          </div>
        </section>

        {/* ── Section 5: Progressive Disclosure Help Link ── */}
        <section style={{ textAlign: 'center', paddingTop: 8 }}>
          <button
            onClick={() => setHowOpen(true)}
            style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999, transition: 'color 0.15s ease'
            }}
          >
            <HelpCircle size={15} /> How Team Delegation Works
          </button>
        </section>
      </main>

      {/* ── Add Teammate Modal / Sheet ── */}
      {editing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div className="fade-up" style={{
            background: 'var(--card)', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '24px 20px 36px', width: '100%', maxWidth: 600,
            boxShadow: '0 -8px 30px rgba(0,0,0,0.3)', boxSizing: 'border-box',
            borderTop: '1px solid var(--line-soft)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                {isEditing ? 'Edit Teammate' : 'Add Teammate'}
              </h3>
              <button
                onClick={() => setEditing(null)}
                style={{ background: 'var(--cream-2)', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={saveTeammate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Full Name *
                </label>
                <input
                  type="text" required placeholder="e.g. Yonas Gebre"
                  value={formName} onChange={e => setFormName(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                    background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Role *
                </label>
                <select
                  value={formRole} onChange={e => setFormRole(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                    background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                  }}
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {formRole === 'other' && (
                  <input
                    type="text" placeholder="What do they do? e.g. Tailor, Bookkeeper"
                    value={formSpecialty} onChange={e => setFormSpecialty(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 12, marginTop: 8,
                      border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                      background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                    }}
                  />
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Phone Number
                </label>
                <input
                  type="tel" placeholder="e.g. +251 91 123 4567"
                  value={formPhone} onChange={e => setFormPhone(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                    background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Telegram Username (optional)
                </label>
                <input
                  type="text" placeholder="e.g. @yonas_g — or leave blank"
                  value={formTgUser} onChange={e => setFormTgUser(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                    background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                  }}
                />
                {!isEditing && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.4 }}>
                    Don't know it? Leave this blank — you'll get a one-tap invite link to send them instead.
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Active Hours (optional)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="time"
                    value={formActiveStart} onChange={e => setFormActiveStart(e.target.value)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 12,
                      border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                      background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                    }}
                  />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>to</span>
                  <input
                    type="time"
                    value={formActiveEnd} onChange={e => setFormActiveEnd(e.target.value)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 12,
                      border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                      background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.4 }}>
                  Leave blank if MiniMe can reach them any time. Outside these hours, it waits instead of chasing them.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
                  Max Tasks Per Day (optional)
                </label>
                <input
                  type="number" min="1" placeholder="No limit"
                  value={formMaxTasks} onChange={e => setFormMaxTasks(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid var(--line)', fontSize: 14, outline: 'none',
                    background: 'var(--paper)', color: 'var(--ink)', boxSizing: 'border-box'
                  }}
                />
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.4 }}>
                  Once they're at this many open tasks, MiniMe assigns new ones elsewhere.
                </div>
              </div>

              <button
                type="submit" disabled={busy}
                style={{
                  marginTop: 10, width: '100%', padding: '12px',
                  background: 'var(--mint)', color: '#FFFFFF', border: 'none',
                  borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                }}
              >
                {busy ? 'Saving...' : (isEditing ? 'Save Changes' : 'Save Teammate')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Invite Share Sheet — shown right after adding a teammate MiniMe can't yet DM directly ── */}
      {inviteShare && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div className="fade-up" style={{
            background: 'var(--card)', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '24px 20px 36px', width: '100%', maxWidth: 600,
            boxShadow: '0 -8px 30px rgba(0,0,0,0.3)', boxSizing: 'border-box',
            borderTop: '1px solid var(--line-soft)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                Invite {inviteShare.name || 'them'}
              </h3>
              <button
                onClick={() => setInviteShare(null)}
                style={{ background: 'var(--cream-2)', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5, margin: '0 0 16px' }}>
              Send them this link however you normally reach them (WhatsApp, SMS, in person). The moment they tap it, MiniMe can message them directly — no username needed.
            </p>

            <div style={{
              background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 12,
              padding: '10px 14px', fontSize: 12.5, color: 'var(--ink-soft)',
              wordBreak: 'break-all', marginBottom: 16,
            }}>
              {inviteShare.url}
            </div>

            <button
              onClick={() => shareInvite(inviteShare.url, inviteShare.name)}
              style={{
                width: '100%', padding: '12px',
                background: 'var(--mint)', color: '#FFFFFF', border: 'none',
                borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Send size={15} /> Share invite link
            </button>
            <button
              onClick={() => setInviteShare(null)}
              style={{
                marginTop: 10, width: '100%', padding: '12px',
                background: 'none', color: 'var(--muted)', border: 'none',
                fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
              }}
            >
              I'll do it later
            </button>
          </div>
        </div>
      )}

      {/* ── Progressive Disclosure Bottom Sheet ── */}
      {howOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div className="fade-up" style={{
            background: 'var(--card)', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '24px 20px 36px', width: '100%', maxWidth: 600,
            boxShadow: '0 -8px 30px rgba(0,0,0,0.3)', boxSizing: 'border-box',
            borderTop: '1px solid var(--line-soft)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                How Team Delegation Works
              </h3>
              <button
                onClick={() => setHowOpen(false)}
                style={{ background: 'var(--cream-2)', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>1️⃣</span>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>Add your teammate</strong>
                  <br />Tap "Add", enter their name and role — a Telegram username is optional. You'll get a one-tap invite link to send them however you like (WhatsApp, SMS, in person). The moment they tap it, MiniMe can message them — no typing their exact @username required.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>2️⃣</span>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>Tell MiniMe what to assign</strong>
                  <br />Text or voice message MiniMe on Telegram: <em>"Get Yonas to print 50 flyers by 5pm"</em>. Or drop the same request in your team group, addressed to MiniMe.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>3️⃣</span>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>MiniMe briefs your teammate</strong>
                  <br />MiniMe texts your teammate directly on Telegram in natural language with all job details.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>4️⃣</span>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>Automated progress & proof of work</strong>
                  <br />Teammates reply with photos or text updates. MiniMe checks progress and updates you when done — and updates the client too, if the task came from an order.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>👥</span>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>Add MiniMe to your team's Telegram group</strong>
                  <br />Add the bot to a group like any member. It'll post task updates there automatically, and if you or a teammate @mention it (or reply to one of its messages), it'll answer right in the group — delegate a task, give a status update, or ask a question. It only speaks up when addressed.
                </div>
              </div>
            </div>

            <button
              onClick={() => setHowOpen(false)}
              style={{
                marginTop: 24, width: '100%', padding: '12px',
                background: 'var(--mint)', color: '#FFFFFF', border: 'none',
                borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
