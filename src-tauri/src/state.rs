use crate::{core::*, thumbnails::Thumbnails};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

pub struct State {
    pub config: Mutex<Value>,
    pub file: PathBuf,
    pub access: Mutex<Vec<(PathBuf, bool)>>,
    pub io: Mutex<()>,
    pub thumbnails: Thumbnails,
    pub player: Mutex<Option<crate::player::MediaEngine>>,
}
impl State {
    pub fn new(data: PathBuf, cache: PathBuf) -> Result<Self> {
        fs::create_dir_all(&data).map_err(err)?;
        let file = data.join("config.json");
        let mut config = read_json(
            &file,
            json!({"boards":[],"boardSettings":{},"windowPrefs":{"alwaysOnTop":false,"toggleShortcut":"Alt+`"}}),
        )?;
        if !file.exists() {
            if let Some(old) = legacy_config() {
                // Import a copy. Never write the Electron application's config.
                config = read_json(&old, config)?;
                config["importedFrom"] = json!(display(&old));
            }
            atomic_json(&file, &config)?;
        }
        if !config["boards"].is_array() || !config["boardSettings"].is_object() {
            return Err("Invalid Moodframe configuration".into());
        }
        if !config["windowPrefs"].is_object() {
            config["windowPrefs"] = json!({"alwaysOnTop":false,"toggleShortcut":"Alt+`"});
        }
        Ok(Self {
            config: Mutex::new(config),
            file,
            access: Mutex::new(Vec::new()),
            io: Mutex::new(()),
            thumbnails: Thumbnails::new(cache.join("thumbnail-cache"))?,
            player: Mutex::new(None),
        })
    }
    pub fn save(&self, edit: impl FnOnce(&mut Value) -> Result<Value>) -> Result<Value> {
        let mut config = self.config.lock().unwrap();
        let mut next = config.clone();
        let result = edit(&mut next)?;
        atomic_json(&self.file, &next)?;
        *config = next;
        Ok(result)
    }
    pub fn grant(&self, app: &tauri::AppHandle, path: &Path, directory: bool) -> Result<PathBuf> {
        let path = canonical(path)?;
        if directory {
            app.asset_protocol_scope()
                .allow_directory(&path, true)
                .map_err(err)?;
        } else {
            app.asset_protocol_scope().allow_file(&path).map_err(err)?;
        }
        let mut access = self.access.lock().unwrap();
        if !access.iter().any(|(p, d)| p == &path && *d == directory) {
            access.push((path.clone(), directory));
        }
        Ok(path)
    }
    pub fn checked(&self, path: &str) -> Result<PathBuf> {
        let path = canonical(path)?;
        if !self
            .access
            .lock()
            .unwrap()
            .iter()
            .any(|(root, dir)| path == *root || (*dir && path.starts_with(root)))
        {
            return Err("Choose this folder or file with the Moodframe picker first".into());
        }
        Ok(path)
    }
    pub fn restore_access(&self, app: &tauri::AppHandle) -> Result<()> {
        self.grant(app, &self.thumbnails.folder, true)?;
        let config = self.config.lock().unwrap().clone();
        self.boards(app);
        for board in config["boards"].as_array().unwrap() {
            if let Some(p) = board["customThumbnail"].as_str() {
                if Path::new(p).is_file() {
                    if let Err(error) = self.grant(app, Path::new(p), false) {
                        eprintln!("Skipping unavailable board cover: {error}");
                    }
                }
            }
        }
        for settings in config["boardSettings"].as_object().unwrap().values() {
            if let Some(p) = settings["customBg"].as_str() {
                if Path::new(p).is_file() {
                    if let Err(error) = self.grant(app, Path::new(p), false) {
                        eprintln!("Skipping unavailable board background: {error}");
                    }
                }
            }
        }
        Ok(())
    }
    pub fn boards(&self, app: &tauri::AppHandle) -> Value {
        // Clone before touching the filesystem; unavailable boards remain saved.
        let boards = self.config.lock().unwrap()["boards"].clone();
        available_boards(boards, |path| self.grant(app, path, true).map(|_| ()))
    }
    pub fn close_player(&self) {
        if let Some(mut player) = self.player.lock().unwrap().take() {
            player.stop();
        }
    }
}
fn available_boards(boards: Value, mut grant: impl FnMut(&Path) -> Result<()>) -> Value {
    Value::Array(
        boards
            .as_array()
            .unwrap()
            .iter()
            .filter(|board| {
                board["folderPath"].as_str().is_some_and(|path| {
                    let path = Path::new(path);
                    readable_folder(path) && grant(path).is_ok()
                })
            })
            .cloned()
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_boards_are_hidden_without_changing_saved_entries() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let denied = dir.path().join("denied");
        let offline = dir.path().join("offline");
        let last = dir.path().join("last");
        for folder in [&first, &denied, &last] {
            fs::create_dir(folder).unwrap();
        }
        let file = dir.path().join("file");
        fs::write(&file, b"not a folder").unwrap();
        let saved = json!([
            {"id":"first","folderPath":first},
            {"id":"denied","folderPath":denied,"customThumbnail":"keep.jpg"},
            {"id":"offline","folderPath":offline},
            {"id":"file","folderPath":file},
            {"id":"last","folderPath":last}
        ]);
        let visible = available_boards(saved.clone(), |path| {
            if path == denied {
                Err(err(std::io::Error::from(
                    std::io::ErrorKind::PermissionDenied,
                )))
            } else {
                Ok(())
            }
        });
        assert_eq!(visible, json!([saved[0], saved[4]]));
        assert_eq!(saved.as_array().unwrap().len(), 5);
        assert_eq!(saved[1]["customThumbnail"], "keep.jpg");

        // Access restored and a drive/folder reconnected: both reappear in order.
        fs::create_dir(&offline).unwrap();
        let restored = available_boards(saved.clone(), |_| Ok(()));
        assert_eq!(restored, json!([saved[0], saved[1], saved[2], saved[4]]));
    }
}
fn legacy_config() -> Option<PathBuf> {
    let roaming = std::env::var_os("APPDATA")?;
    ["moodframe", "Moodframe", "moodboard", "Moodboard"]
        .iter()
        .map(|n| PathBuf::from(&roaming).join(n).join("config.json"))
        .find(|p| p.is_file())
}
pub fn runtime(app: &tauri::AppHandle) -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let dev =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../native/frameviewer/media-runtime");
        if dev.join("MoodframeMedia.exe").exists() {
            return Ok(dev);
        }
    }
    let bundled = app.path().resource_dir().map_err(err)?.join("media");
    if bundled.join("MoodframeMedia.exe").exists() {
        return Ok(bundled);
    }
    Err("Media backend is missing. Keep the bundled media folder beside Moodframe.exe, or run npm run build:player in development.".into())
}
