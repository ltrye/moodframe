import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Home from './pages/Home';
import Board from './pages/Board';
import TitleBar from './components/TitleBar';
import ErrorNotice from './components/ErrorNotice';
import type { WindowPrefs } from './types';

export default function App() {
  const [prefs, setPrefs] = useState<WindowPrefs | null>(null);

  useEffect(() => {
    window.moodframe.getWindowPrefs().then(setPrefs);
    return window.moodframe.onMaximizedChanged((isMaximized) =>
      setPrefs((p) => (p ? { ...p, isMaximized } : p))
    );
  }, []);

  const toggleAlwaysOnTop = () => {
    if (!prefs) return;
    const next = !prefs.alwaysOnTop;
    setPrefs({ ...prefs, alwaysOnTop: next });
    window.moodframe.setAlwaysOnTop(next);
  };

  const changeShortcut = async (accel: string) => {
    const result = await window.moodframe.setToggleShortcut(accel);
    if (result.ok) setPrefs((p) => (p ? { ...p, toggleShortcut: accel } : p));
    return result;
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ErrorNotice />
      {prefs && (
        <TitleBar
          alwaysOnTop={prefs.alwaysOnTop}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          toggleShortcut={prefs.toggleShortcut}
          onChangeShortcut={changeShortcut}
          platform={prefs.platform}
          isMaximized={prefs.isMaximized}
        />
      )}

      {/* Pages fill the remaining space (their roots use height:100%) */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <HashRouter>
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/board/:id" element={<Board />} />
            </Routes>
          </AnimatePresence>
        </HashRouter>
      </div>
    </div>
  );
}
