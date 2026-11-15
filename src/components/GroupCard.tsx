import { useRef, useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { toLocalFileUrl } from '../utils/localUrl';

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

interface Props {
  name:          string;
  folderPath:    string;   // full OS path to the group folder
  /** Linked external folder — delete only removes the link, never the folder */
  isLink?:       boolean;
  onClick:       () => void;
  onRename:      (newName: string) => void;
  onDelete:      () => void;
}

export default function GroupCard({ name, folderPath, isLink, onClick, onRename, onDelete }: Props) {
  // ── dnd-kit droppable ──────────────────────────────────────────────────────────
  const { setNodeRef, isOver } = useDroppable({ id: `__group:${name}` });

  // ── thumbnail + item count ────────────────────────────────────────────────────
  const [thumbSrc,  setThumbSrc]  = useState<string | null>(null);
  const [thumbIsVideo, setVideo]  = useState(false);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.moodframe.readImageFiles(folderPath).then((files) => {
      if (cancelled) return;
      setItemCount(files.length);
      if (files.length > 0) {
        const first = files[0];
        setVideo(VIDEO_EXTS.test(first));
        setThumbSrc(toLocalFileUrl(folderPath + '/' + first));
      }
    });
    return () => { cancelled = true; };
  }, [folderPath]);

  // ── hover / rename state ───────────────────────────────────────────────────────
  const [hovered,  setHovered]  = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameVal,  setNameVal]  = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setNameVal(name);
    setRenaming(false);
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const isEmpty = itemCount === 0;

  // ── render ─────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (!renaming) onClick(); }}
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        background: isOver ? 'rgba(124,110,245,0.18)' : '#1a1a1a',
        border: `1px solid ${isOver ? 'rgba(124,110,245,0.6)' : 'rgba(255,255,255,0.08)'}`,
        boxShadow: isOver
          ? '0 0 0 2px rgba(124,110,245,0.35), 0 8px 24px rgba(0,0,0,0.4)'
          : hovered ? '0 6px 20px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.25)',
        cursor: renaming ? 'default' : 'pointer',
        transform: isOver ? 'scale(1.02)' : hovered && !isOver ? 'translateY(-2px)' : 'none',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        userSelect: 'none'
      }}
    >
      {/* ── Thumbnail area ── */}
      <div style={{
        paddingTop: '62%', position: 'relative',
        background: '#111', overflow: 'hidden'
      }}>
        {thumbSrc ? (
          thumbIsVideo ? (
            <VideoThumb src={thumbSrc} />
          ) : (
            <img
              src={thumbSrc}
              alt=""
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )
        ) : (
          /* Empty folder placeholder */
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, color: 'rgba(255,255,255,0.15)'
          }}>
            <FolderSVG />
          </div>
        )}

        {/* Drop-into overlay */}
        {isOver && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(124,110,245,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none'
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity={0.85}>
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
          </div>
        )}
      </div>

      {/* ── Footer: name + count + actions ── */}
      <div style={{
        padding: '7px 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        minHeight: 36
      }}>
        {/* Folder / link icon */}
        {isLink ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(124,110,245,0.8)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)" style={{ flexShrink: 0 }}>
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
        )}

        {renaming ? (
          <input
            ref={inputRef}
            value={nameVal}
            autoFocus
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  commitRename();
              if (e.key === 'Escape') { setNameVal(name); setRenaming(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1, minWidth: 0,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid var(--accent)',
              borderRadius: 4, padding: '2px 6px',
              fontSize: 12, color: 'var(--text)', outline: 'none'
            }}
          />
        ) : (
          <span style={{
            flex: 1, minWidth: 0,
            fontSize: 12, fontWeight: 500, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {name}
          </span>
        )}

        {/* Item count */}
        {!renaming && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {itemCount}
          </span>
        )}

        {/* Hover actions */}
        {hovered && !renaming && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {/* Rename */}
            <ActionBtn onClick={startRename} title="Rename">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12.85 1.15a1.5 1.5 0 0 1 0 2.12l-9 9a.5.5 0 0 1-.22.13l-3 1a.5.5 0 0 1-.63-.63l1-3a.5.5 0 0 1 .13-.22l9-9a1.5 1.5 0 0 1 2.12 0z"/>
              </svg>
            </ActionBtn>
            {/* Delete — links can always be removed (folder stays untouched);
                real groups only when empty */}
            <ActionBtn
              onClick={handleDelete}
              title={isLink ? 'Remove link (folder is kept)' : isEmpty ? 'Delete group' : 'Group is not empty'}
              disabled={!isLink && !isEmpty}
              danger
            >
              <svg width="10" height="10" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="2" y1="2" x2="14" y2="14"/>
                <line x1="14" y1="2" x2="2" y2="14"/>
              </svg>
            </ActionBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VideoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="metadata"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      onLoadedMetadata={() => {
        if (ref.current) {
          const d = ref.current.duration;
          ref.current.currentTime = isFinite(d) ? d * 0.15 : 0;
        }
      }}
    />
  );
}

function FolderSVG() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="rgba(255,255,255,0.18)">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  );
}

function ActionBtn({ children, onClick, title, danger, disabled }: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 22, height: 22,
        borderRadius: 5,
        border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: hov && !disabled
          ? (danger ? 'rgba(224,82,82,0.25)' : 'rgba(255,255,255,0.12)')
          : 'rgba(255,255,255,0.06)',
        color: disabled
          ? 'rgba(255,255,255,0.18)'
          : danger ? 'var(--danger)' : 'rgba(255,255,255,0.7)',
        transition: 'background 0.12s, color 0.12s',
        padding: 0
      }}
    >
      {children}
    </button>
  );
}
