export type MediaIconName = 'play' | 'pause' | 'previous' | 'next' | 'loop' | 'volume' | 'muted' | 'fullscreen';
export default function MediaIcon({ name }: { name: MediaIconName }) {
  const paths: Record<MediaIconName, React.ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: <path d="M7 5h3.5v14H7zm7 0h3.5v14H14z" fill="currentColor" stroke="none" />,
    previous: <><path d="M6 5v14" /><path d="m18 5-9 7 9 7Z" fill="currentColor" stroke="none" /></>,
    next: <><path d="M18 5v14" /><path d="m6 5 9 7-9 7Z" fill="currentColor" stroke="none" /></>,
    loop: <path d="M5 9V6h14v4m-3-3 3 3 3-3M19 15v3H5v-4m-3 3 3-3 3 3" />,
    volume: <><path d="M3 9h4l5-4v14l-5-4H3Z" /><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="M3 9h4l5-4v14l-5-4H3Z" /><path d="m17 9 5 6m0-6-5 6" /></>,
    fullscreen: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
