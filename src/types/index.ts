/** One entry returned by scanFolder */
export interface FileEntry {
  name: string;
  type: 'image' | 'video';
}

export interface Board {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  customThumbnail?: string;  // absolute OS path to a user-chosen cover image
}

export type ImageSize   = 'small' | 'medium' | 'large' | 'custom';
export type BoardLayout = 'masonry' | 'grid';

/** Per-folder view settings, stored in that folder's .moodboard.json */
export interface ViewSettings {
  imageSize?: ImageSize;
  customSize?: number;   // card width as % of board width when imageSize === 'custom'
  layout?: BoardLayout;
  gridHeight?: number;   // grid cell height as % of cell width (default 75)
}

export interface BoardSettings {
  theme: ThemeType;
  customBg?: string;
  imageSize?: ImageSize;
  customSize?: number;   // card width as % of board width when imageSize === 'custom'
  layout?: BoardLayout;
}

/** A linked external folder shown as a group inside a board */
export interface FolderLink {
  name: string;
  path: string;
}

/** Unified group entry: a real subfolder or a linked external folder */
export interface GroupInfo {
  name: string;
  path: string;
  isLink: boolean;
}

export type ThemeType ='universe' | 'sky' | 'forest' | 'void' | 'paper' | 'custom';

export interface WindowPrefs {
  alwaysOnTop: boolean;
  toggleShortcut: string;
  isMaximized: boolean;
  platform: string;
}

export interface MoodframeAPI {
  // Window (custom title bar)
  getWindowPrefs: () => Promise<WindowPrefs>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  setToggleShortcut: (accel: string) => Promise<{ ok: boolean; error?: string }>;
  minimizeWindow: () => void;
  maximizeToggle: () => void;
  closeWindow: () => void;
  onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;

  openFolderDialog: () => Promise<string | null>;
  openImageDialog: () => Promise<string | null>;
  openWithDefaultApp: (filePath: string) => Promise<void>;
  readImageFiles: (folderPath: string) => Promise<string[]>;
  readSidecar: (folderPath: string) => Promise<string[]>;
  writeSidecar: (folderPath: string, order: string[]) => Promise<void>;
  getBoards: () => Promise<Board[]>;
  addBoard: (folderPath: string) => Promise<Board>;
  removeBoard:   (id: string) => Promise<void>;
  renameBoard:   (id: string, name: string) => Promise<void>;
  reorderBoards: (orderedIds: string[]) => Promise<void>;
  getBoardTheme: (id: string) => Promise<BoardSettings>;
  setBoardTheme: (id: string, theme: string, customBg?: string) => Promise<void>;
  setBoardThumbnail: (id: string, thumbnailPath: string | null) => Promise<void>;
  setBoardImageSize: (id: string, imageSize: string, customSize?: number) => Promise<void>;
  setBoardLayout: (id: string, layout: string) => Promise<void>;

  // Per-folder view settings
  readViewSettings:  (folderPath: string) => Promise<ViewSettings>;
  writeViewSettings: (folderPath: string, patch: ViewSettings) => Promise<void>;

  // Folder links (external folders shown as groups)
  readGroupLinks:  (folderPath: string) => Promise<FolderLink[]>;
  addGroupLink:    (folderPath: string, targetPath: string) => Promise<{ ok: boolean; error?: string; link?: FolderLink }>;
  removeGroupLink: (folderPath: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  renameGroupLink: (folderPath: string, oldName: string, newName: string) => Promise<{ ok: boolean; error?: string }>;

  // Groups (subfolders)
  readGroups:      (folderPath: string) => Promise<string[]>;
  createGroup:     (parentPath: string, name: string)           => Promise<{ ok: boolean; error?: string }>;
  moveFileToGroup: (filePath: string, targetFolderPath: string) => Promise<{ ok: boolean; error?: string }>;
  deleteGroup:     (groupPath: string)                          => Promise<{ ok: boolean; error?: string }>;
  renameGroup:     (groupPath: string, newName: string)         => Promise<{ ok: boolean; error?: string }>;

  // Thumbnails
  scanFolder:    (folderPath: string) => Promise<FileEntry[]>;
  getFirstMedia: (folderPath: string) => Promise<string | null>;
  /** Resolves with the absolute path of the cached thumbnail JPEG. */
  getThumbnail:  (filePath: string) => Promise<string>;
}

declare global {
  interface Window {
    moodframe: MoodframeAPI;
  }
}
