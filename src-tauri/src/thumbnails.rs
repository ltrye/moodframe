use crate::core::*;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};

pub struct Thumbnails {
    pub folder: PathBuf,
    pub slots: tokio::sync::Semaphore,
    locks: Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>,
}
impl Thumbnails {
    pub fn new(folder: PathBuf) -> Result<Self> {
        fs::create_dir_all(&folder).map_err(err)?;
        Ok(Self {
            folder,
            slots: tokio::sync::Semaphore::new(4),
            locks: Mutex::new(HashMap::new()),
        })
    }
    pub fn lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.locks.lock().unwrap();
        locks.retain(|_, v| v.strong_count() > 0);
        if let Some(lock) = locks.get(key).and_then(|l| l.upgrade()) {
            return lock;
        }
        let lock = Arc::new(tokio::sync::Mutex::new(()));
        locks.insert(key.into(), Arc::downgrade(&lock));
        lock
    }
    pub fn generate(&self, source: &Path, ffmpeg: &Path) -> Result<String> {
        let key = cache_key(source)?;
        let output = self.folder.join(format!("{key}.jpg"));
        if output.metadata().is_ok_and(|m| m.len() > 0) {
            return Ok(display(&output));
        }
        let tmp = tempfile::Builder::new()
            .suffix(".jpg")
            .tempfile_in(&self.folder)
            .map_err(err)?;
        let kind = media_type(source).ok_or("Unsupported media format")?;
        if kind == "video" {
            // First useful frame, also safe for very short clips. No shell interpolation.
            let result = hidden(ffmpeg)
                .args([
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-threads",
                    "1",
                ])
                .arg("-i")
                .arg(source)
                .args([
                    "-vf",
                    "thumbnail=30,scale=400:-2",
                    "-frames:v",
                    "1",
                    "-threads",
                    "1",
                    "-q:v",
                    "4",
                ])
                .arg(tmp.path())
                .output()
                .map_err(|e| {
                    format!("FFmpeg thumbnail failed: {e}. Build the player runtime first.")
                })?;
            if !result.status.success() {
                return Err(String::from_utf8_lossy(&result.stderr).into());
            }
        } else {
            let image = if source
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("svg"))
            {
                let bytes = fs::read(source).map_err(err)?;
                // No resource directory: SVG cannot read arbitrary local files.
                let tree = resvg::usvg::Tree::from_data(&bytes, &resvg::usvg::Options::default())
                    .map_err(err)?;
                let size = tree.size();
                let scale = (400. / size.width()).min(4000. / size.height()).min(1.);
                let mut pixmap = resvg::tiny_skia::Pixmap::new(
                    (size.width() * scale).ceil().max(1.) as u32,
                    (size.height() * scale).ceil().max(1.) as u32,
                )
                .ok_or("Invalid SVG size")?;
                resvg::render(
                    &tree,
                    resvg::tiny_skia::Transform::from_scale(scale, scale),
                    &mut pixmap.as_mut(),
                );
                image::DynamicImage::ImageRgba8(
                    image::RgbaImage::from_raw(pixmap.width(), pixmap.height(), pixmap.take())
                        .ok_or("Invalid SVG pixels")?,
                )
            } else {
                image::ImageReader::open(source)
                    .map_err(err)?
                    .with_guessed_format()
                    .map_err(err)?
                    .decode()
                    .map_err(err)?
            };
            let image = image.thumbnail(400, 4000).to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(tmp.reopen().map_err(err)?, 80)
                .encode_image(&image)
                .map_err(err)?;
        }
        if tmp.as_file().metadata().map_err(err)?.len() == 0 {
            return Err("No video frame could be generated".into());
        }
        tmp.as_file().sync_all().map_err(err)?;
        tmp.persist(&output).map_err(err)?;
        Ok(display(&output))
    }
}
pub fn hidden(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
pub fn cache_key(source: &Path) -> Result<String> {
    let metadata = source.metadata().map_err(err)?;
    let stamp = metadata
        .modified()
        .map_err(err)?
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let mut hash = Sha256::new();
    hash.update(format!(
        "moodframe-v1|{}|{}|{}",
        display(source),
        metadata.len(),
        stamp
    ));
    Ok(format!("{:x}", hash.finalize()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modified_source_gets_a_new_cache_entry() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.png");
        fs::write(&p, b"one").unwrap();
        let a = cache_key(&p).unwrap();
        fs::write(&p, b"different size").unwrap();
        assert_ne!(a, cache_key(&p).unwrap());
    }
    #[test]
    fn generates_reusable_jpeg_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("large.png");
        image::RgbImage::new(1200, 600).save(&p).unwrap();
        let cache = Thumbnails::new(dir.path().join("cache")).unwrap();
        let a = cache.generate(&p, Path::new("unused")).unwrap();
        let img = image::open(&a).unwrap();
        assert_eq!((img.width(), img.height()), (400, 200));
        assert_eq!(a, cache.generate(&p, Path::new("unused")).unwrap());
    }
}
