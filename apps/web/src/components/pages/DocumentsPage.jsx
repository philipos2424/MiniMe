'use client';
/**
 * DocumentsPage — drag-and-drop file upload for owner.
 *
 * Supported file types:
 *   PDF, Word (.docx/.doc), plain text, CSV — embedded + searchable
 *   Images (JPG, PNG, WebP, GIF) — Vision-described + sendable to customers
 *   Videos (MP4, MOV) — stored + sendable to customers
 *
 * MiniMe automatically sends the right file when a customer asks for it.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useTelegram } from '../../context/TelegramContext';
import { useToast } from '../ui/Toast';
import { COLORS, FONT, RADII, SHADOW } from '../../lib/design-tokens';
import { Trash2, CheckCircle2, Loader2, AlertCircle, FileText, Image, Video, Upload, Eye } from 'lucide-react';
import { tgConfirm } from '../../lib/utils';

const FILE_TYPES = {
  'application/pdf': { icon: '📄', label: 'PDF', color: '#E74C3C' },
  'text/plain': { icon: '📝', label: 'Text', color: '#3498DB' },
  'text/markdown': { icon: '📝', label: 'Markdown', color: '#3498DB' },
  'text/csv': { icon: '📊', label: 'CSV', color: '#27AE60' },
  'application/msword': { icon: '📃', label: 'Word', color: '#2980B9' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: '📃', label: 'Word', color: '#2980B9' },
  'image/jpeg': { icon: '🖼️', label: 'Image', color: '#8E44AD' },
  'image/png': { icon: '🖼️', label: 'Image', color: '#8E44AD' },
  'image/webp': { icon: '🖼️', label: 'Image', color: '#8E44AD' },
  'image/gif': { icon: '🎞️', label: 'GIF', color: '#8E44AD' },
  'video/mp4': { icon: '🎬', label: 'Video', color: '#E67E22' },
  'video/quicktime': { icon: '🎬', label: 'Video', color: '#E67E22' },
};

function getFileInfo(mime) {
  return FILE_TYPES[mime] || { icon: '📁', label: 'File', color: COLORS.textHint };
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const TAG_LABELS = {
  'price-list':  '💰 Price list',
  'menu':        '🍽️ Menu',
  'portfolio':   '🎨 Portfolio',
  'brochure':    '📰 Brochure',
  'product-photo': '📸 Product photo',
  'catalog':     '📋 Catalog',
  'terms':       '📜 Terms',
  'faq':         '❓ FAQ',
  'other':       '📁 Other',
};

const QUICK_TAGS = ['menu', 'price-list', 'portfolio', 'product-photo', 'brochure', 'catalog', 'other'];

function initData() {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData || '';
}

function DocCard({ doc, onDelete }) {
  const fi = getFileInfo(doc.mime_type);
  const isImage = doc.mime_type?.startsWith('image/');
  const fileUrl = doc.meta?.file_url;
  const [deleting, setDeleting] = useState(false);

  return (
    <div style={{
      background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: RADII.lg,
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* Thumbnail or icon */}
      {isImage && fileUrl ? (
        <img src={fileUrl} alt={doc.title} style={{
          width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0,
        }} />
      ) : (
        <div style={{
          width: 48, height: 48, borderRadius: 8, flexShrink: 0,
          background: fi.color + '15', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 22,
        }}>
          {fi.icon}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.title || doc.original_filename || 'Untitled'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          {doc.tag && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
              background: COLORS.teal + '18', color: COLORS.teal, letterSpacing: '0.04em',
            }}>
              {TAG_LABELS[doc.tag] || doc.tag}
            </span>
          )}
          <span style={{ fontSize: 11, color: COLORS.textHint }}>{fi.label}</span>
          {doc.byte_size && <span style={{ fontSize: 11, color: COLORS.textHint }}>{fmtSize(doc.byte_size)}</span>}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
            background: doc.status === 'ready' ? COLORS.green + '15' : doc.status === 'failed' ? COLORS.red + '15' : COLORS.amber + '15',
            color: doc.status === 'ready' ? COLORS.green : doc.status === 'failed' ? COLORS.red : COLORS.amber,
          }}>
            {doc.status === 'ready' ? '✅ Ready' : doc.status === 'failed' ? '❌ Failed' : '⏳ Processing'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'flex', alignItems: 'center', padding: '6px', borderRadius: 8,
            background: COLORS.bg, color: COLORS.textHint, textDecoration: 'none',
          }} title="Preview">
            <Eye size={15} />
          </a>
        )}
        <button onClick={async () => {
          if (!(await tgConfirm('Delete this file? MiniMe will no longer be able to send it.'))) return;
          setDeleting(true);
          await fetch(`/api/documents/${doc.id}`, {
            method: 'DELETE', headers: { 'x-telegram-init-data': initData() }
          }).catch(() => {});
          onDelete(doc.id);
        }} disabled={deleting} style={{
          display: 'flex', alignItems: 'center', padding: '6px', borderRadius: 8,
          background: 'none', border: 'none', cursor: deleting ? 'default' : 'pointer',
          color: deleting ? COLORS.textHint : COLORS.red,
        }}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const { business } = useTelegram();
  const { toast } = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selectedTag, setSelectedTag] = useState('menu');
  const fileRef = useRef(null);

  async function refresh() {
    setLoading(true);
    const res = await fetch('/api/documents', { headers: { 'x-telegram-init-data': initData() } });
    if (res.ok) { const d = await res.json(); setDocs(d.documents || []); }
    setLoading(false);
  }

  useEffect(() => { if (business?.id) refresh(); }, [business?.id]);

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    const id = initData();
    if (!id) { toast('Open inside Telegram to upload', { variant: 'error' }); return; }

    setUploading(true);
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    setUploadProgress(isImage ? '🖼️ Analyzing image with AI...' : isVideo ? '🎬 Uploading video...' : '📄 Processing and embedding...');

    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('title', file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
      fd.append('tag', selectedTag);
      fd.append('description', '');

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'x-telegram-init-data': id },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      toast(`✅ ${file.name} uploaded — MiniMe can now send it to customers!`, { variant: 'success' });
      await refresh();
    } catch (e) {
      toast(e.message || 'Upload failed', { variant: 'error' });
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }, [selectedTag]);

  // Handle drag-and-drop
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const ownerDocs = docs.filter(d => d.tag !== 'auto-learned');
  const autoDocs = docs.filter(d => d.tag === 'auto-learned');

  return (
    <div style={{ background: COLORS.bg, minHeight: '100vh', paddingBottom: 80, fontFamily: FONT.body, color: COLORS.textPrimary }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: COLORS.amber, marginBottom: 4 }}>
          Files & Media
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Your Files</h1>
        <p style={{ fontSize: 13, color: COLORS.textHint, margin: '4px 0 0', lineHeight: 1.4 }}>
          Upload your price list, menu, portfolio, or photos. MiniMe sends them automatically when customers ask.
        </p>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* File type selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 8 }}>
            WHAT ARE YOU UPLOADING?
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {QUICK_TAGS.map(tag => (
              <button key={tag} onClick={() => setSelectedTag(tag)} style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: `1.5px solid ${selectedTag === tag ? COLORS.teal : COLORS.border}`,
                background: selectedTag === tag ? COLORS.teal + '15' : '#fff',
                color: selectedTag === tag ? COLORS.teal : COLORS.textSecondary,
                cursor: 'pointer', fontFamily: FONT.body,
              }}>
                {TAG_LABELS[tag]}
              </button>
            ))}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => !uploading && fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? COLORS.teal : uploading ? COLORS.amber : COLORS.border}`,
            borderRadius: RADII.lg,
            padding: '28px 20px',
            textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragOver ? COLORS.teal + '08' : uploading ? COLORS.amber + '05' : COLORS.surface,
            transition: 'all 0.2s',
            marginBottom: 20,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            style={{ display: 'none' }}
            accept="application/pdf,text/plain,text/csv,.md,.docx,.doc,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
            onChange={e => uploadFile(e.target.files?.[0])}
          />

          {uploading ? (
            <>
              <Loader2 size={32} style={{ color: COLORS.amber, marginBottom: 10, animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.amber }}>{uploadProgress}</div>
              <div style={{ fontSize: 12, color: COLORS.textHint, marginTop: 4 }}>This takes 10–30 seconds for PDFs and images</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {selectedTag === 'product-photo' ? '📸' : selectedTag === 'menu' ? '🍽️' : selectedTag === 'portfolio' ? '🎨' : '📄'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 4 }}>
                {dragOver ? 'Drop it here!' : 'Tap to upload or drag & drop'}
              </div>
              <div style={{ fontSize: 12, color: COLORS.textHint }}>
                PDF, Word, images (JPG/PNG/WebP), videos (MP4) · Up to 20 MB
              </div>
            </>
          )}
        </div>

        {/* How it works */}
        <div style={{
          background: 'rgba(79,163,138,0.07)', border: '1px solid rgba(79,163,138,0.2)',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.teal, marginBottom: 4 }}>💡 How it works</div>
          <div style={{ fontSize: 12, color: '#2A5A4A', lineHeight: 1.6 }}>
            When a customer asks <em>"send me the menu"</em> or <em>"show me your price list"</em>, MiniMe automatically finds and sends the right file. Upload your price list, portfolio, or product photos here.
          </div>
        </div>

        {/* Uploaded files */}
        {loading ? (
          <div style={{ color: COLORS.textHint, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Loading…</div>
        ) : ownerDocs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: COLORS.textHint }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No files yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Upload your first file above — MiniMe will send it when customers ask</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>
              YOUR FILES ({ownerDocs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ownerDocs.map(d => (
                <DocCard key={d.id} doc={d} onDelete={id => setDocs(prev => prev.filter(x => x.id !== id))} />
              ))}
            </div>
          </>
        )}

        {/* Auto-learned docs (separate section) */}
        {autoDocs.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.textHint, letterSpacing: '0.08em', marginBottom: 10 }}>
              AUTO-LEARNED ({autoDocs.length}) — MiniMe discovered these from your website or past corrections
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {autoDocs.map(d => (
                <div key={d.id} style={{
                  background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: RADII.md,
                  padding: '10px 12px', fontSize: 12, color: COLORS.textSecondary,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>🧠 {d.title?.slice(0, 60) || 'Auto-learned item'}</span>
                  <button onClick={async () => {
                    await fetch(`/api/documents/${d.id}`, { method: 'DELETE', headers: { 'x-telegram-init-data': initData() } });
                    setDocs(prev => prev.filter(x => x.id !== d.id));
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, padding: 4 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
