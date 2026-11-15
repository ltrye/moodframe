import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toLocalFileUrl } from '../utils/localUrl';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useBoardStore } from '../store/useBoardStore';
import MediaPickerModal from './MediaPickerModal';
import type { Board } from '../types';

interface Props {
  board: Board;
}

export default function BoardCard({ board }: Props) {
  const navigate        = useNavigate();
  const renameBoard     = useBoardStore((s) => s.renameBoard);
  const removeBoard     = useBoardStore((s) => s.removeBoard);
  const setBoardThumbnail = useBoardStore((s) => s.setBoardThumbnail);

  // localfile:// URL of the 400 px cached thumbnail, or null while loading
  const [thumb,   setThumb]   = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [nameVal, setNameVal]       = useState(board.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef  = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  // ── Thumbnail resolution (IO-gated, main-process pipeline) ───────────────────
  // We use an IntersectionObserver so off-screen cards on the home grid never
  // trigger IPC/sharp work until they scroll into view.
  // Priority: custom thumbnail > getFirstMedia + getThumbnail
  const setRef = useCallback((el: HTMLDivElement | null) => {
    cardRef.current = el;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadingRef.current = false;

    const loadThumb = async (filePath: string) => {
      if (cancelled) return;
      loadingRef.current = true;
      try {
        const cachePath = await window.moodframe.getThumbnail(filePath);
        if (!cancelled) setThumb(toLocalFileUrl(cachePath));
      } catch {
        // broken file — leave skeleton
      } finally {
        loadingRef.current = false;
      }
    };

    if (board.customThumbnail) {
      // Custom thumbnail is a fixed path — load immediately (no IO wait needed)
      loadThumb(board.customThumbnail);
      return () => { cancelled = true; };
    }

    // Auto-detect: observe until visible, then fetch first media file + thumbnail
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const firstName = await window.moodframe.getFirstMedia(board.folderPath);
        if (!cancelled && firstName) {
          const filePath = `${board.folderPath}\\${firstName}`;
          loadThumb(filePath);
        }
      },
      { rootMargin: '300px 0px' }
    );

    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [board.folderPath, board.customThumbnail]);

  // ── Keep nameVal in sync if parent renames ────────────────────────────────────
  useEffect(() => { setNameVal(board.name); }, [board.name]);

  // ── Close context menu on next click anywhere ─────────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('mousedown', close, { once: true });
    return () => window.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const commitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== board.name) renameBoard(board.id, trimmed);
    else setNameVal(board.name);
    setEditing(false);
  };

  const handleCardClick = () => {
    if (!editing && !confirmDelete) navigate(`/board/${board.id}`);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) removeBoard(board.id);
    else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
    }
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <motion.div
        ref={setRef}
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 8 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
        style={{
          background: 'var(--surface)',
          borderRadius: 12,
          overflow: 'hidden',
          cursor: 'pointer',
          border: '1px solid var(--border)',
          transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
          boxShadow: hovered ? '0 12px 40px rgba(0,0,0,0.5)' : '0 2px 12px rgba(0,0,0,0.3)',
          transform: hovered ? 'translateY(-3px)' : 'translateY(0)'
        }}
      >
        {/* ── Thumbnail area ── */}
        <div style={{
          width: '100%', paddingTop: '62%',
          position: 'relative', background: '#161616', overflow: 'hidden'
        }}>
          {thumb ? (
            /* 400 px JPEG thumbnail — same for images and videos */
            <img
              src={thumb}
              alt={board.name}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%', objectFit: 'cover',
                transition: 'transform 0.35s ease',
                transform: hovered ? 'scale(1.04)' : 'scale(1)'
              }}
              draggable={false}
            />
          ) : (
            /* Skeleton shimmer until thumbnail arrives */
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, #1a1a1a 25%, #242424 50%, #1a1a1a 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeletonShimmer 1.4s ease-in-out infinite'
            }} />
          )}

          {/* Delete button */}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: hovered ? 1 : 0 }}
            onClick={handleDelete}
            style={{
              position: 'absolute', top: 8, right: 8,
              width: 28, height: 28, borderRadius: '50%',
              background: confirmDelete ? 'rgba(224,82,82,0.85)' : 'rgba(0,0,0,0.55)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'white', fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(4px)', transition: 'background 0.2s'
            }}
            title={confirmDelete ? 'Click again to confirm' : 'Remove board'}
          >
            {confirmDelete ? '!' : '×'}
          </motion.button>
        </div>

        {/* ── Board name ── */}
        <div style={{ padding: '10px 12px' }}>
          {editing ? (
            <input
              ref={inputRef}
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  commitRename();
                if (e.key === 'Escape') { setNameVal(board.name); setEditing(false); }
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                background: 'var(--surface2)',
                border: '1px solid var(--accent)',
                borderRadius: 4, padding: '3px 7px',
                fontSize: 13, fontWeight: 500, color: 'var(--text)', outline: 'none'
              }}
              autoFocus
            />
          ) : (
            <p
              onClick={handleNameClick}
              title="Click to rename"
              style={{
                fontSize: 13, fontWeight: 500, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                margin: 0, borderRadius: 4, padding: '3px 4px', transition: 'background 0.15s'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLParagraphElement).style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLParagraphElement).style.background = 'transparent')}
            >
              {board.name}
            </p>
          )}
        </div>
      </motion.div>

      {/* ── Context menu (portal) ── */}
      {ctxMenu && createPortal(
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onSettings={() => { setCtxMenu(null); setSettingsOpen(true); }}
          onRename={() => {
            setCtxMenu(null);
            setEditing(true);
            setTimeout(() => inputRef.current?.select(), 50);
          }}
          onDelete={() => { setCtxMenu(null); removeBoard(board.id); }}
        />,
        document.body
      )}

      {/* ── Board settings modal (portal) ── */}
      {settingsOpen && createPortal(
        <AnimatePresence>
          <BoardSettingsModal
            board={board}
            onClose={() => setSettingsOpen(false)}
            onThumbnailChange={(path) => setBoardThumbnail(board.id, path)}
          />
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

// ── ContextMenu ───────────────────────────────────────────────────────────────

function ContextMenu({ x, y, onSettings, onRename, onDelete }: {
  x: number;
  y: number;
  onSettings: () => void;
  onRename:   () => void;
  onDelete:   () => void;
}) {
  const W = 176, H = 116;
  const left = Math.min(x, window.innerWidth  - W - 8);
  const top  = Math.min(y, window.innerHeight - H - 8);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.93, y: -4 }}
      animate={{ opacity: 1,  scale: 1,    y: 0  }}
      exit={{   opacity: 0,  scale: 0.93        }}
      transition={{ duration: 0.13 }}
      onMouseDown={(e) => e.stopPropagation()} // don't trigger outside-click dismiss
      style={{
        position: 'fixed', left, top,
        background: '#202020',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 9,
        boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
        overflow: 'hidden',
        zIndex: 9000,
        minWidth: W,
        backdropFilter: 'blur(12px)'
      }}
    >
      <MenuItem icon="⚙️" onClick={onSettings}>Settings</MenuItem>
      <MenuItem icon="✏️" onClick={onRename}>Rename</MenuItem>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
      <MenuItem icon="🗑️" onClick={onDelete} danger>Remove</MenuItem>
    </motion.div>
  );
}

