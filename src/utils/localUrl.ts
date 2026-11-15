import { convertFileSrc } from '@tauri-apps/api/core';

/** Tauri scoped asset protocol: image bytes never pass through JSON IPC. */
export function toLocalFileUrl(absPath: string): string {
  return convertFileSrc(absPath);
}
