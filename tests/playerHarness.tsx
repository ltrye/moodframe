import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImageOverlay from '../src/components/ImageOverlay';
import { decodeFrame, FrameRenderer } from '../src/media/frameRenderer';
import '../src/styles/global.css';

const callbacks = new Map<number, (value: unknown) => void>();
const listeners = new Map<number, string>();
let sequence = 0, active = '', channel = 0, channelIndex = 0;
const commands: Record<string, unknown>[] = [];
let state = { session: '', event: 'state', loaded: true, playing: false, frame: 0, frameCount: 72, fps: 24, aspect: 16/9, fileName: 'Animation reference.mp4', status: '640 × 360 · 24.00 fps', error: '', volume: .25, loop: true, cacheMiB: 42, ranges: [{ start: 0, end: 30 }, { start: 44, end: 71 }] };
function emit() { for (const [id, event] of listeners) if (event === 'moodframe-media') callbacks.get(id)?.({ event, id, payload: { ...state } }); }
function solidFrame(session: string, format: 'yuv420' | 'rgba' = 'rgba', identity = 'test-frame', rgba = [120, 90, 240, 255]) {
  const matrix = [1,1,1,0,0,-.344136,1.772,0,1.402,-.714136,0,0,-.703749,.531211,-.889475,1];
  const pixels = format === 'rgba' ? new Uint8Array(Array.from({ length: 16 }, () => rgba).flat()) : new Uint8Array([...Array(16).fill(100),...Array(4).fill(90),...Array(4).fill(200)]);
  const info = { session, packet: '1', identity, index: 0, width: 4, height: 4, format, matrix, planes: format === 'rgba' ? [{ width: 4, height: 4, stride: 16, length: 64 }] : [{ width: 4, height: 4, stride: 4, length: 16 }, { width: 2, height: 2, stride: 2, length: 4 }, { width: 2, height: 2, stride: 2, length: 4 }] };
  return packet(info, pixels);
}
function packet(info: unknown, pixels: Uint8Array) {
  const header = new TextEncoder().encode(JSON.stringify(info));
  const result = new Uint8Array(4 + header.length + pixels.length); new DataView(result.buffer).setUint32(0, header.length, true); result.set(header, 4); result.set(pixels, 4 + header.length); return result.buffer;
}
async function frame() {
  const current = active;
  const response = await fetch('/artifacts/native-frame.bin');
  let data: ArrayBuffer;
  if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
    const decoded = decodeFrame(await response.arrayBuffer());
    const pixels = new Uint8Array(decoded.planes.reduce((n, p) => n+p.byteLength,0)); let offset = 0;
    decoded.planes.forEach((p) => { pixels.set(p, offset); offset += p.length; });
    data = packet({ ...decoded.info, session: current, packet: String(channelIndex+1), index: state.frame }, pixels);
  } else throw new Error('Run the media backend tests first to generate artifacts/native-frame.bin');
  if (active === current) callbacks.get(channel)?.({ index: channelIndex++, message: data });
}
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) };
(window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: (callback: (value: unknown) => void) => { callbacks.set(++sequence, callback); return sequence; },
  unregisterCallback: (id: number) => callbacks.delete(id),
  invoke: async (command: string, args: any) => {
    if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler; }
    if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
    if (command !== 'request') return;
    const { action, args: value } = args;
    commands.push({ action, ...value, frames: undefined });
    if (action === 'openVideo') {
      active = value.session; state = { ...state, session: active, loaded: true, error: '' };
      channel = Number(value.frames.__TAURI_TO_IPC_KEY__().split(':')[1]); channelIndex = 0;
      setTimeout(() => { emit(); void frame(); }, 10);
    } else if (value.session === active && action === 'controlVideo') {
      if (value.control === 'toggle') state.playing = !state.playing;
      if (value.control === 'pause') state.playing = false;
      if (value.control === 'step') { state.frame += value.value; state.playing = false; }
      if (value.control === 'preview') state.frame = value.value;
      if (value.control === 'volume') state.volume = value.value;
      if (value.control === 'loop') state.loop = value.value;
      emit();
    } else if (action === 'closeVideo' && value.session === active) active = '';
  }
};
(window as any).mediaTest = { commands, solidFrame, decodeFrame, FrameRenderer, error: (error: string) => { state.error = error; emit(); } };
function Harness() {
  const [visible, setVisible] = useState(true);
  return <><h1 style={{ padding: 20 }}>Moodframe</h1><ImageOverlay images={['asset://localhost/reference.mp4']} filePaths={['D:/reference.mp4']} index={visible ? 0 : null} onClose={() => setVisible(false)} onNavigate={() => {}} /></>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
