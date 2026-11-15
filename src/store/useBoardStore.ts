import { create } from 'zustand';
import type { Board, BoardSettings } from '../types';

interface BoardStore {
  boards: Board[];
  boardSettings: Record<string, BoardSettings>;

  // Board CRUD
  loadBoards:    () => Promise<void>;
  addBoard:      (folderPath: string) => Promise<Board>;
  removeBoard:   (id: string) => Promise<void>;
  renameBoard:   (id: string, name: string) => Promise<void>;
  reorderBoards: (orderedIds: string[]) => Promise<void>;

  // Per-board theme
  loadBoardSettings: (boardId: string) => Promise<void>;
  setBoardTheme: (boardId: string, theme: string, customBg?: string) => Promise<void>;
  setBoardImageSize: (boardId: string, imageSize: BoardSettings['imageSize'], customSize?: number) => Promise<void>;
  setBoardLayout: (boardId: string, layout: BoardSettings['layout']) => Promise<void>;

  // Per-board custom thumbnail
  setBoardThumbnail: (boardId: string, thumbnailPath: string | null) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  boards: [],
  boardSettings: {},

  loadBoards: async () => {
    const boards = await window.moodframe.getBoards();
    set({ boards });
  },

  addBoard: async (folderPath: string) => {
    const board = await window.moodframe.addBoard(folderPath);
    set((s) => ({ boards: s.boards.some((b) => b.id === board.id) ? s.boards : [...s.boards, board] }));
    return board;
  },

  removeBoard: async (id: string) => {
    await window.moodframe.removeBoard(id);
    set((s) => ({
      boards: s.boards.filter((b) => b.id !== id),
      boardSettings: Object.fromEntries(
        Object.entries(s.boardSettings).filter(([k]) => k !== id)
      )
    }));
  },

  renameBoard: async (id: string, name: string) => {
    await window.moodframe.renameBoard(id, name);
    set((s) => ({
      boards: s.boards.map((b) => (b.id === id ? { ...b, name } : b))
    }));
  },

  reorderBoards: async (orderedIds: string[]) => {
    // Optimistic update first — dnd-kit removes transforms immediately on
    // dragEnd, so if we await the IPC round-trip first, items snap back
    // before the state change lands.
    set((s) => {
      const idOrder = new Map(orderedIds.map((id, i) => [id, i]));
      return {
        boards: [...s.boards].sort(
          (a, b) => (idOrder.get(a.id) ?? s.boards.length) - (idOrder.get(b.id) ?? s.boards.length)
        )
      };
    });
    // Persist to disk in the background
    await window.moodframe.reorderBoards(orderedIds);
  },

  loadBoardSettings: async (boardId: string) => {
    const settings = await window.moodframe.getBoardTheme(boardId);
    set((s) => ({
      boardSettings: { ...s.boardSettings, [boardId]: settings }
    }));
  },

  setBoardTheme: async (boardId: string, theme: string, customBg?: string) => {
    await window.moodframe.setBoardTheme(boardId, theme, customBg);
    set((s) => ({
      boardSettings: {
        ...s.boardSettings,
        [boardId]: { ...s.boardSettings[boardId], theme: theme as BoardSettings['theme'], customBg }
      }
    }));
  },

  setBoardImageSize: async (boardId: string, imageSize: BoardSettings['imageSize'], customSize?: number) => {
    // Optimistic: update the UI immediately, persist in the background
    set((s) => ({
      boardSettings: {
        ...s.boardSettings,
        [boardId]: { ...(s.boardSettings[boardId] ?? { theme: 'void' as const }), imageSize, customSize }
      }
    }));
    await window.moodframe.setBoardImageSize(boardId, imageSize!, customSize);
  },

  setBoardLayout: async (boardId: string, layout: BoardSettings['layout']) => {
    set((s) => ({
      boardSettings: {
        ...s.boardSettings,
        [boardId]: { ...(s.boardSettings[boardId] ?? { theme: 'void' as const }), layout }
      }
    }));
    await window.moodframe.setBoardLayout(boardId, layout!);
  },

  setBoardThumbnail: async (boardId: string, thumbnailPath: string | null) => {
    await window.moodframe.setBoardThumbnail(boardId, thumbnailPath);
    set((s) => ({
      boards: s.boards.map((b) => {
        if (b.id !== boardId) return b;
        const updated = { ...b };
        if (thumbnailPath) updated.customThumbnail = thumbnailPath;
        else delete updated.customThumbnail;
        return updated;
      })
    }));
  }
}));
