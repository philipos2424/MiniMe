'use client';
/**
 * DocumentsPage — redesigned with design tokens.
 */
import { useEffect, useState, useRef } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { FileText, Trash2, Upload, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';

const TAGS = ['price-list', 'menu', 'brochure', 'terms', 'faq', 'catalog', 'other'];

const INPUT_BASE = {
  background: COLORS.bg,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADII.md,
  padding: '10px 12px',
  minHeight: 44,
  fontSize: 14,
  color: COLORS.textPrimary,
  fontFamily: FONT.body,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function initData() {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData || '';
}

export default function DocumentsPage() {
  const { business } = useTelegram();
  const { toast } = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ title: '', tag: 'price-list', description: '' });
  const fileRef = useRef(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/documents', { headers: { 'x-telegram-init-data': initData() } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setDocs(data.documents || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (business?.id) refresh();
  }, [business?.id]);

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Pick a file first'); return; }
    if (file.size > 10 * 1024 * 1024) { setErr('File is larger than 10 MB'); return; }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'document');
      fd.append('title', String(form.title || file.name || 'document'));
      fd.append('tag', String(form.tag || 'other'));
      fd.append('description', String(form.description || ''));
      const id = initData();
      if (!id) throw new Error('Not inside Telegram — re-open from the bot menu');
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'x-telegram-init-data': id },
        body: fd,
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setForm({ title: '', tag: 'price-list', description: '' });
      if (fileRef.current) fileRef.current.value = '';
      toast('Document uploaded — MiniMe is learning it now.', { variant: 'success' });
      await refresh();
    } catch (e) {
      console.error('upload error', e);
      setErr(e.message || String(e));
      toast(e.message || 'Upload failed', { variant: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this document?')) return;
    const res = await fetch(`/api/documents?id=${id}`, {
      method: 'DELETE',
      headers: { 'x-telegram-init-data': initData() },
    });
    if (res.ok) {
      toast('Document deleted.', { variant: 'success' });
      await refresh();
    } else {
      toast('Failed to delete document.', { variant: 'error' });
    }
  }

  return (
    <div style={{ fontFamily: FONT.body, color: COLORS.textPrimary }}>
      <PageHeader
        title="Knowledge Base"
        subtitleAm="እውቀት"
        subtitleEn="Documents MiniMe reads to answer your customers"
      />

      {/* Upload form */}
      <form
        onSubmit={handleUpload}
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.lg,
          padding: 16,
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: SHADOW.card,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <input
            placeholder="Title (e.g. Summer Menu)"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            style={INPUT_BASE}
          />
          <select
            value={form.tag}
            onChange={e => setForm(p => ({ ...p, tag: e.target.value }))}
            style={INPUT_BASE}
          >
            {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input
          placeholder="Description — what's in this file? (helps retrieval)"
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          style={INPUT_BASE}
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,text/plain,text/markdown"
          style={{ fontSize: 13, color: COLORS.textSecondary, fontFamily: FONT.body }}
        />
        <p style={{ fontSize: 11, color: COLORS.textHint, margin: 0 }}>
          Accepts PDF, .txt, .md — max 10 MB.
        </p>
        <button
          type="submit"
          disabled={uploading}
          style={{
            background: uploading ? COLORS.textHint : COLORS.teal,
            color: '#FFFFFF',
            fontWeight: 600,
            padding: '10px 0',
            minHeight: 44,
            borderRadius: RADII.md,
            border: 'none',
            fontSize: 14,
            cursor: uploading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: FONT.body,
            transition: 'background 0.15s',
          }}
        >
          {uploading
            ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
            : <><Upload size={16} /> Upload & Embed</>}
        </button>
        {err && (
          <p style={{ fontSize: 13, color: COLORS.red, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <AlertCircle size={14} /> {err}
          </p>
        )}
      </form>

      {/* Document list */}
      {loading ? (
        <SkeletonList rows={3} />
      ) : !docs.length ? (
        <EmptyState
          icon={FileText}
          title="ምንም ሰነድ የለም / No documents yet"
          description="Upload PDFs, txt, or markdown to teach your AI."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(d => {
            const statusIcon =
              d.status === 'ready'  ? <CheckCircle2 size={16} color={COLORS.green} /> :
              d.status === 'failed' ? <AlertCircle  size={16} color={COLORS.red} /> :
              <Loader2 size={16} className="animate-spin" color={COLORS.teal} />;

            return (
              <div
                key={d.id}
                style={{
                  background: COLORS.surface,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: RADII.lg,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: SHADOW.card,
                }}
              >
                <FileText size={20} color={COLORS.teal} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.textHint, marginTop: 4, flexWrap: 'wrap' }}>
                    {d.tag && (
                      <span style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 4, padding: '1px 6px' }}>
                        {d.tag}
                      </span>
                    )}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{statusIcon} {d.status}</span>
                    {d.page_count && <span>· {d.page_count}p</span>}
                    {d.byte_size  && <span>· {Math.round(d.byte_size / 1024)}KB</span>}
                  </div>
                  {d.error && (
                    <p style={{ fontSize: 12, color: COLORS.red, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.error}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(d.id)}
                  title="Delete"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: COLORS.textHint, padding: 8,
                    minWidth: 44, minHeight: 44,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: RADII.sm, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = COLORS.red}
                  onMouseLeave={e => e.currentTarget.style.color = COLORS.textHint}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
