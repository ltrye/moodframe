import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  rectIntersection,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import Masonry from 'react-masonry-css';
import { useBoardStore } from '../store/useBoardStore';
import SortableImage from '../components/SortableImage';
import GroupCard from '../components/GroupCard';
import ImageOverlay from '../components/ImageOverlay';
import ThemePicker from '../components/ThemePicker';
import ThemeBackground from '../components/ThemeBackground';
import type { ThemeType, GroupInfo, ImageSize, BoardLayout, ViewSettings } from '../types';
import { toLocalFileUrl } from '../utils/localUrl';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 }
};

// Target card width (px) per image-size setting; column count is derived
// from the window width. 'medium' matches the old breakpoint behaviour.
const SIZE_TARGETS: Record<Exclude<ImageSize, 'custom'>, number> = {
  small: 220, medium: 340, large: 500
};
// Custom size is a percentage of the board width (one card ≈ N% wide)
const CUSTOM_PCT_MIN = 8;
const CUSTOM_PCT_MAX = 50;
const CUSTOM_PCT_DEFAULT = 20;

// Grid cell height as % of cell width
const GRID_HEIGHT_MIN = 40;
const GRID_HEIGHT_MAX = 160;
const GRID_HEIGHT_DEFAULT = 75;

const BATCH = 60;

function toLocalURL(folderPath: string, filename: string): string {
  return toLocalFileUrl(folderPath + '/' + filename);
}

