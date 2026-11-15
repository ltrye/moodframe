# Moodframe

Current version: **1.0.0**. Windows folder-based moodboards built with **Tauri 2, Rust, React and TypeScript**.

Browse images and videos as Pinterest-style boards, reorder cards, move media between groups, link external folders, customize covers/themes, and choose masonry/grid layouts. Thumbnails load lazily from a Rust disk cache. Existing Electron `.moodboard.json` ordering, groups and view settings remain compatible.

## Video player

The player is entirely inside the **Tauri WebView**: React controls, timeline, keyboard shortcuts and a WebGL2 canvas. It reuses the actual FrameViewer FFmpeg decoder, bounded YUV frame cache, prefetch, frame stepping and scrub audio through a **windowless C++ media backend**. No Qt Quick/QML controls, native child window, HWND parenting, or external-player buttons are used.

The backend still bundles Qt Core/Gui/Multimedia because the reused code uses Qt data types, images, timers and audio. Qt does not provide the player UI. Rust launches `media/MoodframeMedia.exe` without a console or GUI window, validates its versioned binary protocol, and sends frames to React through raw Tauri channels. No image base64 or JPEG encoding occurs during playback.

All visual controls belong to React. Space toggles playback, Left/Right step frames, right-drag scrubs, F11 toggles Moodframe fullscreen, and Escape closes the overlay. Seeking preserves playing/paused state. Closing releases the clip and browser texture cache; the empty backend stays warm for up to 30 seconds, then exits.

Budgets: 512 MiB decoded RAM cache, 96 MiB WebGL texture cache, 64 MiB initial audio cache. Only one frame can be in transit until the renderer acknowledges it; a slow WebView keeps only the latest pending decoded frame.

See [the architecture notes](docs/migration.md) and [performance/validation notes](docs/player-performance.md).

## Development

Requires Windows x64, Rust 1.90+, Node.js 20+, WebView2, Python, CMake 3.24+, MSVC C++ tools, Qt 6.8.3 Core/Gui/Multimedia/Test, and an FFmpeg SDK.

The build uses the existing SDKs in the sibling `trie_frameviewer/.tools/` checkout without changing that project. On another workstation set `QT_ROOT` and `FFMPEG_ROOT`, or `FRAMEVIEWER_SOURCE`. The script defaults to Visual Studio 18 2026.

```powershell
npm install
npm run build:player
npm run dev
```

Create a Windows installer and collect a separate test build:

```powershell
npm run build:app
npm run package:test -- --label tauri-player
```

The collected portable app is `out/Moodframe-v1.0.0-tauri-player/Moodframe.exe`; keep its `media/` folder beside it. The installer is also collected under `out/`. End users need WebView2; the installer can bootstrap it. Qt, FFmpeg, Rust and Node require no separate installation. Generated dependencies, builds and EXEs are excluded from Git.

`CARGO_TARGET_DIR` can point to another drive. The packaging command respects it; otherwise Cargo output is under `src-tauri/target/`.

Use `npm run build:release` to rebuild only the Tauri app after the native runtime is ready. Release scripts remap local home/workspace paths in Rust diagnostics before compilation; do not use a raw `tauri build` for published binaries. Local configuration, board sidecars, credentials, caches, logs and generated binaries are excluded from Git.

## Verification without desktop control

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
npm run test:media
npm run test:ui
```

Build the native runtime first. Native tests cover cache bounds, exact/random seeks, paused/playing scrubbing, Unicode media paths, cold/warm startup, stale-session isolation, bounded frame delivery, decode errors and shutdown. The Rust production regression test uses the real process and raw channel rather than a GUI embedding test.

UI tests launch an isolated **headless Edge** instance and use a native-generated binary frame. They check React controls, shader YUV/RGBA colors, texture cache bounds, Strict Mode cleanup, responsive layouts, keyboard and error display. PNG previews are saved in `artifacts/tauri-player-controls.png` and `artifacts/tauri-player-compact.png`. They never automate a user's desktop browser or app windows.

## Existing data and caching

On first launch, Moodframe copies the old Electron board list/settings from the first existing `%APPDATA%/{moodframe,Moodframe,moodboard,Moodboard}/config.json`. The original config stays unchanged. Tauri stores its config under the app-data directory for `com.moodframe.desktop`.

Folders that cannot be listed (including access-denied or disconnected folders) are hidden from boards, subfolder groups and linked-folder lists. Saved boards and links remain intact and reappear on the next list load after access is restored.

Existing `.moodboard.json` files work directly: `order`, `links`, `view` and unknown fields survive atomic updates. Invalid JSON is reported and preserved. Both apps share board sidecars, so avoid editing the same board simultaneously in both.

Thumbnail cache: Tauri app-cache directory / `thumbnail-cache`. Keys include canonical path, source size, timestamp and cache version. Four generation jobs run concurrently; per-key locks deduplicate requests. Rust handles images/SVG, and bundled FFmpeg handles video stills. Image bytes load through Tauri's scoped asset protocol outside JSON IPC. The disk cache currently has no automatic size limit.

The media startup/error log is `media-engine.log` beside the new app's `config.json`. Startup failures include diagnostic details and the log path.

## Current limits

Variable-frame-rate stepping uses nominal FPS. Audio covers only the initial 64 MiB; reverse playback is not included. HDR/OCIO, filesystem watchers, complete board virtualization and disk-cache eviction are not implemented. The WebView renderer adds binary frame copies and texture uploads; this is not zero-copy decoder/GPU sharing, and high-resolution/high-FPS performance needs separate profiling.

The original local projects have no chosen source license. See `native/frameviewer/PROVENANCE.md`; applicable Qt/FFmpeg redistribution terms still apply.
