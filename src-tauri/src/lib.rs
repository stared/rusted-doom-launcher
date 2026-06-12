use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, Manager, State};

pub mod game_archives;
pub mod gog_import;
pub mod launcher_downloads;

#[tauri::command]
async fn read_launcher_downloads(library_path: String) -> Result<launcher_downloads::LauncherDownloads, String> {
    let path = launcher_downloads::launcher_downloads_path(library_path);
    launcher_downloads::read_launcher_downloads_or_empty(path)
}

#[tauri::command]
async fn write_launcher_downloads(
    library_path: String,
    state: launcher_downloads::LauncherDownloads,
) -> Result<(), String> {
    let path = launcher_downloads::launcher_downloads_path(library_path);
    launcher_downloads::write_launcher_downloads(path, &state)
}

/// Copy a user-picked file into the library. Bypasses fs:scope so the source
/// path can be anywhere on disk; the target is constrained to a path the
/// frontend computes from the library root.
#[tauri::command]
async fn import_custom_wad(source_path: String, target_path: String) -> Result<u64, String> {
    std::fs::copy(&source_path, &target_path)
        .map_err(|e| format!("Failed to copy {} -> {}: {}", source_path, target_path, e))
}

/// Read a byte range from a file. Bypasses fs:scope so the custom-WAD
/// importer can inspect user-picked files (WAD header, directory, lumps)
/// without ever reading them whole.
#[tauri::command]
async fn read_file_range(
    path: String,
    offset: u64,
    len: u64,
) -> Result<tauri::ipc::Response, String> {
    game_archives::read_file_range(&path, offset, len).map(tauri::ipc::Response::new)
}

/// Streaming magic-byte check of a downloaded file (no full read).
#[tauri::command]
async fn validate_game_file(path: String, filename: String) -> Result<(), String> {
    game_archives::validate_game_file(&path, &filename)
}

/// Stream all .wad/.pk3 entries of a zip into the library dir.
#[tauri::command]
async fn extract_game_files(
    zip_path: String,
    dest_dir: String,
) -> Result<Vec<game_archives::ExtractedGameFile>, String> {
    game_archives::extract_game_files(&zip_path, &dest_dir)
}

/// List zip entries (path + uncompressed size) without reading contents.
#[tauri::command]
async fn list_zip_entries(zip_path: String) -> Result<Vec<game_archives::ZipEntryInfo>, String> {
    game_archives::list_zip_entries(&zip_path)
}

/// Read a single zip entry as raw bytes.
#[tauri::command]
async fn read_zip_entry(
    zip_path: String,
    entry_path: String,
) -> Result<tauri::ipc::Response, String> {
    game_archives::read_zip_entry(&zip_path, &entry_path).map(tauri::ipc::Response::new)
}

/// Stream a zip entry to a temp file and return its path. Bypasses fs:scope.
#[tauri::command]
async fn extract_zip_entry_to_temp(zip_path: String, entry_path: String) -> Result<String, String> {
    game_archives::extract_zip_entry_to_temp(&zip_path, &entry_path)
}

/// Create a unique temp directory (innoextract's --output-dir target).
#[tauri::command]
async fn make_temp_dir() -> Result<String, String> {
    gog_import::make_temp_dir()
}

/// Remove a launcher-owned temp directory (validated in game_archives).
#[tauri::command]
async fn cleanup_temp_dir(path: String) -> Result<(), String> {
    game_archives::cleanup_temp_dir(&path)
}

/// Move wanted WADs out of a GOG extraction temp dir into the iwads
/// folder, flat and lowercase, regardless of the installer's layout.
#[tauri::command]
async fn collect_known_wads(
    src_dir: String,
    dest_dir: String,
    wanted: Vec<String>,
) -> Result<Vec<gog_import::CollectedWad>, String> {
    gog_import::collect_known_wads(&src_dir, &dest_dir, &wanted)
}

