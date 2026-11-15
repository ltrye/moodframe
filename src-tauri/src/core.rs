use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn read_json(path: &Path, default: Value) -> Result<Value> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "Cannot read {}: {e}. The file has been preserved.",
                path.display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(default),
        Err(e) => Err(err(e)),
    }
}
pub fn atomic_json(path: &Path, value: &Value) -> Result<()> {
    let mut tmp =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing parent")?).map_err(err)?;
    tmp.write_all(&serde_json::to_vec_pretty(value).map_err(err)?)
        .map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    tmp.persist(path).map_err(err)?;
    Ok(())
}
pub fn sidecar(folder: &Path) -> Result<Value> {
    let mut data = read_json(&folder.join(".moodboard.json"), json!({}))?;
    if !data.is_object() {
        return Err("The moodboard sidecar must contain an object".into());
    }
    if data.get("order").is_none() {
        data["order"] = json!([]);
    }
    if data.get("links").is_none() {
        data["links"] = json!([]);
    }
    if data.get("view").is_none() {
        data["view"] = json!({});
    }
    if !data["order"].is_array() || !data["links"].is_array() || !data["view"].is_object() {
        return Err("Invalid moodboard sidecar; no changes were written".into());
    }
    Ok(data)
}
pub fn leaf(name: &str) -> Result<&str> {
    if name.trim().is_empty()
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("Use a valid folder name without path separators".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err("That name is reserved by Windows".into());
    }
    let mut parts = Path::new(name).components();
    if !matches!(parts.next(), Some(Component::Normal(_))) || parts.next().is_some() {
        return Err("Invalid name".into());
    }
    Ok(name)
}
pub fn media_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "webm" | "mov" | "avi" | "mkv" | "m4v" => Some("video"),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff" => Some("image"),
        _ => None,
    }
}
pub fn readable_folder(folder: &Path) -> bool {
    // Probe enumeration, not just metadata: a directory can exist but deny listing.
    // Inspect the first result too, since enumeration errors may be deferred.
    fs::read_dir(folder)
        .and_then(|mut entries| entries.next().transpose())
        .is_ok()
}
pub fn scan(folder: &Path, groups: bool) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(folder).map_err(err)? {
        let entry = entry.map_err(err)?;
        let kind = entry.file_type().map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if if groups {
            kind.is_dir() && !name.starts_with('.') && readable_folder(&entry.path())
        } else {
            kind.is_file() && media_type(&entry.path()).is_some()
        } {
            names.push(name);
        }
    }
    names.sort_by_key(|s| s.to_lowercase());
    Ok(names)
}
pub fn canonical(path: impl AsRef<Path>) -> Result<PathBuf> {
    fs::canonicalize(path).map_err(err)
}
pub fn display(path: &Path) -> String {
    // Avoid verbatim Windows paths in WebView URLs and config portability.
    let p = path.to_string_lossy();
    if let Some(unc) = p.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        p.strip_prefix("\\\\?\\").unwrap_or(&p).into()
    }
}
pub fn delete_empty_group(path: &Path) -> Result<()> {
    // Do not recursively delete: unknown files and nested folders must survive.
    let entries: Vec<_> = fs::read_dir(path)
        .map_err(err)?
        .collect::<std::io::Result<_>>()
        .map_err(err)?;
    if entries.iter().any(|e| {
        e.file_name() != ".moodboard.json" || !e.file_type().map(|t| t.is_file()).unwrap_or(false)
    }) {
        return Err("Group is not empty. Move its files and subfolders first.".into());
    }
    let metadata = path.join(".moodboard.json");
    if metadata.exists() {
        let data = sidecar(path)?;
        if !data["links"].as_array().unwrap().is_empty() {
            return Err("Remove linked folders first".into());
        }
        fs::remove_file(metadata).map_err(err)?;
    }
    fs::remove_dir(path).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sidecar_preserves_legacy_fields_and_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".moodboard.json");
        atomic_json(&path, &json!({"order":["mây.jpg"],"links":[{"name":"ref","path":"D:/ref"}],"view":{"layout":"grid"},"future":42})).unwrap();
        let mut data = sidecar(dir.path()).unwrap();
        data["order"] = json!(["new.png"]);
        atomic_json(&path, &data).unwrap();
        let data = sidecar(dir.path()).unwrap();
        assert_eq!(data["future"], 42);
        assert_eq!(data["view"]["layout"], "grid");
        assert_eq!(data["links"][0]["name"], "ref");
    }
    #[test]
    fn corrupt_json_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".moodboard.json");
        fs::write(&path, b"{oops").unwrap();
        assert!(sidecar(dir.path()).is_err());
        assert_eq!(fs::read(path).unwrap(), b"{oops");
    }
    #[test]
    fn names_cannot_escape_parent() {
        for name in [
            "",
            "..",
            ".",
            "../outside",
            "C:\\outside",
            "a/b",
            "a\\b",
            "CON",
            "nul.txt",
            "end.",
            "end ",
        ] {
            assert!(leaf(name).is_err(), "{name}");
        }
        assert!(leaf("Moodboard tiếng Việt").is_ok());
    }
    #[test]
    fn deleting_group_never_removes_unknown_files_or_subfolders() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("nested")).unwrap();
        fs::write(dir.path().join("notes.txt"), b"keep").unwrap();
        assert!(delete_empty_group(dir.path()).is_err());
        assert!(dir.path().join("nested").exists());
        assert!(dir.path().join("notes.txt").exists());
    }
    #[test]
    fn scanning_excludes_directories_named_as_media() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("fake.jpg")).unwrap();
        fs::write(dir.path().join("real.MP4"), b"test").unwrap();
        assert_eq!(scan(dir.path(), false).unwrap(), vec!["real.MP4"]);
    }
}
