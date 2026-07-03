'use client';
import { useState } from 'react';
import { useTelegram } from '../../../../context/TelegramContext';
import { Megaphone, CheckCircle2, RefreshCw, Forward, DownloadCloud } from 'lucide-react';
import { COLORS, FONT, RADII } from '../../../../lib/design-tokens';

const SHARED_BOT = 'MiniMeAgentBot';

export default function ChannelMonitorPage() {
  const { business, setBusiness, initData } = useTelegram();
  const [refreshing, setRefreshing] = useState(false);
  const [importHandle, setImportHandle] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Which bot the owner must add as a channel admin: their own connected bot,
  // or the shared MiniMe bot if they're in shared mode.
  const botHandle = business?.telegram_bot_username || SHARED_BOT;
  const linked = !!business?.source_channel_id;
  const channelName = business?.source_channel_title || business?.source_channel_username || 'your channel';

  async function refresh() {
    if (!initData || refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      const data = await res.json();
      if (res.ok && data.business) setBusiness(data.business);
    } catch { /* ignore — button just no-ops */ }
    finally { setRefreshing(false); }
  }

  // Prefill the import box with the linked channel handle when we have one.
  const linkedHandle = business?.source_channel_username || '';
  const importValue = importHandle || linkedHandle;

  async function runImport() {
    const handle = (importValue || '').trim().replace(/^@/, '');
    if (!initData || importing || !handle) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/settings/channel/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ username: handle }),
      });
      const j = await res.json();
      setImportResult(j);
    } catch {
      setImportResult({ ok: false, reason: 'fetch_failed' });
    } finally { setImporting(false); }
  }

  const steps = [
    'Open your product channel in Telegram.',
    'Tap the channel name → Administrators → Add Admin.',
    `Search @${botHandle} and add it (default admin rights are fine).`,
    'Post a product — MiniMe reads it and confirms in your chat.',
  ];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 20, fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Megaphone size={22} color={COLORS.mint} />
        <h1 style={{ fontFamily: FONT.display || FONT.body, fontSize: 24, fontWeight: 600, margin: 0 }}>Product Channel</h1>
      </div>
      <p style={{ color: COLORS.textSecondary, fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        Add MiniMe as an admin of your Telegram channel. Every time you post a product, it reads the
        post, saves it to your catalog, and confirms — no re-typing.
      </p>

      {/* Status */}
      <div style={{
        background: linked ? 'rgba(79,163,138,0.08)' : COLORS.bg,
        border: `1px solid ${linked ? 'rgba(79,163,138,0.35)' : COLORS.border}`,
        borderRadius: RADII.md, padding: 16, marginTop: 12,
      }}>
        {linked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={20} color={COLORS.mint} />
            <div>
              <div style={{ fontWeight: 600 }}>Watching <span style={{ color: COLORS.mint }}>{channelName}</span></div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary }}>New product posts are added automatically.</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14, color: COLORS.textSecondary }}>
            Not connected yet. Follow the steps below, then tap Refresh.
          </div>
        )}
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: RADII.sm,
            padding: '8px 12px', fontSize: 13, fontFamily: FONT.body, color: COLORS.textPrimary,
            cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}>
          <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
          {refreshing ? 'Checking…' : 'Refresh status'}
        </button>
      </div>

      {/* Steps */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLORS.mint, marginBottom: 10 }}>
          How to connect
        </div>
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                background: 'rgba(79,163,138,0.12)', color: COLORS.mint,
                display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
              }}>{i + 1}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, paddingTop: 2 }}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Back-catalog import — pull existing posts from the public channel preview */}
      <div style={{
        marginTop: 20, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.md, padding: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 4 }}>
          <DownloadCloud size={16} color={COLORS.mint} /> Import your existing posts
        </div>
        <div style={{ fontSize: 13.5, color: COLORS.textSecondary, lineHeight: 1.5, marginBottom: 10 }}>
          Already have products in your channel? Pull your recent posts into the catalog now — no
          re-posting. Works for public channels.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', flex: 1, background: '#fff',
            border: `1px solid ${COLORS.border}`, borderRadius: RADII.sm, padding: '0 10px',
          }}>
            <span style={{ color: COLORS.textSecondary, fontSize: 14 }}>@</span>
            <input
              value={importValue}
              onChange={e => setImportHandle(e.target.value.replace(/^@/, ''))}
              placeholder="your_channel"
              style={{
                flex: 1, border: 0, outline: 'none', background: 'transparent',
                padding: '9px 6px', fontSize: 14, color: COLORS.textPrimary, fontFamily: FONT.body,
              }}
            />
          </div>
          <button
            onClick={runImport}
            disabled={importing || !importValue.trim()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: COLORS.mint, color: '#fff', border: 0, borderRadius: RADII.sm,
              padding: '10px 14px', fontSize: 13, fontWeight: 600, fontFamily: FONT.body,
              cursor: importing || !importValue.trim() ? 'default' : 'pointer',
              opacity: importing || !importValue.trim() ? 0.6 : 1, whiteSpace: 'nowrap',
            }}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
        {importResult && (
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5,
            color: importResult.ok && (importResult.added || importResult.updated) ? '#1E6B58' : COLORS.textSecondary }}>
            {importResult.ok
              ? (importResult.added || importResult.updated)
                ? `✓ Imported ${importResult.added} new${importResult.updated ? ` and updated ${importResult.updated}` : ''} product${(importResult.added + importResult.updated) === 1 ? '' : 's'} from your last ${importResult.scanned} posts.${importResult.names?.length ? ` (${importResult.names.slice(0, 4).join(', ')}${importResult.names.length > 4 ? '…' : ''})` : ''}`
                : `Scanned your last ${importResult.scanned} posts but found nothing priced to add. Posts need a product name + price in the caption. You can also forward posts below.`
              : importResult.reason === 'private_or_empty'
                ? 'That channel has no public preview (it may be private). Forward posts to the bot instead — see below.'
                : importResult.reason === 'no_channel'
                ? 'Enter your channel @username first.'
                : 'Could not read that channel. Check the @username and try again.'}
          </div>
        )}
      </div>

      {/* Forwarding fallback */}
      <div style={{
        marginTop: 20, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.md, padding: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 4 }}>
          <Forward size={16} color={COLORS.mint} /> Or just forward posts
        </div>
        <div style={{ fontSize: 13.5, color: COLORS.textSecondary, lineHeight: 1.5 }}>
          Don’t want to add an admin? Forward any product post from your channel to @{botHandle} and
          MiniMe will turn it into a catalog product — great for older posts too.
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
