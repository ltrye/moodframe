import { useEffect, useState } from 'react';

export default function ErrorNotice() {
  const [error, setError] = useState('');
  useEffect(() => {
    const listener = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('moodframe-error', listener);
    return () => window.removeEventListener('moodframe-error', listener);
  }, []);
  if (!error) return null;
  return <div role="alert" style={{ position: 'fixed', left: 24, bottom: 24, maxWidth: 600, padding: 16, background: '#38242b', border: '1px solid #9c5263', borderRadius: 10, zIndex: 2000 }}>
    {error} <button aria-label="Dismiss error" onClick={() => setError('')} style={{ marginLeft: 12 }}>×</button>
  </div>;
}
