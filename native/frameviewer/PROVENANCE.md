# Source provenance

Vendored from the original `trie_frameviewer` project at commit `d02f21a90fb937befa6fe8bfbda795b164e5af5d` (application 1.4.1).

`vendor/media/` contains only Decoder, VideoFrame, FrameCache, FrameRepository, PrefetchPlanner, MediaWorker, PlaybackTrace, and AudioEngine. `vendor/presentation/` contains VideoItem, YuvNode, and YUV shaders. `cmake/FindFFmpeg.cmake` is also reused. The cache/seek/prefetch engine is preserved. Moodframe adds `Decoder::close()` and an empty-path unload branch in MediaWorker so closing an embedded clip can release its cache and codec on the worker while keeping Qt warm. PlaybackTrace is an internal, opt-in trace dependency, without any diagnostic UI.

The lean Player adapter, windowless MediaService, Rust bridge, React controls, WebGL renderer, build scripts and tests are new in Moodframe. The prior Qt Quick window and embedding wrapper have been removed. Vendored presentation sources are retained only as reference for the browser color-conversion implementation and are not compiled or deployed. No original PlayerController, preferences, project schema, bookmarks, exporter, platform registration, or FrameViewer UI is built or copied.

The React UI and icon resources were copied from the user's Electron Moodboard source at commit `cb8d38d5e2d0df12c4cb6a4f896227b547bad6e3`, then adapted to Tauri.

The original project has no chosen source-code license. This extraction does not grant third-party redistribution rights. Distributing Qt and FFmpeg also requires including the applicable dependency licenses/notices and complying with the specific SDK builds' terms.