function MenuItem({ icon, children, onClick, danger }: {
  icon: string;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 13px',
        textAlign: 'left', fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--text)',
        background: hov ? 'rgba(255,255,255,0.07)' : 'transparent',
        cursor: 'pointer', transition: 'background 0.1s',
        border: 'none'
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      {children}
    </button>
  );
}

// ── BoardSettingsModal ─────────────────────────────────────────────────────────

function BoardSettingsModal({ board, onClose, onThumbnailChange }: {
  board: Board;
  onClose: () => void;
  onThumbnailChange: (path: string | null) => void;
}) {
  const hasCustom  = !!board.customThumbnail;
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleUpload = async () => {
    setUploading(true);
    try {
      const path = await window.moodframe.openImageDialog();
      if (path) onThumbnailChange(path);
    } finally {
      setUploading(false);
    }
  };

  const handlePickFromFolder = (absPath: string) => {
    onThumbnailChange(absPath);
    setPickerOpen(false);
  };

  return (
    <>
    <motion.div
      key="settings-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 10 }}
        animate={{ scale: 1,   opacity: 1, y: 0  }}
        exit={{   scale: 0.9, opacity: 0         }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          padding: 24,
          width: 360,
          boxShadow: '0 24px 80px rgba(0,0,0,0.75)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 20
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
            Board Settings
          </h2>
          <CloseBtn onClick={onClose} />
        </div>

        {/* Board name (read-only label) */}
        <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em',
          textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
          Name
        </label>
        <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 20,
          padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
          borderRadius: 6, border: '1px solid var(--border)' }}>
          {board.name}
        </p>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Custom thumbnail */}
        <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em',
          textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>
          Cover Image
        </label>

        {/* Preview */}
        <div style={{
          width: '100%', paddingTop: '52%', position: 'relative',
          borderRadius: 8, overflow: 'hidden',
          background: '#161616', border: '1px solid var(--border)',
          marginBottom: 12
        }}>
          {hasCustom ? (
            <img
              src={toLocalFileUrl(board.customThumbnail!)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover' }}
              draggable={false}
            />
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 6, color: 'rgba(255,255,255,0.2)', fontSize: 12
            }}>
              <span style={{ fontSize: 28 }}>🖼</span>
              Auto-detected from folder
            </div>
          )}
        </div>

        {/* Buttons */}
        {/* Row 1: pick from moodboard */}
        <button
          onClick={() => setPickerOpen(true)}
          style={{
            width: '100%', padding: '8px 14px', borderRadius: 7, marginBottom: 8,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text)', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', transition: 'background 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.11)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity={0.7}>
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          Pick from Moodboard
        </button>

        {/* Row 2: upload external + remove */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 7,
              background: 'var(--accent)',
              border: 'none', color: 'white',
              fontSize: 13, fontWeight: 500, cursor: uploading ? 'default' : 'pointer',
              opacity: uploading ? 0.6 : 1, transition: 'opacity 0.15s, background 0.15s'
            }}
            onMouseEnter={(e) => {
              if (!uploading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
            }}
          >
            {uploading ? 'Choosing…' : hasCustom ? '↑ Replace image' : '↑ Upload image'}
          </button>

          {hasCustom && (
            <button
              onClick={() => onThumbnailChange(null)}
              style={{
                padding: '8px 14px', borderRadius: 7,
                background: 'rgba(224,82,82,0.15)',
                border: '1px solid rgba(224,82,82,0.3)',
                color: 'var(--danger)',
                fontSize: 13, cursor: 'pointer', transition: 'background 0.15s'
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(224,82,82,0.25)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(224,82,82,0.15)';
              }}
            >
              Remove
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>

    {/* ── Folder picker — rendered above the settings backdrop ── */}
    {pickerOpen && (
      <MediaPickerModal
        folderPath={board.folderPath}
        onPick={handlePickFromFolder}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 28, height: 28, borderRadius: '50%',
        background: hov ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'background 0.15s', padding: 0
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round">
        <line x1="1" y1="1" x2="9" y2="9"/>
        <line x1="9" y1="1" x2="1" y2="9"/>
      </svg>
    </button>
  );
}
