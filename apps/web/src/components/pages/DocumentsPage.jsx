'use client';
import { useEffect, useState, useRef } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { FileText, Trash2, Upload, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import PageHeader from '../ui/PageHeader';
import EmptyState from '../ui/EmptyState';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';

const TAGS = ['price-list', 'menu', 'brochure', 'terms', 'faq', 'catalog', 'other'];

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
    if (!file) {
      setErr('Pick a file first');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErr('File is larger than 10 MB');
      return;
    }
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
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Knowledge Base"
        subtitleAm="እውቀት"
        subtitleEn="Documents MiniMe reads to answer your customers"
      />

      <form onSubmit={handleUpload} className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Title (e.g. Summer Menu)"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
          />
          <select
            value={form.tag}
            onChange={e => setForm(p => ({ ...p, tag: e.target.value }))}
            className="bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body focus:outline-none focus:border-gold"
          >
            {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <input
          placeholder="Description — what's in this file? (helps retrieval)"
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2.5 min-h-[44px] text-body placeholder-muted focus:outline-none focus:border-gold"
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,text/plain,text/markdown"
          className="w-full text-sm text-muted file:bg-gold file:text-bg file:border-0 file:rounded-lg file:px-4 file:py-2 file:mr-3 file:font-semibold hover:file:bg-gold-light"
        />
        <p className="text-xs text-muted">Accepts PDF, .txt, .md — max 10 MB.</p>
        <button
          type="submit"
          disabled={uploading}
          className="w-full bg-gold text-bg font-semibold py-2.5 min-h-[44px] rounded-lg hover:bg-gold-light transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {uploading ? <><Loader2 size={16} className="animate-spin" /> Processing…</> : <><Upload size={16} /> Upload & Embed</>}
        </button>
        {err && (
          <p className="text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {err}
          </p>
        )}
      </form>

      {loading ? (
        <SkeletonList rows={3} />
      ) : !docs.length ? (
        <EmptyState
          icon={FileText}
          title="ምንም ሰነድ የለም / No documents yet"
          description="Upload PDFs, txt, or markdown to teach your AI."
        />
      ) : (
        <div className="space-y-2">
          {docs.map(d => {
            const statusIcon =
              d.status === 'ready' ? <CheckCircle2 size={16} className="text-emerald-400" /> :
              d.status === 'failed' ? <AlertCircle size={16} className="text-red-400" /> :
              <Loader2 size={16} className="animate-spin text-gold" />;
            return (
              <div
                key={d.id}
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-gold/40 transition"
              >
                <FileText size={20} className="text-gold shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-gold-light font-medium truncate">{d.title}</p>
                  <div className="flex items-center gap-2 text-xs text-muted mt-0.5 flex-wrap">
                    {d.tag && <span className="bg-bg border border-border rounded px-1.5 py-0.5">{d.tag}</span>}
                    <span className="flex items-center gap-1">{statusIcon} {d.status}</span>
                    {d.page_count && <span>· {d.page_count}p</span>}
                    {d.byte_size && <span>· {Math.round(d.byte_size / 1024)}KB</span>}
                  </div>
                  {d.error && <p className="text-red-400 text-xs mt-1 truncate">{d.error}</p>}
                </div>
                <button
                  onClick={() => handleDelete(d.id)}
                  className="text-muted hover:text-red-400 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Delete"
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
