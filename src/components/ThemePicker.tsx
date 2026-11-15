import { motion, AnimatePresence } from 'framer-motion';
import type { ThemeType } from '../types';

const THEMES: { id: ThemeType; label: string; preview: string; textColor?: string }[] = [
  {
    id: 'universe',
    label: '✦ Universe',
    preview: 'linear-gradient(160deg,#02001a 0%,#0d0828 50%,#03021a 100%)'
  },
  {
    id: 'sky',
    label: '☁ Sky',
    preview: 'linear-gradient(180deg,#1a3a6b 0%,#2d5fa6 40%,#7bafd4 100%)'
  },
  {
    id: 'forest',
    label: '🌿 Forest',
    preview: 'linear-gradient(160deg,#071a07 0%,#0c2b10 40%,#112e12 100%)'
  },
  {
    id: 'void',
    label: '◉ Void',
    preview: 'radial-gradient(ellipse, #111 0%, #000 100%)'
  },
  {
    id: 'paper',
    label: '📄 Paper',
    preview: 'linear-gradient(135deg,#f5ead8 0%,#ede0c8 50%,#f0e4ce 100%)',
    textColor: '#3a2e1e'
  }
];

interface Props {
  open: boolean;
  current: ThemeType;
  onClose: () => void;
  onSelect: (theme: ThemeType, customBg?: string) => void;
}

export default function ThemePicker({ open, current, onClose, onSelect }: Props) {
  const handleCustomBg = async () => {
    const filePath = await window.moodframe.openImageDialog();
    if (filePath) {
      onSelect('custom', filePath);
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 90
            }}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: 60,
              right: 16,
              zIndex: 100,
              background: 'rgba(22,22,28,0.96)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14,
              padding: '16px',
              backdropFilter: 'blur(20px)',
              width: 260,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)'
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                marginBottom: 12
              }}
            >
              Board Theme
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { onSelect(t.id); onClose(); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background:
                      current === t.id
                        ? 'rgba(124,110,245,0.18)'
                        : 'transparent',
                    border:
                      current === t.id
                        ? '1px solid rgba(124,110,245,0.4)'
                        : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    if (current !== t.id) {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        'rgba(255,255,255,0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (current !== t.id) {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }
                  }}
                >
                  {/* Mini swatch */}
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: t.preview,
                      flexShrink: 0,
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                  {current === t.id && (
                    <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 16 }}>
                      ✓
                    </span>
                  )}
                </button>
              ))}

              {/* Custom image */}
              <button
                onClick={handleCustomBg}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background:
                    current === 'custom'
                      ? 'rgba(124,110,245,0.18)'
                      : 'transparent',
                  border:
                    current === 'custom'
                      ? '1px solid rgba(124,110,245,0.4)'
                      : '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  marginTop: 4
                }}
                onMouseEnter={(e) => {
                  if (current !== 'custom') {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(255,255,255,0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (current !== 'custom') {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: '2px dashed rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0
                  }}
                >
                  +
                </div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Custom Image…</span>
                {current === 'custom' && (
                  <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 16 }}>
                    ✓
                  </span>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
