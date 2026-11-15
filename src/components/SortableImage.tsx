import { memo, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { useThumbnail } from '../hooks/useThumbnail';

const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv|m4v)$/i;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  id:       string;
  /** Absolute OS path to the media file. Thumbnail is fetched from main process. */
  filePath: string;
  /** Index in the visible list — passed back to onOpen. */
  index:    number;
  /** Stable callback (identity must not change per render for memo to work). */
  onOpen:   (index: number) => void;
  /** Grid layout: render as a fixed-aspect cell with the image cover-cropped. */
  uniform?: boolean;
  /** Grid layout: exact cell height (px) for content-visibility sizing. */
  cellHeight?: number;
  /** Grid layout: cell height as % of cell width (default 75). */
  heightPct?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
// memo: with thousands of cards, progressive reveal and unrelated state changes
// in Board.tsx must not re-render every mounted card.

const SortableImage = memo(function SortableImage({ id, filePath, index, onOpen, uniform, cellHeight, heightPct = 75 }: Props) {
  const isVideo = VIDEO_EXTS.test(filePath);

  // ── dnd-kit ───────────────────────────────────────────────────────────────
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  // ── Lazy thumbnail (IO-gated; resolves to a localfile:// URL) ─────────────
  const { src: thumbSrc, attach } = useThumbnail(filePath);

  // Feed the same element to dnd-kit and the IO observer
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      attach(el);
    },
    [setNodeRef, attach]
  );

  // ── Styles ────────────────────────────────────────────────────────────────
  const wrapStyle: React.CSSProperties = {
    transform:   CSS.Transform.toString(transform),
    transition:  isDragging ? undefined : transition,
    opacity:     isDragging ? 0.3 : 1,
    cursor:      isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
    // Grid cells: skip offscreen layout/paint with an EXACT reserved height,
    // so rows never shift and the scrollbar stays stable.
    ...(uniform && cellHeight ? {
      contentVisibility: 'auto' as React.CSSProperties['contentVisibility'],
      containIntrinsicSize: `auto ${cellHeight}px`
    } : {})
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      ref={setRef}
      style={wrapStyle}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: isDragging ? 0.3 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.18 }}
      {...attributes}
      {...listeners}
      onClick={!isDragging ? () => onOpen(index) : undefined}
      className="sortable-image-wrapper"
    >
      <div style={{
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#1a1a1a',
        boxShadow: isDragging
          ? '0 20px 40px rgba(0,0,0,0.6)'
          : '0 2px 12px rgba(0,0,0,0.4)',
        transition: 'box-shadow 0.2s',
        lineHeight: 0
      }}>

        {thumbSrc && !uniform ? (
          /* ── Masonry: natural aspect ratio ── */
          <img
            src={thumbSrc}
            alt=""
            decoding="async"
            style={{
              width: '100%', height: 'auto', display: 'block',
              borderRadius: 8, userSelect: 'none', pointerEvents: 'none'
            }}
            draggable={false}
          />
        ) : thumbSrc && uniform ? (
          /* ── Grid: fixed-aspect cell, image cover-cropped ── */
          <div style={{ width: '100%', paddingTop: `${heightPct}%`, position: 'relative' }}>
            <img
              src={thumbSrc}
              alt=""
              decoding="async"
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%', objectFit: 'cover',
                borderRadius: 8, userSelect: 'none', pointerEvents: 'none'
              }}
              draggable={false}
            />
          </div>
        ) : (
          /* ── Skeleton placeholder until thumbnail arrives ── */
          <div style={{
            width: '100%',
            paddingTop: uniform ? `${heightPct}%` : isVideo ? '56.25%' : '75%',
            background: 'linear-gradient(90deg, #1a1a1a 25%, #242424 50%, #1a1a1a 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeletonShimmer 1.4s ease-in-out infinite',
            borderRadius: 8
          }} />
        )}

        {/* ── Video badge ── */}
        {isVideo && (
          <div style={{
            position: 'absolute', top: 7, right: 7,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            borderRadius: 5, padding: '3px 7px',
            display: 'flex', alignItems: 'center', gap: 4,
            pointerEvents: 'none'
          }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="white" style={{ flexShrink: 0 }}>
              <polygon points="2,1 11,6 2,11" />
            </svg>
            <span style={{ fontSize: 10, color: 'white', fontWeight: 600, letterSpacing: '0.03em' }}>
              VIDEO
            </span>
          </div>
        )}

        {/* ── Hover overlay ── */}
        <div className="img-hover-overlay" style={{
          position: 'absolute', inset: 0,
          background: 'rgba(255,255,255,0)', transition: 'background 0.15s', borderRadius: 8
        }} />
      </div>
    </motion.div>
  );
});

export default SortableImage;