// ── Custom collision detection ─────────────────────────────────────────────────
// Group cards (useDroppable) take priority over sortable file items.
// When the dragged rect intersects a group card, return that group;
// otherwise fall back to closestCenter for normal file-to-file sorting.
const collisionDetection: CollisionDetection = (args) => {
  const intersecting = rectIntersection(args);
  const groupHit = intersecting.find((c) => c.id.toString().startsWith('__group:'));
  if (groupHit) return [groupHit];
  return closestCenter(args);
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const boards            = useBoardStore((s) => s.boards);
  const boardSettings     = useBoardStore((s) => s.boardSettings);
  const loadBoardSettings = useBoardStore((s) => s.loadBoardSettings);
  const setBoardTheme     = useBoardStore((s) => s.setBoardTheme);

  const board    = boards.find((b) => b.id === id);
  const settings = id ? boardSettings[id] : undefined;

  // ── Group navigation ──────────────────────────────────────────────────────
  // Stack of entered groups: [] = board root, last entry = current folder.
  // Groups can nest arbitrarily deep (subfolders of subfolders, links too).
  const [groupStack, setGroupStack] = useState<GroupInfo[]>([]);
  const currentGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1] : null;

  // ── File + group lists ────────────────────────────────────────────────────
  const [images,       setImages]      = useState<string[]>([]);
  const [groups,       setGroups]      = useState<GroupInfo[]>([]);
  const [visibleCount, setVisible]     = useState(0);
  const [filesLoaded,  setFilesLoaded] = useState(false);

  // ── Per-folder view settings (image size / layout, stored in sidecar) ─────
  const [viewSettings, setViewSettings] = useState<ViewSettings>({});

  // ── Drag state ────────────────────────────────────────────────────────────
  const [activeId,        setActiveId]        = useState<string | null>(null);
  const [dragTargetGroup, setDragTargetGroup] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [overlayIndex,  setOverlayIndex]  = useState<number | null>(null);
  const [themeOpen,      setThemeOpen]      = useState(false);
  const [settingsOpen,   setSettingsOpen]   = useState(false);
  const [creatingGroup,  setCreatingGroup]  = useState(false);
  const [newGroupName,   setNewGroupName]   = useState('');
  const [groupMenuOpen,  setGroupMenuOpen]  = useState(false);
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // ── Current folder path ───────────────────────────────────────────────────
  const currentFolderPath = board
    ? (currentGroup ? currentGroup.path : board.folderPath)
    : '';

  // ── Load files + groups ───────────────────────────────────────────────────
  useEffect(() => {
    if (!board || !currentFolderPath) return;
    setFilesLoaded(false);
    setImages([]);
    setGroups([]);
    setVisible(0);

    let cancelled = false;

    (async () => {
      // 1. Fast scan — returns file list with type info; no thumbnail work yet.
      //    Render skeleton cards immediately from this.
      const [fileEntries, savedOrder, view] = await Promise.all([
        window.moodframe.scanFolder(currentFolderPath),
        window.moodframe.readSidecar(currentFolderPath),
        window.moodframe.readViewSettings(currentFolderPath)
      ]);
      if (cancelled) return;
      setViewSettings(view ?? {});

      // Groups at every level: real subfolders + this folder's linked folders
      const [subfolders, links] = await Promise.all([
        window.moodframe.readGroups(currentFolderPath),
        window.moodframe.readGroupLinks(currentFolderPath)
      ]);
      const groupInfos: GroupInfo[] = [
        ...subfolders.map((name) => ({
          name, path: `${currentFolderPath}\\${name}`, isLink: false
        })),
        ...links.map((l) => ({ name: l.name, path: l.path, isLink: true }))
      ];
      if (cancelled) return;

      const files    = fileEntries.map((e) => e.name);
      const savedSet = new Set(savedOrder);
      const allSet   = new Set(files);
      const merged   = [
        ...savedOrder.filter((f) => allSet.has(f)),
        ...files.filter((f) => !savedSet.has(f))
      ];
      setImages(merged);
      setGroups(groupInfos);
      setVisible(BATCH);
      setFilesLoaded(true);

      // Thumbnails are fetched lazily per-card (useThumbnail hook) as items
      // scroll near the viewport — no eager batch work for large folders.
    })();

    return () => { cancelled = true; };
  }, [currentFolderPath]);

  // ── Progressive reveal ────────────────────────────────────────────────────
  useEffect(() => {
    if (!filesLoaded || visibleCount >= images.length) return;
    const tid = setTimeout(
      () => setVisible((c) => Math.min(c + BATCH, images.length)),
      60
    );
    return () => clearTimeout(tid);
  }, [filesLoaded, visibleCount, images.length]);

  // ── Load theme ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (id) loadBoardSettings(id);
  }, [id]);

  // ── Masonry columns from image-size setting ───────────────────────────────
  // Measure the real content area (not window.innerWidth) so columns always
  // fit without horizontal scrolling, scrollbar and padding included.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(window.innerWidth - 32);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBoardWidth(el.clientWidth - 32);   // minus 16px padding each side
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [filesLoaded]);

  const imageSize = viewSettings.imageSize ?? 'medium';
  const layout    = viewSettings.layout ?? 'masonry';
  // customSize is stored as % of board width (older configs stored px — ignore those)
  const stored     = viewSettings.customSize;
  const customPct  = stored != null && stored <= CUSTOM_PCT_MAX ? stored : CUSTOM_PCT_DEFAULT;
  const targetWidth = imageSize === 'custom'
    ? boardWidth * (customPct / 100)
    : SIZE_TARGETS[imageSize];
  const masonryCols = Math.max(1, Math.round(boardWidth / targetWidth));
  // Exact grid cell height (user-set aspect, 12px gaps) for content-visibility sizing
  const gridHeightPct = viewSettings.gridHeight ?? GRID_HEIGHT_DEFAULT;
  const gridCellH = Math.round(
    ((boardWidth - 12 * (masonryCols - 1)) / masonryCols) * (gridHeightPct / 100)
  );

  const changeView = useCallback((patch: ViewSettings) => {
    setViewSettings((prev) => ({ ...prev, ...patch }));
    window.moodframe.writeViewSettings(currentFolderPath, patch);
  }, [currentFolderPath]);

  // ── Derived arrays ────────────────────────────────────────────────────────
  const imageURLs = useMemo(
    () => images.map((f) => toLocalURL(currentFolderPath, f)),
    [images, currentFolderPath]
  );
  const filePaths = useMemo(
    () => images.map((f) => `${currentFolderPath}\\${f}`),
    [images, currentFolderPath]
  );
  const shownImages = useMemo(() => images.slice(0, visibleCount), [images, visibleCount]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDragTargetGroup(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id?.toString() ?? '';
    setDragTargetGroup(
      overId.startsWith('__group:') ? overId.slice('__group:'.length) : null
    );
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      setDragTargetGroup(null);
      const { active, over } = event;
      if (!over || !board) return;

      const overId     = over.id.toString();
      const sourceFile = active.id as string;

      // Drop onto a group card → move file to that folder
      if (overId.startsWith('__group:')) {
        const groupName = overId.slice('__group:'.length);
        const group = groups.find((g) => g.name === groupName);
        if (!group) return;
        const result = await window.moodframe.moveFileToGroup(
          `${currentFolderPath}\\${sourceFile}`,
          group.path
        );
        if (result.ok) {
          setImages((prev) => {
            const next = prev.filter((f) => f !== sourceFile);
            window.moodframe.writeSidecar(currentFolderPath, next);
            return next;
          });
          // Refresh group card thumbnails/counts
          setGroups((g) => [...g]);
        } else {
          alert(result.error);
        }
        return;
      }

      // Normal reorder
      if (active.id === over.id) return;
      setImages((prev) => {
        const oldIndex = prev.indexOf(sourceFile);
        const newIndex = prev.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        window.moodframe.writeSidecar(currentFolderPath, next);
        return next;
      });
    },
    [board, currentFolderPath, groups]
  );

  // ── Group CRUD ────────────────────────────────────────────────────────────
  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name || !board) return;
    const result = await window.moodframe.createGroup(currentFolderPath, name);
    if (result.ok) {
      setGroups((prev) => [...prev, {
        name, path: `${currentFolderPath}\\${name}`, isLink: false
      }]);
      setNewGroupName('');
      setCreatingGroup(false);
    } else {
      alert(result.error);
    }
  };

  const handleLinkGroup = async () => {
    if (!board) return;
    const targetPath = await window.moodframe.openFolderDialog();
    if (!targetPath) return;
    const result = await window.moodframe.addGroupLink(currentFolderPath, targetPath);
    if (result.ok && result.link) {
      setGroups((prev) => [...prev, { ...result.link!, isLink: true }]);
    } else {
      alert(result.error);
    }
  };

  const handleDeleteGroup = async (group: GroupInfo) => {
    if (!board) return;
    // Links are just removed from the board — the target folder is untouched
    const result = group.isLink
      ? await window.moodframe.removeGroupLink(currentFolderPath, group.name)
      : await window.moodframe.deleteGroup(group.path);
    if (result.ok) setGroups((prev) => prev.filter((g) => g.name !== group.name));
    else alert(result.error);
  };

  const handleRenameGroup = async (group: GroupInfo, newName: string) => {
    if (!board) return;
    const result = group.isLink
      ? await window.moodframe.renameGroupLink(currentFolderPath, group.name, newName)
      : await window.moodframe.renameGroup(group.path, newName);
    if (result.ok) {
      const newPath = group.isLink ? group.path : `${currentFolderPath}\\${newName}`;
      setGroups((prev) => prev.map((g) =>
        g.name === group.name ? { ...g, name: newName, path: newPath } : g
      ));
    } else {
      alert(result.error);
    }
  };

  const navigateBack = () => {
    setOverlayIndex(null);
    if (groupStack.length > 0) setGroupStack((s) => s.slice(0, -1));
    else navigate('/');
  };

  // ── Misc ──────────────────────────────────────────────────────────────────
  const activeURL    = activeId ? imageURLs[images.indexOf(activeId)] : null;
  const currentTheme = (settings?.theme ?? 'void') as ThemeType;

  if (!board) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column',
        gap: 12, color: 'var(--text-muted)'
      }}>
        <p>Board not found.</p>
        <button onClick={() => navigate('/')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
          ← Back to home
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={PAGE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.22 }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden' }}
    >
      <ThemeBackground theme={currentTheme} customBg={settings?.customBg} />

      {/* ── Toolbar ── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(16px)',
        position: 'relative', zIndex: 10, flexShrink: 0
      }}>
        <button
          onClick={navigateBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer', transition: 'background 0.15s'
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)')}
        >
          ← {groupStack.length > 1
              ? groupStack[groupStack.length - 2].name
              : groupStack.length === 1 ? board.name : 'Back'}
        </button>

        {/* Breadcrumb title */}
        <div style={{
          flex: 1, fontSize: 14, fontWeight: 600,
          color: 'rgba(255,255,255,0.9)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          {groupStack.length > 0 ? (
            <>
              <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>{board.name}</span>
              {groupStack.map((g, i) => {
                const isLast = i === groupStack.length - 1;
                return (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>›</span>
                    <span style={isLast ? undefined : { color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}>
                      {g.name}
                    </span>
                    {g.isLink && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                    )}
                  </span>
                );
              })}
            </>
          ) : board.name}
        </div>

        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {images.length} {images.length === 1 ? 'item' : 'items'}
        </span>

        {/* New Group dropdown — available at every folder level */}
        {(
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setGroupMenuOpen((o) => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 11px', borderRadius: 7,
                background: groupMenuOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--text)', fontSize: 13, cursor: 'pointer', transition: 'background 0.15s'
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)')}
              onMouseLeave={(e) => { if (!groupMenuOpen) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" opacity={0.65}>
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              New Group
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity={0.6}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>

            {groupMenuOpen && (
              <GroupMenu
                onClose={() => setGroupMenuOpen(false)}
                onCreate={() => {
                  setGroupMenuOpen(false);
                  setCreatingGroup(true);
                  setTimeout(() => newGroupInputRef.current?.focus(), 50);
                }}
                onLink={() => {
                  setGroupMenuOpen(false);
                  handleLinkGroup();
                }}
              />
            )}
          </div>
        )}

        <button
          onClick={() => setSettingsOpen(true)}
          title="Moodboard settings"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer', transition: 'background 0.15s'
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)')}
        >
          ⚙ Settings
        </button>

        <button
          onClick={() => setThemeOpen((o) => !o)}
          title="Change theme"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7,
            background: themeOpen ? 'rgba(124,110,245,0.25)' : 'rgba(255,255,255,0.07)',
            border: themeOpen ? '1px solid rgba(124,110,245,0.5)' : '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text)', fontSize: 13, cursor: 'pointer',
            transition: 'background 0.15s, border-color 0.15s'
          }}
        >
          🎨 Theme
        </button>
      </header>

      <ThemePicker
        open={themeOpen}
        current={currentTheme}
        onClose={() => setThemeOpen(false)}
        onSelect={(theme, customBg) => { if (id) setBoardTheme(id, theme, customBg); }}
      />

      {/* ── Content ── */}
      <div ref={contentRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px',
        position: 'relative', zIndex: 5
      }}>
        {!filesLoaded ? (
          <LoadingGrid />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {/* ── Groups section (any folder level) ── */}
            {(groups.length > 0 || creatingGroup) && (
              <section style={{ marginBottom: 20 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10
                }}>
                  <span style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.28)',
                    textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600
                  }}>
                    Groups
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 12
                }}>
                  {groups.map((g) => (
                    <GroupCard
                      key={g.name}
                      name={g.name}
                      folderPath={g.path}
                      isLink={g.isLink}
                      onClick={() => { setOverlayIndex(null); setGroupStack((s) => [...s, g]); }}
                      onRename={(newName) => handleRenameGroup(g, newName)}
                      onDelete={() => handleDeleteGroup(g)}
                    />
                  ))}
                  {creatingGroup && (
                    <NewGroupCard
                      inputRef={newGroupInputRef}
                      value={newGroupName}
                      onChange={setNewGroupName}
                      onConfirm={handleCreateGroup}
                      onCancel={() => { setCreatingGroup(false); setNewGroupName(''); }}
                    />
                  )}
                </div>
              </section>
            )}

            {/* ── Files masonry ── */}
            {images.length === 0 && groups.length === 0 && !creatingGroup ? (
              <EmptyBoard folderPath={currentFolderPath} />
            ) : images.length > 0 ? (
              <>
                <SortableContext items={shownImages} strategy={rectSortingStrategy}>
                  {layout === 'masonry' ? (
                    <Masonry
                      breakpointCols={masonryCols}
                      className="masonry-grid"
                      columnClassName="masonry-col"
                    >
                      {shownImages.map((filename, i) => (
                        <SortableImage
                          key={filename}
                          id={filename}
                          filePath={filePaths[i]}
                          index={i}
                          onOpen={setOverlayIndex}
                        />
                      ))}
                    </Masonry>
                  ) : (
                    /* Uniform grid: every image is a same-sized cell */
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${masonryCols}, 1fr)`,
                      gap: 12
                    }}>
                      {shownImages.map((filename, i) => (
                        <SortableImage
                          key={filename}
                          id={filename}
                          filePath={filePaths[i]}
                          index={i}
                          onOpen={setOverlayIndex}
                          uniform
                          cellHeight={gridCellH}
                          heightPct={gridHeightPct}
                        />
                      ))}
                    </div>
                  )}
                </SortableContext>

                {filesLoaded && visibleCount < images.length && (
                  <div style={{
                    textAlign: 'center', padding: '20px 0 8px',
                    fontSize: 12, color: 'rgba(255,255,255,0.25)'
                  }}>
                    {visibleCount} / {images.length}
                  </div>
                )}
              </>
            ) : null}

            {/* ── Drag overlay ── */}
            <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
              {activeId && activeURL && (
                <div style={{
                  borderRadius: 8, overflow: 'hidden', opacity: 0.9,
                  boxShadow: '0 24px 60px rgba(0,0,0,0.7)', lineHeight: 0,
                  maxWidth: 260, position: 'relative'
                }}>
                  {/\.(mp4|webm|mov|avi|mkv|m4v)/i.test(activeURL) ? (
                    <video src={activeURL} muted preload="metadata"
                      style={{ width: '100%', height: 'auto', display: 'block' }} />
                  ) : (
                    <img src={activeURL} alt=""
                      style={{ width: '100%', height: 'auto', display: 'block' }} draggable={false} />
                  )}
                  {/* "Move to group" hint banner */}
                  {dragTargetGroup && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(124,110,245,0.88)',
                      backdropFilter: 'blur(6px)',
                      padding: '5px 8px',
                      fontSize: 11, fontWeight: 600, color: 'white',
                      display: 'flex', alignItems: 'center', gap: 5
                    }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="white">
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                      </svg>
                      Move to {dragTargetGroup}
                    </div>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {settingsOpen && (
        <BoardViewSettingsModal
          imageSize={imageSize}
          customPct={customPct}
          layout={layout}
          gridHeightPct={gridHeightPct}
          onChangeSize={(size, custom) => changeView({ imageSize: size, customSize: custom })}
          onChangeLayout={(l) => changeView({ layout: l })}
          onChangeGridHeight={(h) => changeView({ gridHeight: h })}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ImageOverlay
        images={imageURLs}
        filePaths={filePaths}
        index={overlayIndex}
        onClose={() => setOverlayIndex(null)}
        onNavigate={setOverlayIndex}
      />
    </motion.div>
  );
}

// ── BoardViewSettingsModal ─────────────────────────────────────────────────────

function BoardViewSettingsModal({
  imageSize, customPct, layout, gridHeightPct,
  onChangeSize, onChangeLayout, onChangeGridHeight, onClose
}: {
  imageSize:          ImageSize;
  customPct:          number;
  layout:             BoardLayout;
  gridHeightPct:      number;
  onChangeSize:       (size: ImageSize, customPct?: number) => void;
  onChangeLayout:     (layout: BoardLayout) => void;
  onChangeGridHeight: (heightPct: number) => void;
  onClose:            () => void;
}) {
  const [sliderVal, setSliderVal] = useState(customPct);
  const [heightVal, setHeightVal] = useState(gridHeightPct);

  const options: Array<{ value: ImageSize; label: string; hint: string }> = [
    { value: 'small',  label: 'Small',  hint: 'More columns' },
    { value: 'medium', label: 'Medium', hint: 'Default' },
    { value: 'large',  label: 'Large',  hint: 'Fewer, bigger cards' },
    { value: 'custom', label: 'Custom', hint: 'Pick exact size' }
  ];

  const layouts: Array<{ value: BoardLayout; label: string; hint: string }> = [
    { value: 'masonry', label: 'Masonry', hint: 'Organic Pinterest style' },
    { value: 'grid',    label: 'Grid',    hint: 'Uniform rows' }
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14, padding: 22, width: 340,
          boxShadow: '0 24px 80px rgba(0,0,0,0.75)'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18
        }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
              View Settings
            </h2>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Applies to the current folder only
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
            </svg>
          </button>
        </div>

        <label style={{
          fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em',
          textTransform: 'uppercase', display: 'block', marginBottom: 10
        }}>
          Image size
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {options.map((opt) => {
            const active = imageSize === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onChangeSize(opt.value, opt.value === 'custom' ? sliderVal : undefined)}
                style={{
                  padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                  background: active ? 'rgba(124,110,245,0.18)' : 'rgba(255,255,255,0.05)',
                  border: active ? '1px solid rgba(124,110,245,0.6)' : '1px solid rgba(255,255,255,0.08)',
                  transition: 'background 0.15s, border-color 0.15s'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#a89dfa' : 'var(--text)' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.hint}</div>
              </button>
            );
          })}
        </div>

        {imageSize === 'custom' && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 6
            }}>
              <span>Card width (% of board)</span>
              <span style={{ color: 'var(--text)' }}>{sliderVal}%</span>
            </div>
            <input
              type="range"
              min={CUSTOM_PCT_MIN}
              max={CUSTOM_PCT_MAX}
              step={1}
              value={sliderVal}
              onChange={(e) => setSliderVal(Number(e.target.value))}
              onMouseUp={() => onChangeSize('custom', sliderVal)}
              onKeyUp={() => onChangeSize('custom', sliderVal)}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
        )}

        <label style={{
          fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em',
          textTransform: 'uppercase', display: 'block', margin: '18px 0 10px'
        }}>
          Layout
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {layouts.map((opt) => {
            const active = layout === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onChangeLayout(opt.value)}
                style={{
                  padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                  background: active ? 'rgba(124,110,245,0.18)' : 'rgba(255,255,255,0.05)',
                  border: active ? '1px solid rgba(124,110,245,0.6)' : '1px solid rgba(255,255,255,0.08)',
                  transition: 'background 0.15s, border-color 0.15s'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#a89dfa' : 'var(--text)' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.hint}</div>
              </button>
            );
          })}
        </div>

        {layout === 'grid' && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 6
            }}>
              <span>Image height (% of card width)</span>
              <span style={{ color: 'var(--text)' }}>{heightVal}%</span>
            </div>
            <input
              type="range"
              min={GRID_HEIGHT_MIN}
              max={GRID_HEIGHT_MAX}
              step={5}
              value={heightVal}
              onChange={(e) => setHeightVal(Number(e.target.value))}
              onMouseUp={() => onChangeGridHeight(heightVal)}
              onKeyUp={() => onChangeGridHeight(heightVal)}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── GroupMenu (New Group dropdown) ─────────────────────────────────────────────

function GroupMenu({ onClose, onCreate, onLink }: {
  onClose: () => void;
  onCreate: () => void;
  onLink: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9,
    width: '100%', padding: '8px 12px',
    fontSize: 13, color: 'var(--text)', textAlign: 'left',
    transition: 'background 0.12s'
  };
  const hover = (e: React.MouseEvent, on: boolean) =>
    ((e.currentTarget as HTMLButtonElement).style.background = on ? 'rgba(255,255,255,0.08)' : 'transparent');

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: 'calc(100% + 6px)', right: 0,
        width: 200, padding: 4, borderRadius: 9, zIndex: 50,
        background: '#1e1e1e',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 14px 40px rgba(0,0,0,0.6)'
      }}
    >
      <button style={itemStyle} onClick={onCreate}
        onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" opacity={0.6}>
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        Create group
      </button>
      <button style={itemStyle} onClick={onLink}
        onMouseEnter={(e) => hover(e, true)} onMouseLeave={(e) => hover(e, false)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={0.6}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        Link group…
      </button>
    </div>
  );
}

// ── NewGroupCard ───────────────────────────────────────────────────────────────

function NewGroupCard({ inputRef, value, onChange, onConfirm, onCancel }: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(124,110,245,0.08)',
      border: '1px dashed rgba(124,110,245,0.4)',
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ paddingTop: '62%', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="rgba(124,110,245,0.45)">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
        </div>
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', gap: 6 }}>
        <input
          ref={inputRef}
          value={value}
          placeholder="Group name…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  onConfirm();
            if (e.key === 'Escape') onCancel();
            e.stopPropagation();
          }}
          style={{
            flex: 1, minWidth: 0,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid var(--accent)',
            borderRadius: 5, padding: '4px 8px',
            fontSize: 12, color: 'var(--text)', outline: 'none'
          }}
        />
        <button
          onClick={onConfirm}
          disabled={!value.trim()}
          style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600,
            background: value.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            color: value.trim() ? 'white' : 'rgba(255,255,255,0.3)',
            border: 'none', cursor: value.trim() ? 'pointer' : 'default',
            transition: 'background 0.15s'
          }}
        >
          ✓
        </button>
      </div>
    </div>
  );
}

// ── LoadingGrid / EmptyBoard ───────────────────────────────────────────────────

function LoadingGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{
          borderRadius: 8,
          background: 'rgba(255,255,255,0.05)',
          paddingTop: `${55 + Math.random() * 40}%`,
          animation: 'pulse 1.5s ease-in-out infinite',
          animationDelay: `${i * 0.06}s`
        }} />
      ))}
    </div>
  );
}

function EmptyBoard({ folderPath }: { folderPath: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: 12,
      color: 'rgba(255,255,255,0.4)', textAlign: 'center'
    }}>
      <div style={{ fontSize: 44 }}>📂</div>
      <p style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>
        No images found
      </p>
      <p style={{ fontSize: 12, maxWidth: 300, lineHeight: 1.6 }}>
        Add images (.jpg .png .gif .webp .svg) or videos (.mp4 .webm .mov .mkv) to
      </p>
      <code style={{
        fontSize: 11, background: 'rgba(255,255,255,0.07)',
        padding: '4px 10px', borderRadius: 5,
        maxWidth: '80vw', wordBreak: 'break-all'
      }}>
        {folderPath}
      </code>
    </div>
  );
}
