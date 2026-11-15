import { useEffect, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayer from './VideoPlayer';

// ── helpers ───────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']);

function isVideoSrc(src: string): boolean {
  const ext = src.split('.').pop()?.split('?')[0].toLowerCase() ?? '';
  return VIDEO_EXTS.has(ext);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Props {
  images:    string[];
  filePaths: string[];
  index:     number | null;
  onClose:   () => void;
  onNavigate:(index: number) => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function ImageOverlay({ images, filePaths, index, onClose, onNavigate }: Props) {
  const isOpen  = index !== null;
  const src     = index !== null ? images[index]    : null;
  const fp      = index !== null ? filePaths[index] : null;
  const isVideo = src ? isVideoSrc(src) : false;

  // ── zoom / pan ───────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });

  // Refs so event-listener closures always see current values without stale deps
  const zoomRef = useRef(1);
  const panRef  = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // drag
  const dragging   = useRef(false);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const panAtDrag  = useRef({ x: 0, y: 0 });
  const didDrag    = useRef(false);

  // reset whenever slide changes (index changes, incl. open/close)
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    zoomRef.current = 1;
    panRef.current  = { x: 0, y: 0 };
    dragging.current = false;
    didDrag.current  = false;
  }, [index]);

  // ── navigation ───────────────────────────────────────────────────────────────
  const handlePrev = useCallback(() => {
    if (index === null) return;
    onNavigate((index - 1 + images.length) % images.length);
  }, [index, images.length, onNavigate]);

  const handleNext = useCallback(() => {
    if (index === null) return;
    onNavigate((index + 1) % images.length);
  }, [index, images.length, onNavigate]);

  // ── keyboard ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape')     { onClose();    return; }
      if (isVideo) return;
      if (e.key === 'ArrowLeft')  { handlePrev(); return; }
      if (e.key === 'ArrowRight') { handleNext(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isVideo, onClose, handlePrev, handleNext]);

  // ── wheel zoom ───────────────────────────────────────────────────────────────
  // Attached to `window` so it works regardless of when the overlay div mounts.
  // Non-passive so we can call preventDefault (stops page scroll behind overlay).
  useEffect(() => {
    if (!isOpen || isVideo) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();

      const prevZoom = zoomRef.current;
      const factor   = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom  = Math.min(10, Math.max(1, prevZoom * factor));

      if (newZoom <= 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }

      // zoom toward cursor
      const cx = e.clientX - window.innerWidth  / 2;
      const cy = e.clientY - window.innerHeight / 2;
      const { x: px, y: py } = panRef.current;
      const ratio = newZoom / prevZoom;

      setZoom(newZoom);
      setPan({ x: cx - (cx - px) * ratio, y: cy - (cy - py) * ratio });
    };

    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [isOpen, isVideo]); // re-runs when overlay opens/closes or switches image↔video

  // ── drag to pan ──────────────────────────────────────────────────────────────
  // Pointer events (not mouse events) so pen/stylus input (Wacom etc.) and
  // touch work the same as a mouse.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isVideo) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging.current   = true;
    didDrag.current    = false;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
    panAtDrag.current  = { ...panRef.current };
    // Capture so the drag keeps tracking even if the pen leaves the element
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  }, [isVideo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragOrigin.current.x;
    const dy = e.clientY - dragOrigin.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag.current = true;
    setPan({ x: panAtDrag.current.x + dx, y: panAtDrag.current.y + dy });
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  // ── button zoom (also used by pen users without a scroll wheel) ─────────────
  const zoomBy = useCallback((factor: number) => {
    const prev = zoomRef.current;
    const next = Math.min(10, Math.max(1, prev * factor));
    if (next <= 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    // Zoom toward the screen centre; scale pan so the focal point stays put
    const ratio = next / prev;
    setZoom(next);
    setPan({ x: panRef.current.x * ratio, y: panRef.current.y * ratio });
  }, []);

  const onBackdropClick = useCallback(() => {
    if (!didDrag.current) onClose();
    didDrag.current = false;
  }, [onClose]);

  const imgCursor = isVideo ? 'default'
    : zoom > 1 ? 'grab'
    : 'zoom-in';

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && src && (
        <motion.div
          key="overlay-backdrop"
          initial={{ opacity: isVideo ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: isVideo ? 0.06 : 0.22 }}
          onClick={onBackdropClick}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.9)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            // Let pointer events drive pan/zoom instead of browser gestures
            touchAction: 'none'
          }}
        >
          {/* Media wrapper */}
          <motion.div
            key={src}
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: 1,    opacity: 1 }}
            exit={{ scale: 0.88,    opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {isVideo ? (
              <VideoPlayer filePath={fp!} onClose={onClose} />
            ) : (
              <div style={{
                position: 'relative',
                lineHeight: 0,
                cursor: imgCursor,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: dragging.current ? 'none' : 'transform 0.08s ease-out',
                userSelect: 'none'
              }}>
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  style={{
                    maxWidth: '88vw',
                    maxHeight: '88vh',
                    objectFit: 'contain',
                    borderRadius: zoom > 1 ? 4 : 8,
                    boxShadow: '0 30px 80px rgba(0,0,0,0.8)',
                    display: 'block',
                    pointerEvents: 'all'
                  }}
                />
              </div>
            )}

            {/* Zoom level hint */}
            {!isVideo && zoom > 1 && (
              <div style={{
                position: 'absolute',
                bottom: -34,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.55)',
                borderRadius: 12,
                padding: '3px 10px',
                fontSize: 11,
                color: 'rgba(255,255,255,0.5)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap'
              }}>
                {Math.round(zoom * 100)}% · scroll to zoom · drag to pan
              </div>
            )}
          </motion.div>

          {/* ── Nav arrows ── */}
          {images.length > 1 && (
            <>
              <NavButton direction="left"  onClick={(e) => { e.stopPropagation(); handlePrev(); }} />
              <NavButton direction="right" onClick={(e) => { e.stopPropagation(); handleNext(); }} />
            </>
          )}

          {/* ── Counter ── */}
          {images.length > 1 && index !== null && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 20,
              padding: '5px 14px',
              fontSize: 12,
              color: 'rgba(255,255,255,0.55)',
              pointerEvents: 'none'
            }}>
              {index + 1} / {images.length}
            </div>
          )}

          {/* ── Zoom controls (images only) ── */}
          {!isVideo && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'fixed', bottom: 24, right: 24,
                display: 'flex', flexDirection: 'column', gap: 6, zIndex: 210
              }}
            >
              {zoom > 1 && (
                <ZoomBtn title="Reset zoom" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
                  <span style={{ fontSize: 10, color: 'white', fontWeight: 600 }}>1:1</span>
                </ZoomBtn>
              )}
              <ZoomBtn title="Zoom in" onClick={() => zoomBy(1.35)}>
                <svg width="13" height="13" viewBox="0 0 14 14" stroke="white" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="7" y1="1.5" x2="7" y2="12.5"/><line x1="1.5" y1="7" x2="12.5" y2="7"/>
                </svg>
              </ZoomBtn>
              <ZoomBtn title="Zoom out" onClick={() => zoomBy(1 / 1.35)}>
                <svg width="13" height="13" viewBox="0 0 14 14" stroke="white" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="1.5" y1="7" x2="12.5" y2="7"/>
                </svg>
              </ZoomBtn>
            </div>
          )}

          {/* ── Close ── */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              position: 'fixed', top: 18, right: 18,
              width: 34, height: 34, borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'background 0.15s',
              padding: 0
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)')}
          >
            {/* × via SVG so it's always pixel-perfect centered */}
            <svg width="11" height="11" viewBox="0 0 11 11" stroke="white" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1" y1="1" x2="10" y2="10"/>
              <line x1="10" y1="1" x2="1" y2="10"/>
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── ZoomBtn ───────────────────────────────────────────────────────────────────

function ZoomBtn({ title, onClick, children }: {
  title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 38, height: 38, borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'background 0.15s',
        backdropFilter: 'blur(4px)', padding: 0
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)')}
    >
      {children}
    </button>
  );
}

// ── NavButton ─────────────────────────────────────────────────────────────────
// SVG chevrons instead of ‹ › text so vertical alignment is always exact.

function NavButton({ direction, onClick }: {
  direction: 'left' | 'right';
  onClick: React.MouseEventHandler;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        top: '50%',
        [direction]: 18,
        transform: 'translateY(-50%)',
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 210,
        transition: 'background 0.15s',
        backdropFilter: 'blur(4px)',
        padding: 0
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)')}
    >
      {direction === 'left' ? (
        <svg width="9" height="15" viewBox="0 0 9 15" fill="none"
          stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="8,1 1,7.5 8,14" />
        </svg>
      ) : (
        <svg width="9" height="15" viewBox="0 0 9 15" fill="none"
          stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1,1 8,7.5 1,14" />
        </svg>
      )}
    </button>
  );
}
