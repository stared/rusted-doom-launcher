use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Manager;

pub mod launcher_downloads;
mod wad_parser;

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

// Global state to hold the running GZDoom process output collector
static GZDOOM_LOG: std::sync::OnceLock<Arc<Mutex<GZDoomSession>>> = std::sync::OnceLock::new();

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

/// Get the version of GZDoom/UZDoom from the app bundle's Info.plist.
/// Returns the version string (e.g., "g4.14.2") or an error.
#[tauri::command]
async fn get_engine_version(engine_path: String) -> Result<String, String> {
    // Security: Validate the path looks like a doom engine
    let path_lower = engine_path.to_lowercase();
    if !path_lower.contains("gzdoom") && !path_lower.contains("uzdoom") {
        return Err("Invalid path: must be GZDoom or UZDoom".to_string());
    }

    get_engine_version_impl(&engine_path)
}

/// Check if a process with the given name is running.
#[tauri::command]
async fn is_process_running(process_name: String) -> Result<bool, String> {
    is_process_running_impl(&process_name)
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
    // Read executable metadata instead of launching the engine.
    let ps_cmd = format!(
        "(Get-Item -LiteralPath '{}').VersionInfo.ProductVersion",
        engine_path.replace('\'', "''")
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .output()
        .map_err(|e| format!("Failed to query file version: {}", e))?;

    if !output.status.success() {
        return Err("Could not read executable version metadata".to_string());
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("Executable version metadata is empty".to_string());
    }

    Ok(version)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn is_process_running_impl(process_name: &str) -> Result<bool, String> {
    let output = Command::new("pgrep")
        .arg("-x")
        .arg(process_name)
        .output()
        .map_err(|e| format!("Failed to run pgrep: {}", e))?;
    Ok(output.status.success())
}

#[cfg(target_os = "windows")]
fn is_process_running_impl(process_name: &str) -> Result<bool, String> {
    let filter = format!("IMAGENAME eq {}", process_name);
    let output = Command::new("tasklist")
        .args(["/FI", &filter])
        .output()
        .map_err(|e| format!("Failed to run tasklist: {}", e))?;

    if !output.status.success() {
        return Err("tasklist failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    Ok(stdout.contains(&process_name.to_lowercase()))
}

/// Extract level names from a WAD file's MAPINFO/ZMAPINFO/UMAPINFO/DEHACKED lumps.
/// Returns a map of level ID (e.g., "MAP01") to level name (e.g., "Entryway").
/// Only includes levels that have names defined in the WAD.
#[tauri::command]
async fn extract_wad_level_names(wad_path: String) -> Result<HashMap<String, String>, String> {
    wad_parser::extract_level_names(&wad_path)
}

/// Extract level names and save them to a JSON file alongside the WAD.
/// Creates a file named "{wad_filename}.levels.json" in the same directory.
#[tauri::command]
async fn extract_and_save_level_names(wad_path: String) -> Result<String, String> {
    let names = wad_parser::extract_level_names(&wad_path)?;

    let path = Path::new(&wad_path);
    let json_path = path.with_extension("levels.json");

    let json = serde_json::to_string_pretty(&names)
        .map_err(|e| format!("Failed to serialize level names: {}", e))?;

    std::fs::write(&json_path, &json)
        .map_err(|e| format!("Failed to write level names file: {}", e))?;

    Ok(json_path.to_string_lossy().to_string())
}

/// Launch GZDoom/UZDoom with the specified executable path and arguments.
/// Captures stdout/stderr for later retrieval via get_gzdoom_log.
#[tauri::command]
async fn launch_gzdoom(
    gzdoom_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    // Security: Validate the path looks like a doom engine
    let path_lower = gzdoom_path.to_lowercase();
    if !path_lower.contains("gzdoom") && !path_lower.contains("uzdoom") {
        return Err("Invalid path: must be GZDoom or UZDoom".to_string());
    }

    // Initialize or reset the session
    let session = Arc::new(Mutex::new(GZDoomSession::new()));
    let _ = GZDOOM_LOG.set(session.clone());

    // If already set, reset it
    if let Some(existing) = GZDOOM_LOG.get() {
        let mut guard = existing.lock().unwrap();
        *guard = GZDoomSession::new();
    }

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
        let session_clone = GZDOOM_LOG.get().unwrap().clone();
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
        let session_clone = GZDOOM_LOG.get().unwrap().clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let mut guard = session_clone.lock().unwrap();
                let elapsed = guard.start_time.elapsed().as_millis() as u64;
                guard.lines.push((elapsed, line));
            }
        });
    }

    // Spawn thread to wait for process exit and mark session as finished
    thread::spawn(move || {
        let _ = child.wait();
        if let Some(session) = GZDOOM_LOG.get() {
            let mut guard = session.lock().unwrap();
            guard.finished = true;
        }
    });

    Ok(())
}

/// Get the captured GZDoom console log after the game exits.
/// Returns JSON array of [time_ms, text] pairs, or null if no session/not finished.
#[tauri::command]
async fn get_gzdoom_log() -> Result<Option<Vec<(u64, String)>>, String> {
    match GZDOOM_LOG.get() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_upload::init())
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
            is_process_running,
            extract_wad_level_names,
            extract_and_save_level_names,
            read_launcher_downloads,
            write_launcher_downloads
        ]);

    // MCP bridge for Claude Code debugging (dev mode only)
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
