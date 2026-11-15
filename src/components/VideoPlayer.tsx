import { useEffect, useRef, useState } from 'react';
import { Channel } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useIsPresent } from 'framer-motion';
import { request } from '../bridge';
import { decodeFrame, FrameRenderer } from '../media/frameRenderer';
import MediaIcon, { type MediaIconName } from './MediaIcon';
import '../styles/mediaPlayer.css';

interface MediaState {
  session: string; event: string; loaded: boolean; playing: boolean; frame: number; frameCount: number;
  fps: number; aspect: number; fileName: string; status: string; error: string;
  volume: number; loop: boolean; cacheMiB: number; ranges: { start: number; end: number }[];
}
const initialState: MediaState = { session: '', event: 'state', loaded: false, playing: false, frame: 0, frameCount: 0, fps: 24, aspect: 16/9, fileName: '', status: 'Opening video…', error: '', volume: .25, loop: true, cacheMiB: 0, ranges: [] };
function timecode(frame: number, fps: number) {
  const seconds = Math.max(0, frame) / Math.max(1, fps);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
function IconButton({ icon, label, onClick, disabled = false, primary = false, pressed }: { icon: MediaIconName; label: string; onClick: () => void; disabled?: boolean; primary?: boolean; pressed?: boolean }) {
  return <button type="button" className={`media-button${primary ? ' primary' : ''}${pressed ? ' active' : ''}`} title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><MediaIcon name={icon} /></button>;
}

/** All player UI and frame rendering live in the Tauri WebView. */
export default function VideoPlayer({ filePath }: { filePath: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const present = useIsPresent();
  const [state, setState] = useState<MediaState>(initialState);
  const latest = useRef(state); latest.current = state;
  const [error, setError] = useState('');
  const [hasFrame, setHasFrame] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const previewFrame = useRef<number | null>(null);
  const previewAnimation = useRef(0);
  const rightDrag = useRef<{ x: number; frame: number } | null>(null);
  const lastVolume = useRef(.25);
  const send = useRef<(control: string, value?: number | boolean) => Promise<unknown>>(() => Promise.resolve());

  useEffect(() => {
    const element = canvas.current;
    if (!element || !present) return;
    const session = crypto.randomUUID();
    let active = true;
    let renderFailed = false;
    let paint = 0;
    let renderer: FrameRenderer | undefined;
    let stopListening: (() => void) | undefined;
    let controls: Promise<unknown> = Promise.resolve();
    setState(initialState); setError(''); setHasFrame(false); setDraft(null);
    const control = (name: string, value?: number | boolean) => {
      const call = () => active ? request('controlVideo', { session, control: name, value: value ?? null }) : Promise.resolve();
      const next = controls.then(call, call);
      controls = next.catch((reason) => { if (active) setError(String(reason)); });
      return controls;
    };
    send.current = control;
    const frames = new Channel<ArrayBuffer>();
    frames.onmessage = (buffer) => {
      if (!active) return;
      try {
        const frame = decodeFrame(buffer);
        if (frame.info.session !== session) return;
        if (renderFailed) { void request('ackVideo', { session, packet: frame.info.packet }).catch(() => {}); return; }
        paint = requestAnimationFrame(() => {
          if (!active) return;
          try { renderer?.draw(frame); setHasFrame(true); }
          catch (reason) { renderFailed = true; setError(String(reason)); void control('pause'); }
          finally { void request('ackVideo', { session, packet: frame.info.packet }).catch(() => {}); }
        });
      } catch (reason) { setError(String(reason)); void control('pause'); }
    };
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('button,input,textarea,select') && event.key !== 'F11') return;
      const name = event.code === 'Space' ? 'toggle' : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 'step' : event.key === 'F11' ? 'fullscreen' : null;
      if (!name || (!latest.current.loaded && name !== 'fullscreen') || (event.repeat && name !== 'step')) return;
      event.preventDefault(); void control(name, event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', keyboard);
    void (async () => {
      renderer = new FrameRenderer(element);
      const unlisten = await listen<MediaState>('moodframe-media', ({ payload }) => {
        if (!active || payload.session !== session) return;
        if (payload.error) setError(payload.error);
        if (payload.event === 'state') setState(payload);
      });
      if (!active) { unlisten(); return; }
      stopListening = unlisten;
      await request('openVideo', { filePath, session, frames });
    })().catch((reason) => { if (active) setError(String(reason)); });
    return () => {
      active = false; cancelAnimationFrame(paint); cancelAnimationFrame(previewAnimation.current);
      previewFrame.current = null; rightDrag.current = null;
      window.removeEventListener('keydown', keyboard); stopListening?.();
      frames.onmessage = () => {}; renderer?.dispose();
      void request('closeVideo', { session }).catch(() => {});
    };
  }, [filePath, present]);

  const preview = (value: number) => {
    const target = Math.max(0, Math.min(latest.current.frameCount - 1, Math.round(value)));
    setDraft(target); previewFrame.current = target;
    if (!previewAnimation.current) previewAnimation.current = requestAnimationFrame(() => {
      previewAnimation.current = 0;
      if (previewFrame.current !== null) void send.current('preview', previewFrame.current);
    });
  };
  const commit = () => {
    cancelAnimationFrame(previewAnimation.current); previewAnimation.current = 0;
    if (previewFrame.current !== null) {
      const target = previewFrame.current; previewFrame.current = null;
      void send.current('preview', target); void send.current('finishScrub');
      setState((current) => ({ ...current, frame: target }));
    }
    setDraft(null);
  };
  const frame = draft ?? state.frame;
  const progress = state.frameCount > 1 ? frame / (state.frameCount - 1) * 100 : 0;
  const volume = (value: number) => { setState((current) => ({ ...current, volume: value })); void send.current('volume', value); };
  const mute = () => { if (state.volume > 0) { lastVolume.current = state.volume; volume(0); } else volume(lastVolume.current || .25); };
  return <section className="media-player" aria-label="Video player" onClick={(event) => event.stopPropagation()}>
    <div className="media-stage" tabIndex={0} aria-label="Video. Space to play or pause, arrows to step, right-drag to scrub." onDoubleClick={() => void send.current('toggle')} onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => { if (event.button === 2 && state.loaded) { event.preventDefault(); rightDrag.current = { x: event.clientX, frame: latest.current.frame }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={(event) => { if (rightDrag.current) preview(rightDrag.current.frame + (event.clientX - rightDrag.current.x) / 3); }}
      onPointerUp={(event) => { if (rightDrag.current) { rightDrag.current = null; commit(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => { rightDrag.current = null; commit(); }}>
      <canvas key={filePath} ref={canvas} width={1} height={1} aria-label="Video frame" />
      {error ? <div role="alert" className="media-message error">{error}</div> : !hasFrame ? <div role="status" className="media-message"><span className="media-spinner" />Loading video…</div> : null}
    </div>
    <div className="media-transport">
      <div className="media-heading">
        <div className="media-description"><div className="media-filename" title={state.fileName}>{state.fileName || filePath.split(/[\\/]/).pop()}</div><div className="media-metadata">{error ? 'Playback unavailable' : state.status}</div></div>
        <div className="media-time">{timecode(frame, state.fps)} / {timecode(state.frameCount, state.fps)}</div>
      </div>
      <div className="media-timeline">
        <div className="media-timeline-track">{state.ranges.map((range) => <span key={range.start} className="media-cache-range" style={{ left: `${range.start / Math.max(1, state.frameCount) * 100}%`, width: `${(range.end - range.start + 1) / Math.max(1, state.frameCount) * 100}%` }} />)}<span className="media-played" style={{ width: `${progress}%` }} /></div>
        <input type="range" aria-label="Video timeline" min={0} max={Math.max(1, state.frameCount - 1)} step={1} value={frame} disabled={!state.loaded} onChange={(event) => preview(Number(event.target.value))} onPointerUp={commit} onPointerCancel={commit} onBlur={commit} onKeyUp={(event) => { if (['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key)) commit(); }} />
      </div>
      <div className="media-controls">
        <IconButton icon="previous" label="Previous frame (Left)" disabled={!state.loaded} onClick={() => void send.current('step', -1)} />
        <IconButton primary icon={state.playing ? 'pause' : 'play'} label={state.playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!state.loaded} onClick={() => void send.current('toggle')} />
        <IconButton icon="next" label="Next frame (Right)" disabled={!state.loaded} onClick={() => void send.current('step', 1)} />
        <span className="media-control-divider" />
        <IconButton icon="loop" label="Loop playback" pressed={state.loop} onClick={() => { setState((current) => ({ ...current, loop: !current.loop })); void send.current('loop', !state.loop); }} />
        <div className="media-volume"><IconButton icon={state.volume > 0 ? 'volume' : 'muted'} label={state.volume > 0 ? 'Mute' : 'Unmute'} onClick={mute} /><input type="range" aria-label="Volume" min={0} max={1} step={.01} value={state.volume} style={{ '--volume': `${state.volume * 100}%` } as React.CSSProperties} onChange={(event) => volume(Number(event.target.value))} /><span className="media-volume-value">{Math.round(state.volume * 100)}%</span></div>
        <span className="media-controls-spacer" /><span className="media-frame-number">Frame {state.loaded ? frame + 1 : 0} / {state.frameCount}</span><span className="media-cache-badge">{state.cacheMiB.toFixed(0)} MB cached</span>
        <IconButton icon="fullscreen" label="Toggle fullscreen (F11)" onClick={() => void send.current('fullscreen')} />
      </div>
    </div>
  </section>;
}
