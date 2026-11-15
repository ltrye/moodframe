import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBoardStore } from '../store/useBoardStore';
import BoardCard from '../components/BoardCard';
import ThemeBackground from '../components/ThemeBackground';
import ThemePicker from '../components/ThemePicker';
import type { Board, ThemeType } from '../types';

const PAGE_VARIANTS = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 }
};

// Reserved key so the home page can reuse the existing board-settings IPC
// (store:getBoardTheme / store:setBoardTheme) without any new backend code.
const HOME_ID = '__home__';

// ── SortableBoardCard ─────────────────────────────────────────────────────────
// Thin wrapper that adds dnd-kit sortable behaviour to BoardCard.
// The wrapper div owns the drag transform; BoardCard's own motion.div
// keeps its layout / enter / exit animations untouched.

function SortableBoardCard({ board }: { board: Board }) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging
  } = useSortable({ id: board.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform:  CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity:    isDragging ? 0.35 : 1,
        position:   'relative',
        zIndex:     isDragging ? 1 : 0
      }}
      {...attributes}
      {...listeners}
    >
      <BoardCard board={board} />
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const boards            = useBoardStore((s) => s.boards);
  const loadBoards        = useBoardStore((s) => s.loadBoards);
  const addBoard          = useBoardStore((s) => s.addBoard);
  const reorderBoards     = useBoardStore((s) => s.reorderBoards);
  const boardSettings     = useBoardStore((s) => s.boardSettings);
  const loadBoardSettings = useBoardStore((s) => s.loadBoardSettings);
  const setBoardTheme     = useBoardStore((s) => s.setBoardTheme);

  const homeSettings = boardSettings[HOME_ID];
  const currentTheme = (homeSettings?.theme ?? 'void') as ThemeType;

  const [themeOpen, setThemeOpen] = useState(false);
  const [activeId,  setActiveId]  = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => { loadBoards(); },               []);
  useEffect(() => { loadBoardSettings(HOME_ID); }, []);

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handleDragStart = ({ active }: DragStartEvent) =>
    setActiveId(active.id as string);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = boards.findIndex((b) => b.id === active.id);
    const newIdx = boards.findIndex((b) => b.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    reorderBoards(arrayMove(boards, oldIdx, newIdx).map((b) => b.id));
  };

  const activeBoard = boards.find((b) => b.id === activeId) ?? null;

  // ── New board ───────────────────────────────────────────────────────────────
  const handleNewBoard = async () => {
    const folderPath = await window.moodframe.openFolderDialog();
    if (!folderPath) return;
    await addBoard(folderPath);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={PAGE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden'
      }}
    >
      <ThemeBackground theme={currentTheme} customBg={homeSettings?.customBg} />

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 28px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(16px)',
        position: 'relative', zIndex: 10, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{
            fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #fff 30%, #a89cf7 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            Moodframe
          </h1>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
            {boards.length} {boards.length === 1 ? 'board' : 'boards'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setThemeOpen((o) => !o)}
            title="Change home theme"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 7,
              background: themeOpen ? 'rgba(124,110,245,0.25)' : 'rgba(255,255,255,0.07)',
              border:     themeOpen ? '1px solid rgba(124,110,245,0.5)' : '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text)', fontSize: 13, cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s'
            }}
          >
            🎨 Theme
          </button>

          <button
            onClick={handleNewBoard}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8,
              background: 'var(--accent)', color: 'white',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.15s, transform 0.1s', border: 'none'
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)')}
            onMouseDown={(e)  => ((e.currentTarget as HTMLButtonElement).style.transform  = 'scale(0.97)')}
            onMouseUp={(e)    => ((e.currentTarget as HTMLButtonElement).style.transform  = 'scale(1)')}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            New Moodboard
          </button>
        </div>
      </header>

      <ThemePicker
        open={themeOpen}
        current={currentTheme}
        onClose={() => setThemeOpen(false)}
        onSelect={(theme, customBg) => setBoardTheme(HOME_ID, theme, customBg)}
      />

      {/* Board grid */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '24px 28px',
        position: 'relative', zIndex: 5
      }}>
        {boards.length === 0 ? (
          <EmptyState onNew={handleNewBoard} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={boards.map((b) => b.id)}
              strategy={rectSortingStrategy}
            >
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16
              }}>
                <AnimatePresence>
                  {boards.map((board) => (
                    <SortableBoardCard key={board.id} board={board} />
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>

            {/* Ghost card shown under the cursor while dragging */}
            <DragOverlay dropAnimation={{ duration: 160, easing: 'ease' }}>
              {activeBoard && (
                <div style={{
                  pointerEvents: 'none',
                  transform: 'scale(1.03)',
                  transformOrigin: 'top left',
                  filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.55))'
                }}>
                  <BoardCard board={activeBoard} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </motion.div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '60vh', gap: 16,
        color: 'var(--text-muted)', textAlign: 'center'
      }}
    >
      <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 4 }}>🎨</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
        No moodboards yet
      </h2>
      <p style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.6 }}>
        Pick a folder of images to create your first moodboard.
      </p>
      <button
        onClick={onNew}
        style={{
          marginTop: 8, padding: '10px 22px', borderRadius: 9,
          background: 'var(--surface2)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', transition: 'background 0.15s'
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#2e2e2e')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)')}
      >
        + Pick a folder
      </button>
    </motion.div>
  );
}
