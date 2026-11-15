/**
 * MediaPickerModal
 *
 * A full-screen overlay that shows every media file in a folder as a thumbnail
 * grid. The user clicks one to set it as the board's cover image.
 *
 * Thumbnails load lazily per-cell via useThumbnail (IO-gated), so cached files
 * appear instantly and uncached ones fill in as they scroll into view.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useThumbnail } from '../hooks/useThumbnail';
import type { FileEntry } from '../types';

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

interface Props {
  folderPath: string;
  onPick:  (absoluteFilePath: string) => void;
  onClose: () => void;
}

export default function MediaPickerModal({ folderPath, onPick, onClose }: Props) {
  const [files,   setFiles]   = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.moodframe.scanFolder(folderPath).then((entries) => {
      if (cancelled) return;
      setFiles(entries);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [folderPath]);

  return createPortal(
    <motion.div
      key="media-picker-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <motion.div
        initial={{ scale: 0.93, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.93, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          width: '72vw', maxWidth: 860,
          maxHeight: '78vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.75)'
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0
        }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
              Pick Cover Image
            </h2>
            {!loading && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {files.length} {files.length === 1 ? 'file' : 'files'} · click to set as cover
              </p>
            )}
          </div>
          <CloseBtn onClick={onClose} />
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading ? (
            <SkeletonGrid />
          ) : files.length === 0 ? (
            <Empty />
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 10
            }}>
              {files.map(({ name, type }) => {
                const absPath = `${folderPath}\\${name}`;
                const isVid   = type === 'video' || VIDEO_EXTS.test(name);
                return (
                  <PickerCell
                    key={name}
                    name={name}
                    filePath={absPath}
                    isVideo={isVid}
                    onPick={() => onPick(absPath)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

// ── PickerCell ─────────────────────────────────────────────────────────────────

function PickerCell({ name, filePath, isVideo, onPick }: {
  name:     string;
  filePath: string;
  isVideo:  boolean;
  onPick:   () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // The modal grid scrolls its own container, but viewport-relative IO still
  // works because the modal is centered within the viewport.
  const { src: thumb, attach } = useThumbnail(filePath, '300px 0px');

  return (
    <div
      ref={attach}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={name}
      style={{
        cursor: 'pointer',
        borderRadius: 8,
        overflow: 'hidden',
        border: hovered
          ? '2px solid var(--accent)'
          : '2px solid transparent',
        transition: 'border-color 0.15s, transform 0.15s',
        transform: hovered ? 'scale(1.03)' : 'scale(1)',
        background: '#141414',
        position: 'relative'
      }}
    >
      {/* Aspect-ratio container */}
      <div style={{ paddingTop: '75%', position: 'relative' }}>
        {thumb ? (
          <img
            src={thumb}
            alt={name}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover'
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, #1a1a1a 25%, #242424 50%, #1a1a1a 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeletonShimmer 1.4s ease-in-out infinite'
          }} />
        )}

        {/* Hover overlay */}
        {hovered && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(124,110,245,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{
              background: 'rgba(124,110,245,0.9)',
              borderRadius: '50%', width: 30, height: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
                <polyline points="2,7 6,11 12,3" strokeWidth="2"
                  stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        )}

        {/* Video badge */}
        {isVideo && (
          <div style={{
            position: 'absolute', top: 5, right: 5,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            borderRadius: 4, padding: '2px 5px',
            display: 'flex', alignItems: 'center', gap: 3,
            pointerEvents: 'none'
          }}>
            <svg width="9" height="9" viewBox="0 0 12 12" fill="white">
              <polygon points="2,1 11,6 2,11" />
            </svg>
            <span style={{ fontSize: 9, color: 'white', fontWeight: 600 }}>VID</span>
          </div>
        )}
      </div>

      {/* File name */}
      <div style={{
        padding: '5px 6px',
        fontSize: 10, color: 'rgba(255,255,255,0.5)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        background: '#0e0e0e'
      }}>
        {name}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: 10
    }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{
          borderRadius: 8, overflow: 'hidden',
          background: 'linear-gradient(90deg, #1a1a1a 25%, #242424 50%, #1a1a1a 75%)',
          backgroundSize: '200% 100%',
          animation: `skeletonShimmer 1.4s ease-in-out ${i * 0.05}s infinite`,
          paddingTop: '75%'
        }} />
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: 200, gap: 10,
      color: 'rgba(255,255,255,0.3)'
    }}>
      <div style={{ fontSize: 36 }}>📂</div>
      <p style={{ fontSize: 13, margin: 0 }}>No media files in this folder</p>
    </div>
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
