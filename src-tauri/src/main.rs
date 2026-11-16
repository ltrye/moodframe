#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod core;
mod external_player;
mod player;
mod state;
mod thumbnails;
use core::*;
use serde_json::{json, Value};
use state::State;
use std::{fs, path::Path, sync::Arc};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

fn string<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key].as_str().ok_or_else(|| format!("Missing {key}"))
}
fn shortcut_name(name: &str) -> String {
    name.replace('`', "Backquote")
        .replace("+Up", "+ArrowUp")
        .replace("+Down", "+ArrowDown")
        .replace("+Left", "+ArrowLeft")
        .replace("+Right", "+ArrowRight")
}

#[tauri::command]
async fn request(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<State>>,
    action: String,
    args: Value,
) -> Result<Value> {
    let state = state.inner().clone();
    if action == "getThumbnail" {
        let source = state.checked(string(&args, "filePath")?)?;
        let key = thumbnails::cache_key(&source)?;
        let lock = state.thumbnails.lock(&key);
        let _guard = lock.lock().await;
        let _slot = state.thumbnails.slots.acquire().await.map_err(err)?;
        let ffmpeg = state::runtime(&app)
            .map(|p| p.join("ffmpeg.exe"))
            .unwrap_or_else(|_| Path::new("ffmpeg").to_path_buf());
        let worker = state.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            worker
                .thumbnails
                .generate(&source, &ffmpeg)
                .map(|p| json!(p))
        })
        .await
        .map_err(err)?;
    }
    tauri::async_runtime::spawn_blocking(move || dispatch(&app, &state, &action, &args))
        .await
        .map_err(err)?
}
fn dispatch(app: &tauri::AppHandle, state: &State, action: &str, args: &Value) -> Result<Value> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    match action {
        "getWindowPrefs" => {
            let mut prefs = state.config.lock().unwrap()["windowPrefs"].clone();
            prefs["platform"] = json!(if cfg!(windows) {
                "win32"
            } else {
                std::env::consts::OS
            });
            prefs["isMaximized"] = json!(window.is_maximized().map_err(err)?);
            Ok(prefs)
        }
        "setAlwaysOnTop" => {
            let value = args["value"].as_bool().ok_or("Invalid pin setting")?;
            window.set_always_on_top(value).map_err(err)?;
            state.save(|c| {
                c["windowPrefs"]["alwaysOnTop"] = json!(value);
                Ok(Value::Null)
            })
        }
        "setToggleShortcut" => {
            let accel = string(args, "accel")?;
            let next: Shortcut = shortcut_name(accel).parse().map_err(err)?;
            let old = state.config.lock().unwrap()["windowPrefs"]["toggleShortcut"]
                .as_str()
                .unwrap_or("Alt+`")
                .to_owned();
            if accel == old {
                return Ok(json!({"ok":true}));
            }
            if let Err(e) = app.global_shortcut().register(next) {
                return Ok(json!({"ok":false,"error":e.to_string()}));
            }
            if let Err(e) = state.save(|c| {
                c["windowPrefs"]["toggleShortcut"] = json!(accel);
                Ok(Value::Null)
            }) {
                let _ = app.global_shortcut().unregister(next);
                return Err(e);
            }
            if let Ok(previous) = shortcut_name(&old).parse::<Shortcut>() {
                let _ = app.global_shortcut().unregister(previous);
            }
            Ok(json!({"ok":true}))
        }
        "minimizeWindow" => {
            window.minimize().map_err(err)?;
            Ok(Value::Null)
        }
        "maximizeToggle" => {
            if window.is_maximized().map_err(err)? {
                window.unmaximize()
            } else {
                window.maximize()
            }
            .map_err(err)?;
            Ok(Value::Null)
        }
        "closeWindow" => {
            state.close_player();
            window.close().map_err(err)?;
            Ok(Value::Null)
        }
        "openFolderDialog" | "openImageDialog" => {
            let folder = action == "openFolderDialog";
            let dialog = rfd::FileDialog::new().set_title(if folder {
                "Choose a moodboard folder"
            } else {
                "Choose an image"
            });
            let chosen = if folder {
                dialog.pick_folder()
            } else {
                dialog
                    .add_filter(
                        "Images",
                        &[
                            "jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "tif", "tiff",
                        ],
                    )
                    .pick_file()
            };
            match chosen {
                Some(p) => Ok(json!(display(&state.grant(app, &p, folder)?))),
                None => Ok(Value::Null),
            }
        }
        "getBoards" => Ok(state.boards(app)),
        "addBoard" => {
            let path = state.checked(string(args, "folderPath")?)?;
            if !path.is_dir() {
                return Err("Board must be a folder".into());
            }
            state.save(|c|{
                if let Some(existing)=c["boards"].as_array().unwrap().iter().find(|b|b["folderPath"]==display(&path)) {return Ok(existing.clone());}
                let board=json!({"id":uuid::Uuid::new_v4().to_string(),"name":path.file_name().map(|n|n.to_string_lossy().into_owned()).unwrap_or_else(||display(&path)),"folderPath":display(&path),"createdAt":chrono::Utc::now().to_rfc3339()});
                c["boards"].as_array_mut().unwrap().push(board.clone());Ok(board)
            })
        }
        "removeBoard" | "renameBoard" | "reorderBoards" | "setBoardThumbnail" => state.save(|c| {
            let id = args["id"].as_str().unwrap_or("");
            if action == "removeBoard" {
                c["boards"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|b| b["id"] != id);
                c["boardSettings"].as_object_mut().unwrap().remove(id);
            } else if action == "reorderBoards" {
                let order = args["orderedIds"].as_array().ok_or("Missing ordered IDs")?;
                c["boards"].as_array_mut().unwrap().sort_by_key(|b| {
                    order
                        .iter()
                        .position(|id| *id == b["id"])
                        .unwrap_or(usize::MAX)
                });
            } else {
                let board = c["boards"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|b| b["id"] == id)
                    .ok_or("Board not found")?;
                if action == "renameBoard" {
                    let name = string(args, "name")?.trim();
                    if name.is_empty() {
                        return Err("Name cannot be empty".into());
                    }
                    board["name"] = json!(name);
                } else if let Some(path) = args["thumbnailPath"].as_str() {
                    state.checked(path)?;
                    board["customThumbnail"] = json!(path);
                } else {
                    board.as_object_mut().unwrap().remove("customThumbnail");
                }
            }
            Ok(Value::Null)
        }),
        "getBoardTheme" => Ok(state.config.lock().unwrap()["boardSettings"]
            .get(string(args, "id")?)
            .cloned()
            .unwrap_or(json!({"theme":"void"}))),
        "setBoardTheme" | "setBoardImageSize" | "setBoardLayout" => state.save(|c| {
            let id = string(args, "id")?;
            if c["boardSettings"].get(id).is_none() {
                c["boardSettings"][id] = json!({"theme":"void"});
            }
            let keys: &[&str] = match action {
                "setBoardTheme" => &["theme", "customBg"],
                "setBoardImageSize" => &["imageSize", "customSize"],
                _ => &["layout"],
            };
            for key in keys {
                if *key == "customBg" {
                    if let Some(path) = args[key].as_str() {
                        state.checked(path)?;
                    }
                }
                c["boardSettings"][id][key] = args[key].clone();
            }
            Ok(Value::Null)
        }),
        "scanFolder" | "readImageFiles" | "getFirstMedia" | "readGroups" => {
            let path = state.checked(string(args, "folderPath")?)?;
            let names = scan(&path, action == "readGroups")?;
            Ok(match action {
                "scanFolder" => json!(names
                    .iter()
                    .map(|n| json!({"name":n,"type":media_type(Path::new(n))}))
                    .collect::<Vec<_>>()),
                "getFirstMedia" => json!(names.first()),
                _ => json!(names),
            })
        }
        "readSidecar" | "readViewSettings" | "readGroupLinks" | "writeSidecar"
        | "writeViewSettings" | "addGroupLink" | "removeGroupLink" | "renameGroupLink" => {
            let path = state.checked(string(args, "folderPath")?)?;
            let _io = state.io.lock().unwrap();
            let mut data = sidecar(&path)?;
            let mut result = Value::Null;
            match action {
                "readSidecar" => return Ok(data["order"].clone()),
                "readViewSettings" => return Ok(data["view"].clone()),
                "readGroupLinks" => {
                    let mut links = Vec::new();
                    for link in data["links"].as_array().unwrap() {
                        if let Some(p) = link["path"].as_str() {
                            if readable_folder(Path::new(p))
                                && state.grant(app, Path::new(p), true).is_ok()
                            {
                                links.push(link.clone());
                            }
                        }
                    }
                    return Ok(json!(links));
                }
                "writeSidecar" => {
                    let order = args["order"].as_array().ok_or("Invalid media order")?;
                    for name in order {
                        leaf(name.as_str().ok_or("Invalid media filename")?)?;
                    }
                    data["order"] = json!(order);
                }
                "writeViewSettings" => {
                    for (key, val) in args["patch"].as_object().ok_or("Invalid view settings")? {
                        data["view"][key] = val.clone();
                    }
                }
                "addGroupLink" => {
                    let target = state.checked(string(args, "targetPath")?)?;
                    if !target.is_dir() || target == path {
                        return Ok(json!({"ok":false,"error":"Choose another folder"}));
                    }
                    let links = data["links"].as_array_mut().unwrap();
                    if links.iter().any(|l| {
                        canonical(l["path"].as_str().unwrap_or("")).is_ok_and(|p| p == target)
                    }) {
                        return Ok(json!({"ok":false,"error":"Folder is already linked"}));
                    }
                    let base = target.file_name().unwrap_or_default().to_string_lossy();
                    let mut name = base.to_string();
                    let mut index = 2;
                    let folders = scan(&path, true)?;
                    while folders.contains(&name) || links.iter().any(|l| l["name"] == name) {
                        name = format!("{base} ({index})");
                        index += 1;
                    }
                    let link = json!({"name":name,"path":display(&target)});
                    links.push(link.clone());
                    result = json!({"ok":true,"link":link});
                }
                "removeGroupLink" => {
                    data["links"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|l| l["name"] != args["name"]);
                    result = json!({"ok":true});
                }
                "renameGroupLink" => {
                    let name = leaf(string(args, "newName")?)?;
                    if scan(&path, true)?.iter().any(|n| n == name)
                        || data["links"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|l| l["name"] == name)
                    {
                        return Ok(json!({"ok":false,"error":"Name already taken"}));
                    }
                    for link in data["links"].as_array_mut().unwrap() {
                        if link["name"] == args["oldName"] {
                            link["name"] = json!(name);
                        }
                    }
                    result = json!({"ok":true});
                }
                _ => unreachable!(),
            }
            atomic_json(&path.join(".moodboard.json"), &data)?;
            Ok(result)
        }
        "createGroup" | "moveFileToGroup" | "deleteGroup" | "renameGroup" => {
            let _io = state.io.lock().unwrap();
            let work = || -> Result<()> {
                match action {
                    "createGroup" => {
                        let parent = state.checked(string(args, "parentPath")?)?;
                        fs::create_dir(parent.join(leaf(string(args, "name")?)?)).map_err(err)?;
                    }
                    "moveFileToGroup" => {
                        let source = state.checked(string(args, "filePath")?)?;
                        if !source.is_file() || media_type(&source).is_none() {
                            return Err("Select a media file".into());
                        }
                        let target = state
                            .checked(string(args, "targetFolderPath")?)?
                            .join(source.file_name().ok_or("Missing filename")?);
                        if target.exists() {
                            return Err("A file with that name already exists".into());
                        }
                        fs::rename(source, target).map_err(err)?;
                    }
                    "deleteGroup" => {
                        let path = state.checked(string(args, "groupPath")?)?;
                        protect_board(state, &path)?;
                        delete_empty_group(&path)?;
                    }
                    "renameGroup" => {
                        let path = state.checked(string(args, "groupPath")?)?;
                        protect_board(state, &path)?;
                        let target = path
                            .parent()
                            .ok_or("Missing parent")?
                            .join(leaf(string(args, "newName")?)?);
                        if target.exists() {
                            return Err("Name already taken".into());
                        }
                        fs::rename(path, target).map_err(err)?;
                    }
                    _ => unreachable!(),
                }
                Ok(())
            };
            Ok(match work() {
                Ok(()) => json!({"ok":true}),
                Err(error) => json!({"ok":false,"error":error}),
            })
        }
        "openWithDefaultApp" => {
            external_player::open(state, string(args, "filePath")?)?;
            Ok(Value::Null)
        }
        "openVideo" | "closeVideo" | "ackVideo" | "controlVideo" => {
            player::dispatch(app, state, &window, action, args)
        }
        _ => Err(format!("Unknown command: {action}")),
    }
}
fn protect_board(state: &State, path: &Path) -> Result<()> {
    if state.config.lock().unwrap()["boards"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| canonical(b["folderPath"].as_str().unwrap_or("")).is_ok_and(|p| p == path))
    {
        return Err("Use Remove board for a board root".into());
    }
    Ok(())
}
fn main() {
    let application = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_minimized().unwrap_or(false) {
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            } else {
                                let _ = window.minimize();
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let state = Arc::new(
                State::new(app.path().app_data_dir()?, app.path().app_cache_dir()?)
                    .map_err(std::io::Error::other)?,
            );
            state
                .restore_access(app.handle())
                .map_err(std::io::Error::other)?;
            let prefs = state.config.lock().unwrap()["windowPrefs"].clone();
            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(prefs["alwaysOnTop"].as_bool().unwrap_or(false))?;
            }
            let accel = shortcut_name(prefs["toggleShortcut"].as_str().unwrap_or("Alt+`"));
            if let Ok(shortcut) = accel.parse::<Shortcut>() {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("Shortcut unavailable: {e}");
                }
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![request])
        .build(tauri::generate_context!())
        .expect("Unable to start Moodframe");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<Arc<State>>().close_player();
        }
    });
}