/// Look for an idgames-style metadata sidecar next to a user-picked file.
/// Tries `<basename>.txt` (case-insensitive) first, then any single `*.txt`
/// in the same directory. Returns "" when nothing matches. Bypasses fs:scope.
#[tauri::command]
async fn read_sibling_text(source_path: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&source_path);
    let dir = match src.parent() {
        Some(d) => d,
        None => return Ok(String::new()),
    };
    let stem = match src.file_stem() {
        Some(s) => s.to_string_lossy().to_string(),
        None => return Ok(String::new()),
    };

    // Pass 1: exact basename match, case-insensitive.
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name() else { continue };
            let name = name.to_string_lossy();
            let lower = name.to_lowercase();
            if !lower.ends_with(".txt") { continue }
            let entry_stem = lower.trim_end_matches(".txt");
            if entry_stem == stem.to_lowercase() {
                return std::fs::read_to_string(&path)
                    .or_else(|_| std::fs::read(&path).map(|b| String::from_utf8_lossy(&b).into_owned()))
                    .map_err(|e| format!("Failed to read {}: {}", path.display(), e));
            }
        }
    }

    // Pass 2: any single .txt in the directory. If there are multiple, pick none
    // (ambiguous — don't guess).
    let mut found: Option<std::path::PathBuf> = None;
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name() else { continue };
            if !name.to_string_lossy().to_lowercase().ends_with(".txt") { continue }
            if found.is_some() { return Ok(String::new()); }
            found = Some(path);
        }
    }
    if let Some(path) = found {
        return std::fs::read_to_string(&path)
            .or_else(|_| std::fs::read(&path).map(|b| String::from_utf8_lossy(&b).into_owned()))
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e));
    }
    Ok(String::new())
}

