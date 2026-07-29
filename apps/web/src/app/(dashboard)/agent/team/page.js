'use client';
/**
 * Team control center — redesign for managing teammates, viewing work status,
 * and configuring AI delegation with ultra-clean iOS / Linear / Notion aesthetics.
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Users, CheckCircle2, Clock, ChevronRight, X,
  Send, Trash2, HelpCircle, ShieldCheck, AlertCircle, RefreshCw
} from 'lucide-react';
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
  const { initData, business } = useTelegram() || {};
  const [team, setTeam] = useState(null);
  const [delegatedTasks, setDelegatedTasks] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | supplier object
  const [howOpen, setHowOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('designer');
  const [formPhone, setFormPhone] = useState('');
  const [formTgUser, setFormTgUser] = useState('');
  const [formTgId, setFormTgId] = useState('');

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
    setFormPhone('');
    setFormTgUser('');
    setFormTgId('');
    setEditing('new');
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
        phone: formPhone.trim() || undefined,
        telegramUsername: formTgUser.trim() || undefined,
        telegramId: formTgId.trim() || undefined,
      };

      const res = await fetch('/api/agent/team', {
        method: 'POST',
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
      }
    } catch (err) {
      await tgAlert(`Failed to save: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id, name) {
    if (!(await tgConfirm(`Remove ${name} from your team?`))) return;
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
      background: '#FFFFFF',
      minHeight: '100vh',
      paddingBottom: 110,
      fontFamily: FONT.body,
      color: '#111827',
      maxWidth: 600,
      margin: '0 auto',
    }}>
      {/* ── Top Navigation Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #F3F4F6',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: '#374151', display: 'grid', placeItems: 'center'
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: '#111827' }}>
              Team
            </h1>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>
              Manage your teammates
            </p>
          </div>
        </div>

        <button
          onClick={openAddModal}
          style={{
            appearance: 'none',
            border: 'none',
            background: '#10B981',
            color: '#FFFFFF',
            borderRadius: 999,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
            transition: 'transform 0.15s ease, background 0.15s ease',
          }}
        >
          <Plus size={15} /> Add
        </button>
      </header>

      <main style={{ padding: '20px 20px 0' }}>
        {/* ── Section 1: Team Members Roster ── */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', margin: 0 }}>
              Team Members
            </h2>
            {team && team.length > 0 && (
              <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>
                {team.length} member{team.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {!team ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              Loading teammates...
            </div>
          ) : team.length === 0 ? (
            /* Clean Empty State */
            <div style={{
              background: '#F9FAFB',
              border: '1px solid #E5E7EB',
              borderRadius: 20,
              padding: '36px 24px',
              textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', background: '#ECFDF5',
                display: 'grid', placeItems: 'center', color: '#10B981', fontSize: 26, marginBottom: 14
              }}>
                👥
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>
                No teammates yet
              </h3>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px', maxWidth: 280, lineHeight: 1.45 }}>
                MiniMe can only delegate work after teammates are added.
              </p>
              <button
                onClick={openAddModal}
                style={{
                  appearance: 'none', border: 'none',
                  background: '#10B981', color: '#FFFFFF',
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
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 20,
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {team.map((m, idx) => {
                const initials = (m.name || 'TM').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const isLast = idx === team.length - 1;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 16px',
                      borderBottom: isLast ? 'none' : '1px solid #F3F4F6',
                    }}
                  >
                    {/* Avatar with Status Ring */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
                        color: '#047857', fontWeight: 700, fontSize: 15,
                        display: 'grid', placeItems: 'center',
                        border: '1px solid #A7F3D0',
                      }}>
                        {initials}
                      </div>
                      <span style={{
                        position: 'absolute', bottom: 1, right: 1,
                        width: 10, height: 10, borderRadius: '50%',
                        background: m.open_tasks > 0 ? '#F59E0B' : '#10B981',
                        border: '2px solid #FFFFFF',
                      }} />
                    </div>

                    {/* Name & Role */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600, color: '#111827' }}>
                          {m.name}
                        </span>
                        <span style={{
                          background: '#F3F4F6', color: '#4B5563',
                          borderRadius: 999, padding: '2px 8px',
                          fontSize: 11, fontWeight: 500, textTransform: 'capitalize',
                        }}>
                          {m.role || 'team'}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {m.open_tasks > 0 ? `${m.open_tasks} active task${m.open_tasks === 1 ? '' : 's'}` : 'Available'}
                        {m.contact_phone ? ` · ${m.contact_phone}` : ''}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => testPing(m.id, m.name)}
                        title="Send test DM on Telegram"
                        style={{
                          background: '#F3F4F6', border: 'none', borderRadius: 8,
                          width: 32, height: 32, cursor: 'pointer',
                          display: 'grid', placeItems: 'center', color: '#4B5563',
                        }}
                      >
                        <Send size={14} />
                      </button>
                      <button
                        onClick={() => removeMember(m.id, m.name)}
                        title="Remove member"
                        style={{
                          background: '#FEE2E2', border: 'none', borderRadius: 8,
                          width: 32, height: 32, cursor: 'pointer',
                          display: 'grid', placeItems: 'center', color: '#EF4444',
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
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', margin: '0 0 12px' }}>
            Overview
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {/* Stat 1: Members */}
            <div style={{
              background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#10B981', marginBottom: 6 }}>
                <Users size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', lineHeight: 1 }}>
                {team ? team.length : '0'}
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, fontWeight: 500 }}>
                Members
              </div>
            </div>

            {/* Stat 2: Active Tasks */}
            <div style={{
              background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#3B82F6', marginBottom: 6 }}>
                <CheckCircle2 size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', lineHeight: 1 }}>
                {activeTasksCount}
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, fontWeight: 500 }}>
                Active Tasks
              </div>
            </div>

            {/* Stat 3: Pending Replies */}
            <div style={{
              background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 16,
              padding: '14px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#F59E0B', marginBottom: 6 }}>
                <Clock size={18} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', lineHeight: 1 }}>
                {pendingRepliesCount}
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, fontWeight: 500 }}>
                Pending Replies
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Recent Activity (Latest 3) ── */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', margin: 0 }}>
              Recent Activity
            </h2>
            {recentEvents.length > 0 && (
              <button
                onClick={() => setHistoryOpen(true)}
                style={{
                  background: 'none', border: 'none', color: '#10B981',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0
                }}
              >
                View History →
              </button>
            )}
          </div>

          <div style={{
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 20,
            padding: '4px 0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            {latestActivity.length === 0 ? (
              <div style={{ padding: 18, textAlign: 'center', color: '#9CA3AF', fontSize: 12.5 }}>
                No recent task activity. Tell MiniMe to assign a task on Telegram!
              </div>
            ) : (
              latestActivity.map((act, i) => {
                const isDone = act.status === 'completed';
                const isBlocked = act.status === 'blocked';
                const icon = isDone ? '✓' : isBlocked ? '⛔' : '⏳';
                const iconColor = isDone ? '#10B981' : isBlocked ? '#EF4444' : '#F59E0B';
                const isLast = i === latestActivity.length - 1;

                return (
                  <div
                    key={act.id || i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      borderBottom: isLast ? 'none' : '1px solid #F3F4F6'
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: `${iconColor}15`, color: iconColor,
                      fontSize: 12, fontWeight: 800, display: 'grid', placeItems: 'center',
                      flexShrink: 0
                    }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
                        {act.title || act.note || 'Task update'}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#6B7280', marginTop: 1 }}>
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
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6B7280', margin: '0 0 12px' }}>
            Telegram Connection
          </h2>
          <div style={{
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 20,
            padding: 16, display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14,
              background: isTgConnected ? '#ECFDF5' : '#FEF3C7',
              color: isTgConnected ? '#10B981' : '#F59E0B',
              display: 'grid', placeItems: 'center', flexShrink: 0
            }}>
              {isTgConnected ? <ShieldCheck size={22} /> : <AlertCircle size={22} />}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                {isTgConnected ? 'Telegram Connected' : 'Telegram Not Connected'}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 1.4 }}>
                {isTgConnected
                  ? 'MiniMe sends & receives task updates via your Telegram account.'
                  : 'Connect Telegram so MiniMe can message teammates directly.'}
              </div>
            </div>

            {!isTgConnected && (
              <Link
                href="/settings/modes"
                style={{
                  textDecoration: 'none', background: '#10B981', color: '#FFFFFF',
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
              background: 'none', border: 'none', color: '#6B7280',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999, transition: 'color 0.15s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#10B981'}
            onMouseLeave={e => e.currentTarget.style.color = '#6B7280'}
          >
            <HelpCircle size={15} /> How Team Delegation Works
          </button>
        </section>
      </main>

      {/* ── Add Teammate Modal / Sheet ── */}
      {editing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div className="fade-up" style={{
            background: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '24px 20px 36px', width: '100%', maxWidth: 600,
            boxShadow: '0 -8px 30px rgba(0,0,0,0.15)', boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#111827' }}>
                Add Teammate
              </h3>
              <button
                onClick={() => setEditing(null)}
                style={{ background: '#F3F4F6', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: '#6B7280', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={saveTeammate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Full Name *
                </label>
                <input
                  type="text" required placeholder="e.g. Yonas Gebre"
                  value={formName} onChange={e => setFormName(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid #D1D5DB', fontSize: 14, outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Role *
                </label>
                <select
                  value={formRole} onChange={e => setFormRole(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid #D1D5DB', fontSize: 14, outline: 'none',
                    background: '#FFFFFF', boxSizing: 'border-box'
                  }}
                >
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Phone Number
                </label>
                <input
                  type="tel" placeholder="e.g. +251 91 123 4567"
                  value={formPhone} onChange={e => setFormPhone(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid #D1D5DB', fontSize: 14, outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Telegram Username or ID
                </label>
                <input
                  type="text" placeholder="e.g. @yonas_g or Telegram User ID"
                  value={formTgUser} onChange={e => setFormTgUser(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 12,
                    border: '1px solid #D1D5DB', fontSize: 14, outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit" disabled={busy}
                style={{
                  marginTop: 10, width: '100%', padding: '12px',
                  background: '#10B981', color: '#FFFFFF', border: 'none',
                  borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                }}
              >
                {busy ? 'Saving...' : 'Save Teammate'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Progressive Disclosure Bottom Sheet ── */}
      {howOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
          <div className="fade-up" style={{
            background: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '24px 20px 36px', width: '100%', maxWidth: 600,
            boxShadow: '0 -8px 30px rgba(0,0,0,0.15)', boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#111827' }}>
                How Team Delegation Works
              </h3>
              <button
                onClick={() => setHowOpen(false)}
                style={{ background: '#F3F4F6', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: '#6B7280', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13.5, color: '#4B5563', lineHeight: 1.5 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>1️⃣</span>
                <div>
                  <strong style={{ color: '#111827' }}>Tell MiniMe what to assign</strong>
                  <br />Text or voice message MiniMe on Telegram: <em>"Get Yonas to print 50 flyers by 5pm"</em>.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>2️⃣</span>
                <div>
                  <strong style={{ color: '#111827' }}>MiniMe briefs your teammate</strong>
                  <br />MiniMe texts your teammate directly on Telegram in natural language with all job details.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 18 }}>3️⃣</span>
                <div>
                  <strong style={{ color: '#111827' }}>Automated progress & proof of work</strong>
                  <br />Teammates reply with photos or text updates. MiniMe checks progress and updates you when done.
                </div>
              </div>
            </div>

            <button
              onClick={() => setHowOpen(false)}
              style={{
                marginTop: 24, width: '100%', padding: '12px',
                background: '#10B981', color: '#FFFFFF', border: 'none',
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
