import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MoodframeAPI } from './types';

let playerQueue: Promise<unknown> = Promise.resolve();
export function request<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const execute = () => invoke<T>('request', { action, args });
  if (!['openVideo', 'closeVideo'].includes(action)) return execute();
  const next = playerQueue.then(execute, execute);
  playerQueue = next.catch(() => undefined);
  return next;
}
const call = (action: string, keys: string[] = []) => (...values: unknown[]) =>
  request(action, Object.fromEntries(keys.map((key, i) => [key, values[i] ?? null])));
const methods: Record<string, string[]> = {
  getWindowPrefs: [], setAlwaysOnTop: ['value'], setToggleShortcut: ['accel'],
  minimizeWindow: [], maximizeToggle: [], closeWindow: [],
  openFolderDialog: [], openImageDialog: [], openWithDefaultApp: ['filePath'],
  readImageFiles: ['folderPath'], scanFolder: ['folderPath'], getFirstMedia: ['folderPath'],
  readSidecar: ['folderPath'], writeSidecar: ['folderPath', 'order'],
  getThumbnail: ['filePath'],
  getBoards: [], addBoard: ['folderPath'], removeBoard: ['id'], renameBoard: ['id', 'name'],
  reorderBoards: ['orderedIds'], getBoardTheme: ['id'],
  setBoardTheme: ['id', 'theme', 'customBg'], setBoardThumbnail: ['id', 'thumbnailPath'],
  setBoardImageSize: ['id', 'imageSize', 'customSize'], setBoardLayout: ['id', 'layout'],
  readViewSettings: ['folderPath'], writeViewSettings: ['folderPath', 'patch'],
  readGroupLinks: ['folderPath'], addGroupLink: ['folderPath', 'targetPath'],
  removeGroupLink: ['folderPath', 'name'], renameGroupLink: ['folderPath', 'oldName', 'newName'],
  readGroups: ['folderPath'], createGroup: ['parentPath', 'name'],
  moveFileToGroup: ['filePath', 'targetFolderPath'], deleteGroup: ['groupPath'],
  renameGroup: ['groupPath', 'newName']
};
const api: Record<string, any> = Object.fromEntries(Object.entries(methods).map(([name, keys]) => [name, call(name, keys)]));
api.onMaximizedChanged = (callback: (maximized: boolean) => void) => {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  void getCurrentWindow().onResized(async () => {
    const maximized = await getCurrentWindow().isMaximized();
    if (!cancelled) callback(maximized);
  }).then((stop) => { if (cancelled) stop(); else unlisten = stop; });
  return () => { cancelled = true; unlisten?.(); };
};
window.moodframe = api as MoodframeAPI;
function reportError(error: unknown) {
  window.dispatchEvent(new CustomEvent('moodframe-error', { detail: String(error) }));
}
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  reportError(event.reason);
});
