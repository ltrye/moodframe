# Performance and verification

The current player renders in Tauri's WebView and runs a windowless FrameViewer media backend. Earlier child-HWND/Qt Quick lifecycle measurements no longer describe this pipeline.

## Current behavior

- The backend starts lazily and stays warm for 30 seconds after media unload. Qt Quick/QML construction and native window parenting are removed.
- The original 512 MiB decoded frame repository, visited-frame reuse, direction-aware prefetch, exact committed seeks and 64 MiB audio cache remain in the media engine.
- YUV420 planes remain compact across the transport. WebGL2 uses the original FrameViewer color matrix; RGBA is the fallback for other formats. Pixel data is sent as binary, never JSON arrays/base64/JPEG.
- One frame can be in flight until React acknowledges rendering; one newer decoded result can wait behind it. This bounds queued pixel memory when the WebView is slower than decoding.
- Browser textures are cached within a nominal 96 MiB budget (at least one frame for an oversized source), and released when closing the overlay. Backend media/codec/cache cleanup happens on unload.
- Video overlay exit is 60 ms and native clip cleanup does not delay React unmounting.

This transport still copies frame bytes between processes/WebView and uploads new textures. It is not zero-copy GPU interop. Variable-rate clips, audio-device initialization, long GOPs, large files and high resolution/FPS may add latency. No end-to-end display-latency or 4K/120fps claim has been certified.

## Verification layers

1. C++ core tests verify bounded cache eviction and exact random seeks with preserved playback state.
2. `scripts/test_media_engine.py` starts the deployed backend using a clean PATH and no desktop windows. It checks the real versioned binary protocol, Unicode paths, first YUV frame layout, cache identity reuse, exact seek commits, warm reuse, old-session rejection, one-frame backpressure, clear decode errors and graceful exit. It also exports a generated binary frame for UI tests.
3. Rust tests validate packet bounds/truncation and the actual production process-to-raw-Tauri-channel path, including a generated silent audio/video clip. This covers the boundary that the prior Qt embedding tests missed.
4. Isolated headless Edge tests render the native-produced frame, exercise real React controls, verify YUV/RGBA shader colors and bounded texture memory, recreate the renderer on the same canvas, check responsive layouts, and ensure overlay cleanup/errors work. No desktop apps or browser tabs are controlled.

Build the backend, then run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
npm run test:media
npm run test:ui
```

Test reports, binary fixtures and PNG previews are generated under the ignored `artifacts/` folder. The original Qt child-window benchmark files are retained there as historical diagnostics only.
