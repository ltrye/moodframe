import { useMemo } from 'react';
import type { ThemeType } from '../types';
import { toLocalFileUrl } from '../utils/localUrl';

interface Props {
  theme: ThemeType;
  customBg?: string;
}

// ── Star field for Universe ───────────────────────────────────────────────────

function StarField() {
  const stars = useMemo(
    () =>
      Array.from({ length: 220 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 1.8 + 0.4,
        delay: Math.random() * 6,
        duration: Math.random() * 4 + 2
      })),
    []
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {stars.map((star) => (
        <span
          key={star.id}
          className="star"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.delay}s`,
            animationDuration: `${star.duration}s`
          }}
        />
      ))}
    </div>
  );
}

// ── Cloud blobs for Sky ───────────────────────────────────────────────────────

function CloudLayer() {
  const clouds = useMemo(
    () => [
      { color: 'rgba(180,210,255,0.35)', size: 500, x: 10, y: 15, delay: 0, dur: 18 },
      { color: 'rgba(200,220,255,0.25)', size: 600, x: 55, y: 5, delay: 5, dur: 24 },
      { color: 'rgba(170,200,255,0.3)', size: 450, x: 30, y: 50, delay: 2, dur: 20 },
      { color: 'rgba(210,230,255,0.2)', size: 700, x: 70, y: 65, delay: 8, dur: 28 },
      { color: 'rgba(190,215,255,0.28)', size: 380, x: 5, y: 70, delay: 3, dur: 22 },
      { color: 'rgba(160,195,255,0.22)', size: 550, x: 80, y: 30, delay: 11, dur: 26 }
    ],
    []
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {clouds.map((c, i) => (
        <div
          key={i}
          className="cloud-blob"
          style={{
            background: c.color,
            width: c.size,
            height: c.size,
            left: `${c.x}%`,
            top: `${c.y}%`,
            transform: 'translate(-50%, -50%)',
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.dur}s`
          }}
        />
      ))}
    </div>
  );
}

// ── Forest noise layer ────────────────────────────────────────────────────────

function ForestLayer() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {/* Radial light source */}
      <div
        style={{
          position: 'absolute',
          width: 800,
          height: 800,
          left: '50%',
          top: '20%',
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle, rgba(100,160,80,0.18) 0%, transparent 70%)',
          animation: 'forestSway 8s ease-in-out infinite'
        }}
      />
      {/* Bottom dark layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(0,20,5,0.6) 0%, transparent 50%)'
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const THEME_STYLES: Record<string, React.CSSProperties> = {
  universe: {
    background: 'linear-gradient(160deg, #02001a 0%, #0d0828 50%, #03021a 100%)'
  },
  sky: {
    background: 'linear-gradient(180deg, #1a3a6b 0%, #2d5fa6 40%, #7bafd4 100%)'
  },
  forest: {
    background: 'linear-gradient(160deg, #071a07 0%, #0c2b10 40%, #112e12 100%)'
  },
  void: {
    background: '#000000'
  },
  paper: {
    background:
      'linear-gradient(135deg, #f5ead8 0%, #ede0c8 40%, #f0e4ce 70%, #ecddc6 100%)'
  }
};

export default function ThemeBackground({ theme, customBg }: Props) {
  const wrapStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    ...THEME_STYLES[theme] ?? THEME_STYLES.void
  };

  if (theme === 'custom' && customBg) {
    return (
      <div
        style={{
          ...wrapStyle,
          background: `url("${toLocalFileUrl(customBg)}") center/cover no-repeat`
        }}
      />
    );
  }

  return (
    <div style={wrapStyle}>
      {theme === 'universe' && <StarField />}
      {theme === 'sky' && <CloudLayer />}
      {theme === 'forest' && <ForestLayer />}
      {theme === 'void' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 100%)',
            animation: 'voidPulse 6s ease-in-out infinite'
          }}
        />
      )}
      {theme === 'paper' && (
        <>
          {/* Noise texture via SVG filter */}
          <svg style={{ position: 'absolute', width: 0, height: 0 }}>
            <defs>
              <filter id="paper-noise">
                <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
                <feBlend in="SourceGraphic" mode="multiply" />
              </filter>
            </defs>
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              filter: 'url(#paper-noise)',
              opacity: 0.04,
              animation: 'paperNoise 5s ease-in-out infinite'
            }}
          />
          {/* Subtle corner vignette */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse at center, transparent 50%, rgba(160,120,70,0.15) 100%)'
            }}
          />
        </>
      )}
    </div>
  );
}
