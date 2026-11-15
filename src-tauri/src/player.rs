use crate::{
    core::*,
    state::{self, State},
};
use serde_json::{json, Value};
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    ipc::{Channel, InvokeResponseBody, JavaScriptChannelId},
    Emitter,
};

const MAX_PACKET: usize = 512 * 1024 * 1024;
type EventSink = Arc<dyn Fn(Value) + Send + Sync>;
#[derive(Clone)]
struct ActiveVideo {
    id: String,
    frames: Channel<InvokeResponseBody>,
}
pub struct MediaEngine {
    child: Child,
    active: Arc<Mutex<Option<ActiveVideo>>>,
    closing: Arc<AtomicBool>,
    diagnostics: Arc<Mutex<Vec<u8>>>,
    log: PathBuf,
}
fn log(path: &Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}
fn read_packet(reader: &mut impl Read) -> Result<(u32, Vec<u8>)> {
    let mut header = [0u8; 12];
    reader.read_exact(&mut header).map_err(err)?;
    if &header[..4] != b"MFM1" {
        return Err("Media engine sent an unsupported protocol".into());
    }
    let kind = u32::from_le_bytes(header[4..8].try_into().unwrap());
    let length = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
    if ![1, 2].contains(&kind) || length > MAX_PACKET {
        return Err("Media engine sent an invalid packet".into());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(err)?;
    Ok((kind, bytes))
}
fn frame_session(bytes: &[u8]) -> Result<String> {
    let prefix: [u8; 4] = bytes
        .get(..4)
        .ok_or("Truncated video frame")?
        .try_into()
        .unwrap();
    let length = u32::from_le_bytes(prefix) as usize;
    if length > 65536 {
        return Err("Invalid frame metadata".into());
    }
    let metadata: Value =
        serde_json::from_slice(bytes.get(4..4 + length).ok_or("Truncated frame metadata")?)
            .map_err(err)?;
    metadata["session"]
        .as_str()
        .map(str::to_owned)
        .ok_or("Frame has no session".into())
}
impl MediaEngine {
    fn start(runtime: &Path, log_file: PathBuf, emit: EventSink) -> Result<Self> {
        log(
            &log_file,
            "Starting headless FrameViewer media engine (MFM1)",
        );
        let mut command = Command::new(runtime.join("MoodframeMedia.exe"));
        command
            .current_dir(runtime)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("QT_PLUGIN_PATH", runtime)
            .env("QT_FORCE_STDERR_LOGGING", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start media engine: {e}"))?;
        let mut output = child.stdout.take().ok_or("Cannot open media output")?;
        let mut stderr = child.stderr.take().ok_or("Cannot open media diagnostics")?;
        let active: Arc<Mutex<Option<ActiveVideo>>> = Arc::new(Mutex::new(None));
        let closing = Arc::new(AtomicBool::new(false));
        let diagnostics = Arc::new(Mutex::new(Vec::<u8>::new()));
        let stderr_text = diagnostics.clone();
        let stderr_log = log_file.clone();
        std::thread::spawn(move || {
            let mut chunk = [0; 4096];
            while let Ok(count) = stderr.read(&mut chunk) {
                if count == 0 {
                    break;
                }
                log(&stderr_log, &String::from_utf8_lossy(&chunk[..count]));
                let mut text = stderr_text.lock().unwrap();
                text.extend_from_slice(&chunk[..count]);
                if text.len() > 8192 {
                    let excess = text.len() - 8192;
                    text.drain(..excess);
                }
            }
        });
        let target = active.clone();
        let stopping = closing.clone();
        let wire_log = log_file.clone();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        std::thread::spawn(move || loop {
            let message = read_packet(&mut output);
            let (kind, body) = match message {
                Ok(value) => value,
                Err(error) => {
                    let _ = ready_tx.send(Err(error.clone()));
                    if !stopping.load(Ordering::Relaxed) {
                        log(&wire_log, &format!("Media output closed: {error}"));
                        if let Some(video) = target.lock().unwrap().clone() {
                            emit(
                                json!({"event":"error","session":video.id,"error":format!("Media engine stopped. Details: {}",wire_log.display())}),
                            );
                        }
                    }
                    break;
                }
            };
            if kind == 1 {
                let Ok(event) = serde_json::from_slice::<Value>(&body) else {
                    continue;
                };
                if event["event"] == "ready" {
                    let result = if event["protocol"] == 1 {
                        Ok(())
                    } else {
                        Err("Incompatible media engine version".into())
                    };
                    let _ = ready_tx.send(result);
                    continue;
                }
                let current = target.lock().unwrap().clone();
                if current.as_ref().is_some_and(|v| event["session"] == v.id) {
                    emit(event);
                }
            } else {
                let Ok(session) = frame_session(&body) else {
                    continue;
                };
                let current = target.lock().unwrap().clone();
                if let Some(video) = current.filter(|v| v.id == session) {
                    let _ = video.frames.send(InvokeResponseBody::Raw(body));
                }
            }
        });
        let mut engine = Self {
            child,
            active,
            closing,
            diagnostics,
            log: log_file,
        };
        match ready_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(())) => Ok(engine),
            reason => {
                let status = engine.child.try_wait().ok().flatten();
                let detail = String::from_utf8_lossy(&engine.diagnostics.lock().unwrap())
                    .trim()
                    .to_owned();
                let failure = format!(
                    "Media engine startup failed: {reason:?}; exit={status:?}. {detail} Log: {}",
                    engine.log.display()
                );
                log(&engine.log, &failure);
                engine.stop();
                Err(failure)
            }
        }
    }
    fn send(&mut self, message: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&message).map_err(err)?;
        bytes.push(b'\n');
        self.child
            .stdin
            .as_mut()
            .ok_or("Media engine control pipe is closed")?
            .write_all(&bytes)
            .map_err(err)
    }
    pub fn stop(&mut self) {
        self.closing.store(true, Ordering::Relaxed);
        self.active.lock().unwrap().take();
        let _ = self.send(json!({"type":"quit"}));
        self.child.stdin.take();
        let deadline = Instant::now() + Duration::from_millis(750);
        while Instant::now() < deadline {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub fn dispatch(
    app: &tauri::AppHandle,
    state: &State,
    window: &tauri::WebviewWindow,
    action: &str,
    args: &Value,
) -> Result<Value> {
    let session = args["session"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .ok_or("Missing video session")?;
    let mut slot = state.player.lock().unwrap();
    if action == "openVideo" {
        let path = state.checked(args["filePath"].as_str().ok_or("Missing video path")?)?;
        if media_type(&path) != Some("video") {
            return Err("Select a supported video".into());
        }
        let id: JavaScriptChannelId =
            serde_json::from_value(args["frames"].clone()).map_err(err)?;
        let view: &tauri::Webview = window.as_ref();
        let frames: Channel<InvokeResponseBody> = id.channel_on(view.clone());
        let running = slot
            .as_mut()
            .is_some_and(|engine| engine.child.try_wait().ok().flatten().is_none());
        if !running {
            if let Some(mut old) = slot.take() {
                old.stop();
            }
            let application = app.clone();
            let sink: EventSink = Arc::new(move |event| {
                let _ = application.emit("moodframe-media", event);
            });
            let logfile = state
                .file
                .parent()
                .ok_or("Missing app data directory")?
                .join("media-engine.log");
            *slot = Some(MediaEngine::start(&state::runtime(app)?, logfile, sink)?);
        }
        let engine = slot.as_mut().unwrap();
        *engine.active.lock().unwrap() = Some(ActiveVideo {
            id: session.into(),
            frames,
        });
        engine.send(json!({"type":"open","session":session,"path":display(&path)}))?;
        return Ok(Value::Null);
    }
    let Some(engine) = slot.as_mut() else {
        return Ok(Value::Null);
    };
    if !engine
        .active
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|v| v.id == session)
    {
        return Ok(Value::Null);
    }
    if action == "closeVideo" {
        engine.active.lock().unwrap().take();
        engine.send(json!({"type":"close","session":session}))?;
    } else if action == "ackVideo" {
        let packet = args["packet"]
            .as_str()
            .ok_or("Missing frame acknowledgement")?;
        engine.send(json!({"type":"ack","session":session,"packet":packet}))?;
    } else if action == "controlVideo" {
        let control = args["control"].as_str().ok_or("Missing playback control")?;
        if control == "fullscreen" {
            window
                .set_fullscreen(!window.is_fullscreen().map_err(err)?)
                .map_err(err)?;
            return Ok(Value::Null);
        }
        if ![
            "toggle",
            "pause",
            "step",
            "preview",
            "finishScrub",
            "volume",
            "loop",
        ]
        .contains(&control)
        {
            return Err("Unknown playback control".into());
        }
        let value = if control == "loop" {
            json!(args["value"].as_bool().ok_or("Invalid loop setting")?)
        } else if control == "volume" {
            json!(args["value"]
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or("Invalid volume")?
                .clamp(0., 1.))
        } else {
            json!(args["value"].as_i64().unwrap_or(0).clamp(-1, 100_000_000))
        };
        engine.send(json!({"type":"control","session":session,"control":control,"value":value}))?;
    } else {
        return Err("Unknown media command".into());
    }
    Ok(Value::Null)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wire_rejects_invalid_and_truncated_messages() {
        assert!(read_packet(&mut &b"bad"[..]).is_err());
        let mut bytes = b"MFM1".to_vec();
        bytes.extend(9u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        assert!(read_packet(&mut bytes.as_slice()).is_err());
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&((MAX_PACKET + 1) as u32).to_le_bytes());
        assert!(read_packet(&mut bytes.as_slice()).is_err());
    }
    #[test]
    fn binary_frame_metadata_keeps_session_and_pixel_payload() {
        let header = serde_json::to_vec(&json!({"session":"video-b"})).unwrap();
        let mut bytes = (header.len() as u32).to_le_bytes().to_vec();
        bytes.extend(header);
        bytes.extend([0, 128, 255]);
        assert_eq!(frame_session(&bytes).unwrap(), "video-b");
        assert!(frame_session(&bytes[..5]).is_err());
    }
    #[test]
    #[ignore = "Requires npm run build:player; runs the real production Rust-to-engine transport"]
    fn production_media_start_and_binary_channel() {
        let runtime =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/frameviewer/media-runtime");
        let directory = tempfile::tempdir().unwrap();
        let clip = directory.path().join("production transport.mp4");
        let output = Command::new(runtime.join("ffmpeg.exe"))
            .args([
                "-nostdin",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=24",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-t",
                "3",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
            ])
            .arg(&clip)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let (frames_tx, frames_rx) = mpsc::channel();
        let frames = Channel::new(move |body: InvokeResponseBody| {
            let _ = frames_tx.send(body);
            Ok(())
        });
        let mut engine = MediaEngine::start(
            &runtime,
            directory.path().join("engine.log"),
            Arc::new(|_| {}),
        )
        .unwrap();
        *engine.active.lock().unwrap() = Some(ActiveVideo {
            id: "production-test".into(),
            frames,
        });
        engine
            .send(json!({"type":"open","session":"production-test","path":display(&clip)}))
            .unwrap();
        let message = frames_rx
            .recv_timeout(Duration::from_secs(8))
            .expect("Production transport did not deliver a frame");
        let InvokeResponseBody::Raw(bytes) = message else {
            panic!("Frames must use the raw binary channel");
        };
        assert_eq!(frame_session(&bytes).unwrap(), "production-test");
        let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
        assert_eq!(header["format"], "yuv420");
        assert_eq!(bytes.len() - 4 - length, 640 * 360 * 3 / 2);
        engine
            .send(json!({"type":"ack","session":"production-test","packet":header["packet"]}))
            .unwrap();
        engine
            .send(json!({"type":"close","session":"production-test"}))
            .unwrap();
        engine.stop();
    }
}