/// Read {library}/custom-wads.json as opaque JSON. Returns an empty
/// {version:1, entries:[]} skeleton when the file is missing. The schema is
/// owned by the TypeScript side (Zod WadEntrySchema), not Rust.
#[tauri::command]
async fn read_custom_wads(library_path: String) -> Result<serde_json::Value, String> {
    let path = std::path::PathBuf::from(library_path).join("custom-wads.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| format!("Failed to parse {}: {}", path.display(), e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_json::json!({ "version": 1, "entries": [] }))
        }
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

#[tauri::command]
async fn write_custom_wads(library_path: String, state: serde_json::Value) -> Result<(), String> {
    let path = std::path::PathBuf::from(library_path).join("custom-wads.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize custom-wads.json: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

// Output collector for the most recent GZDoom launch, held in Tauri managed
// state. Mutex<Option<...>> so each launch replaces the previous session.
struct GzdoomLog(Mutex<Option<Arc<Mutex<GZDoomSession>>>>);

struct GZDoomSession {
    start_time: std::time::Instant,
    lines: Vec<(u64, String)>, // (time_ms, line)
    finished: bool,
}

impl GZDoomSession {
    fn new() -> Self {
        Self {
            start_time: std::time::Instant::now(),
            lines: Vec::new(),
            finished: false,
        }
    }
}

/// Sanity check that a configured engine path names a GZDoom-family binary
/// before we exec it. This guards against misconfiguration (picking the
/// wrong file in Settings), not a hostile webview — it is not a security
/// boundary. The executable's basename must name the engine; a mere
/// substring anywhere in the path (/tmp/gzdoom-stuff/other) doesn't pass.
fn validate_engine_path(engine_path: &str) -> Result<(), String> {
    let stem = Path::new(engine_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if stem.contains("gzdoom") || stem.contains("uzdoom") {
        Ok(())
    } else {
        Err(format!(
            "Invalid engine path: expected a GZDoom/UZDoom executable, got '{}'",
            engine_path
        ))
    }
}

/// Get the version of GZDoom/UZDoom from the app bundle's Info.plist.
/// Returns the version string (e.g., "g4.14.2") or an error.
#[tauri::command]
async fn get_engine_version(engine_path: String) -> Result<String, String> {
    validate_engine_path(&engine_path)?;
    get_engine_version_impl(&engine_path)
}

#[cfg(target_os = "macos")]
fn get_engine_version_impl(engine_path: &str) -> Result<String, String> {
    // Extract app bundle path from executable path
    // e.g., /Applications/GZDoom.app/Contents/MacOS/gzdoom -> /Applications/GZDoom.app
    let path = Path::new(engine_path);
    let app_path = path
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"))
        .ok_or("Could not find .app bundle")?;

    let info_plist = app_path.join("Contents/Info.plist");
    let output = Command::new("defaults")
        .arg("read")
        .arg(&info_plist)
        .arg("CFBundleShortVersionString")
        .output()
        .map_err(|e| format!("Failed to read Info.plist: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !version.is_empty() {
            return Ok(version);
        }
    }

    Err("Could not read version from Info.plist".to_string())
}

#[cfg(target_os = "linux")]
fn get_engine_version_impl(engine_path: &str) -> Result<String, String> {
    let output = Command::new(engine_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to run engine with --version: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let first_line = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or("Engine did not return a version string")?;

    Ok(first_line.to_string())
}

#[cfg(target_os = "windows")]
fn get_engine_version_impl(engine_path: &str) -> Result<String, String> {
    use std::ffi::c_void;
    use windows::{
        Win32::Storage::FileSystem::{
            GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
        },
        core::PCWSTR,
    };

    fn to_wide_null(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let path_w = to_wide_null(engine_path);

    unsafe {
        let mut handle = 0u32;
        let size = GetFileVersionInfoSizeW(PCWSTR(path_w.as_ptr()), Some(&mut handle));

        if size == 0 {
            return Err("Could not read executable version metadata".to_string());
        }

        let mut buffer = vec![0u8; size as usize];

        GetFileVersionInfoW(
            PCWSTR(path_w.as_ptr()),
            Some(0),
            size,
            buffer.as_mut_ptr() as *mut _,
        )
        .map_err(|e| format!("Failed to query file version: {}", e))?;

        let translation_block = to_wide_null(r"\VarFileInfo\Translation");
        let mut translation_ptr: *mut c_void = std::ptr::null_mut();
        let mut translation_len: u32 = 0;

        if !VerQueryValueW(
            buffer.as_ptr() as *const _,
            PCWSTR(translation_block.as_ptr()),
            &mut translation_ptr,
            &mut translation_len,
        )
        .as_bool()
        {
            return Err("Failed to query translation info".to_string());
        }

        if translation_ptr.is_null() || translation_len < 4 {
            return Err("Executable version translation info is missing".to_string());
        }

        let translation = std::slice::from_raw_parts(
            translation_ptr as *const u16,
            (translation_len / 2) as usize,
        );

        if translation.len() < 2 {
            return Err("Executable version translation info is invalid".to_string());
        }

        let lang = translation[0];
        let codepage = translation[1];

        let sub_block = format!(
            r"\StringFileInfo\{:04x}{:04x}\ProductVersion",
            lang, codepage
        );
        let sub_block_w = to_wide_null(&sub_block);

        let mut value_ptr: *mut c_void = std::ptr::null_mut();
        let mut value_len: u32 = 0;

        if !VerQueryValueW(
            buffer.as_ptr() as *const _,
            PCWSTR(sub_block_w.as_ptr()),
            &mut value_ptr,
            &mut value_len,
        )
        .as_bool()
        {
            return Err("Failed to query ProductVersion".to_string());
        }

        if value_ptr.is_null() || value_len == 0 {
            return Err("Executable version metadata is empty".to_string());
        }

        let utf16_slice = std::slice::from_raw_parts(value_ptr as *const u16, value_len as usize);

        let version = String::from_utf16_lossy(utf16_slice)
            .trim_end_matches('\0')
            .trim()
            .to_string();

        if version.is_empty() {
            return Err("Executable version metadata is empty".to_string());
        }

        Ok(version)
    }
}

/// Launch GZDoom/UZDoom with the specified executable path and arguments.
/// Captures stdout/stderr for later retrieval via get_gzdoom_log and emits
/// a "gzdoom-exited" event when the process ends.
#[tauri::command]
async fn launch_gzdoom(
    app: tauri::AppHandle,
    log: State<'_, GzdoomLog>,
    gzdoom_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    validate_engine_path(&gzdoom_path)?;

    // Create a new session (replaces any previous one)
    let session = Arc::new(Mutex::new(GZDoomSession::new()));
    *log.0.lock().unwrap() = Some(session.clone());

    // Spawn GZDoom with piped stdout/stderr
    let mut child = Command::new(&gzdoom_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch engine at '{}': {}", gzdoom_path, e))?;

    // Take ownership of stdout and stderr
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Spawn thread to read stdout
    if let Some(stdout) = stdout {
        let session_clone = session.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let mut guard = session_clone.lock().unwrap();
                let elapsed = guard.start_time.elapsed().as_millis() as u64;
                guard.lines.push((elapsed, line));
            }
        });
    }

    // Spawn thread to read stderr (merge with stdout)
    if let Some(stderr) = stderr {
        let session_clone = session.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let mut guard = session_clone.lock().unwrap();
                let elapsed = guard.start_time.elapsed().as_millis() as u64;
                guard.lines.push((elapsed, line));
            }
        });
    }

    // Wait for process exit, mark the session finished, then tell the
    // frontend. The output-reader threads above may still be draining their
    // final lines when wait() returns, so mark finished under the same lock
    // they take per line — get_gzdoom_log snapshots whatever has been read.
    thread::spawn(move || {
        let _ = child.wait();
        {
            let mut guard = session.lock().unwrap();
            guard.finished = true;
        }
        if let Err(e) = app.emit("gzdoom-exited", ()) {
            eprintln!("Failed to emit gzdoom-exited: {}", e);
        }
    });

    Ok(())
}

/// Get the captured GZDoom console log after the game exits.
/// Returns JSON array of [time_ms, text] pairs, or null if no session/not finished.
#[tauri::command]
async fn get_gzdoom_log(log: State<'_, GzdoomLog>) -> Result<Option<Vec<(u64, String)>>, String> {
    let slot = log.0.lock().unwrap();
    match slot.as_ref() {
        Some(session) => {
            let guard = session.lock().unwrap();
            if guard.finished {
                Ok(Some(guard.lines.clone()))
            } else {
                Ok(None) // Still running
            }
        }
        None => Ok(None), // No session started
    }
}

#[cfg(test)]
mod tests {
    use super::validate_engine_path;

    #[test]
    fn accepts_engine_basenames_rejects_substring_paths() {
        assert!(validate_engine_path("/Applications/GZDoom.app/Contents/MacOS/gzdoom").is_ok());
        assert!(validate_engine_path("C:\\Program Files\\UZDoom\\uzdoom.exe").is_ok());
        assert!(validate_engine_path("/opt/homebrew/bin/gzdoom-4.11").is_ok());
        // "gzdoom" in a parent directory is not enough.
        assert!(validate_engine_path("/tmp/gzdoom-evil/malware").is_err());
        assert!(validate_engine_path("/usr/bin/doom").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Folders granted via the file dialog stay in the fs scope across
        // restarts; without this a custom Data Folder breaks on next launch.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_upload::init())
        .manage(GzdoomLog(Mutex::new(None)))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {e}"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_gzdoom,
            get_gzdoom_log,
            get_engine_version,
            read_launcher_downloads,
            write_launcher_downloads,
            import_custom_wad,
            read_file_range,
            read_sibling_text,
            read_custom_wads,
            write_custom_wads,
            validate_game_file,
            extract_game_files,
            extract_zip_entry_to_temp,
            list_zip_entries,
            read_zip_entry,
            make_temp_dir,
            cleanup_temp_dir,
            collect_known_wads
        ]);

    // MCP bridge for Claude Code debugging (dev mode only)
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
