/**
 * TitleBar — custom frameless-window title bar.
 *
 * Slim 32px bar with the app title, an always-on-top pin (persisted via
 * electron-store), and window controls. Min/max/close are only rendered on
 * Windows/Linux — macOS keeps its native traffic lights.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const TITLEBAR_HEIGHT = 32;

interface Props {
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  toggleShortcut: string;
  onChangeShortcut: (accel: string) => Promise<{ ok: boolean; error?: string }>;
  platform: string;
  isMaximized: boolean;
}

export default function TitleBar({
  alwaysOnTop, onToggleAlwaysOnTop, toggleShortcut, onChangeShortcut,
  platform, isMaximized
}: Props) {
  const isMac = platform === 'darwin';
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Double-click on empty bar area toggles maximize (native title-bar behaviour)
    if ((e.target as HTMLElement).closest('button')) return;
    window.moodframe.maximizeToggle();
  }, []);

  return (
    <header
      className="app-drag"
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'relative',
        height: TITLEBAR_HEIGHT,
        zIndex: 1000,
        display: 'flex', alignItems: 'center',
        paddingLeft: isMac ? 78 : 10,  // room for macOS traffic lights
        background: '#161616',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        userSelect: 'none'
      }}
    >
      {/* App title */}
      <span style={{
        fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
        letterSpacing: '0.02em', pointerEvents: 'none'
      }}>
        Moodframe
      </span>

      <div style={{ flex: 1 }} />

      {/* Option buttons */}
      <div className="app-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
        {/* Always on top (pin) */}
        <BarButton
          title={alwaysOnTop ? 'Unpin from top' : 'Keep window always on top'}
          active={alwaysOnTop}
          onClick={onToggleAlwaysOnTop}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 3v2l-2 1v5l4 3v2h-5v5l-1 2-1-2v-5H6v-2l4-3V6L8 5V3h8z"/>
          </svg>
        </BarButton>

        {/* Settings (gear) */}
        <BarButton title="Settings" active={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64L4.82 11.06a7.14 7.14 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.6.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54a7.3 7.3 0 0 0 1.62-.94l2.39.96c.2.1.47.01.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>
          </svg>
        </BarButton>

        {settingsOpen && (
          <SettingsPopover
            toggleShortcut={toggleShortcut}
            onChangeShortcut={onChangeShortcut}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>

      {/* ── Window controls (Windows / Linux only) ── */}
      {!isMac && (
        <div className="app-no-drag" style={{ display: 'flex', height: '100%', marginLeft: 6 }}>
          <WinControl title="Minimize" onClick={() => window.moodframe.minimizeWindow()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1"/></svg>
          </WinControl>
          <WinControl title={isMaximized ? 'Restore' : 'Maximize'} onClick={() => window.moodframe.maximizeToggle()}>
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="2.5" width="7" height="7"/>
                <path d="M2.5 2.5v-2h7v7h-2"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="0.5" width="9" height="9"/>
              </svg>
            )}
          </WinControl>
          <WinControl title="Close" danger onClick={() => window.moodframe.closeWindow()}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
              <line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/>
            </svg>
          </WinControl>
        </div>
      )}
    </header>
  );
}

// ── Settings popover ──────────────────────────────────────────────────────────

const DEFAULT_SHORTCUT = 'Alt+`';

function SettingsPopover({ toggleShortcut, onChangeShortcut, onClose }: {
  toggleShortcut: string;
  onChangeShortcut: (accel: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on click outside
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Capture keys while recording
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }

      const accel = eventToAccelerator(e);
      if (!accel) return; // modifier-only press or unmappable key — keep waiting

      setRecording(false);
      setError(null);
      const result = await onChangeShortcut(accel);
      if (!result.ok) setError(result.error ?? 'Could not bind shortcut');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onChangeShortcut]);

  const apply = async (accel: string) => {
    setError(null);
    const result = await onChangeShortcut(accel);
    if (!result.ok) setError(result.error ?? 'Could not bind shortcut');
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: TITLEBAR_HEIGHT - 2, right: 0,
        width: 260, padding: 14, borderRadius: 10, zIndex: 1100,
        background: '#1e1e1e',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)'
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 10
      }}>
        Settings
      </div>

      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 6 }}>
        Hide / show app shortcut
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => { setError(null); setRecording(true); }}
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 12,
            fontFamily: 'Consolas, monospace',
            background: recording ? 'rgba(124,110,245,0.2)' : 'rgba(255,255,255,0.07)',
            border: recording ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.12)',
            color: recording ? '#a89dfa' : 'var(--text)',
            textAlign: 'center'
          }}
        >
          {recording ? 'Press keys… (Esc to cancel)' : toggleShortcut}
        </button>
        <button
          title="Reset to default"
          onClick={() => apply(DEFAULT_SHORTCUT)}
          style={{
            padding: '6px 9px', borderRadius: 6, fontSize: 12,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)'
          }}
        >
          ↺
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.35)' }}>
        Works system-wide, even while the app is pinned on top or unfocused.
      </div>
    </div>
  );
}

// ── KeyboardEvent → Electron accelerator ─────────────────────────────────────

const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
};

/** Returns an Electron accelerator string, or null for modifier-only /
 *  unmappable presses. Requires at least one modifier unless it's an F-key. */
function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey)  mods.push('Ctrl');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey)  mods.push('Super');

  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c))        key = c.slice(3);
  else if (/^Digit\d$/.test(c))    key = c.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(c)) key = c;
  else if (CODE_TO_KEY[c])         key = CODE_TO_KEY[c];

  if (!key) return null;                              // modifier-only or unknown
  if (mods.length === 0 && !/^F\d+$/.test(key)) return null; // require a modifier
  return [...mods, key].join('+');
}

// ── Small round option button (pin) ──────────────────────────────────────────

function BarButton({ title, active, onClick, children }: {
  title: string; active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 22, borderRadius: 5,
        color: active ? '#a89dfa' : 'rgba(255,255,255,0.45)',
        background: active ? 'rgba(124,110,245,0.22)' : 'transparent',
        transition: 'background 0.12s, color 0.12s'
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

// ── Windows caption button (min / max / close) ───────────────────────────────

function WinControl({ title, danger, onClick, children }: {
  title: string; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: '100%',
        color: 'rgba(255,255,255,0.6)',
        transition: 'background 0.12s, color 0.12s'
      }}
      onMouseEnter={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = danger ? '#e81123' : 'rgba(255,255,255,0.09)';
        b.style.color = 'white';
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.background = 'transparent';
        b.style.color = 'rgba(255,255,255,0.6)';
      }}
    >
      {children}
    </button>
  );
}
