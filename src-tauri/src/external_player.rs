use crate::{core::*, state::State};
use std::path::{Path, PathBuf};

pub fn open(state: &State, file_path: &str) -> Result<()> {
    let path = video_path(state, file_path)?;
    // A dedicated thread guarantees a fresh COM apartment for shell handlers.
    std::thread::Builder::new()
        .name("external-video-player".into())
        .spawn(move || launch(&path))
        .map_err(err)?
        .join()
        .map_err(|_| "Unable to start the default video player".to_string())?
}

fn video_path(state: &State, file_path: &str) -> Result<PathBuf> {
    let path = state.checked(file_path)?;
    if !path.is_file() || media_type(&path) != Some("video") {
        return Err("Select a supported video file".into());
    }
    Ok(path)
}

#[cfg(windows)]
fn launch(path: &Path) -> Result<()> {
    use std::{mem, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };

    let file: Vec<u16> = Path::new(&display(path))
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Safety: called on a new thread, reserved pointer is null, and every
    // successful initialization below is balanced before the thread returns.
    let initialized = unsafe {
        CoInitializeEx(
            ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    if initialized < 0 {
        return Err(format!(
            "Unable to initialize the default video player ({initialized:#x})"
        ));
    }
    // All fields accept zero/null defaults. The UTF-16 path lives through the
    // synchronous call; no shell command, arguments, or URL are constructed.
    let mut info: SHELLEXECUTEINFOW = unsafe { mem::zeroed() };
    info.cbSize = mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
    info.lpVerb = windows_sys::w!("open");
    info.lpFile = file.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    let opened = unsafe { ShellExecuteExW(&mut info) };
    let error = std::io::Error::last_os_error();
    unsafe { CoUninitialize() };
    if opened == 0 {
        Err(format!("Could not open the default video player: {error}"))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn launch(_path: &Path) -> Result<()> {
    Err("Opening an external video player is currently supported on Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn external_player_accepts_only_selected_video_files() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let allowed = dir.path().join("allowed");
        fs::create_dir(&data).unwrap();
        fs::create_dir(&allowed).unwrap();
        atomic_json(
            &data.join("config.json"),
            &json!({"boards":[],"boardSettings":{}}),
        )
        .unwrap();
        let state = State::new(data, dir.path().join("cache")).unwrap();
        state
            .access
            .lock()
            .unwrap()
            .push((canonical(&allowed).unwrap(), true));
        let video = allowed.join("mây & reference's (1).MP4");
        fs::write(&video, b"fixture").unwrap();
        assert_eq!(
            video_path(&state, &display(&video)).unwrap(),
            canonical(&video).unwrap()
        );
        let outside = dir.path().join("outside.mp4");
        fs::write(&outside, b"fixture").unwrap();
        let executable = allowed.join("tool.exe");
        fs::write(&executable, b"fixture").unwrap();
        let folder = allowed.join("folder.mp4");
        fs::create_dir(&folder).unwrap();
        for rejected in [&outside, &executable, &folder, &allowed.join("missing.mp4")] {
            assert!(video_path(&state, &display(rejected)).is_err());
        }
        assert!(video_path(&state, "https://example.com/video.mp4").is_err());
    }
}
