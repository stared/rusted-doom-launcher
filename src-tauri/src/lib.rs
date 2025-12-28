use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

mod wad_parser;

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

/// Check if a process with the given name is running.
#[tauri::command]
async fn is_process_running(process_name: String) -> Result<bool, String> {
    let output = Command::new("pgrep")
        .arg("-x")
        .arg(&process_name)
        .output()
        .map_err(|e| format!("Failed to run pgrep: {}", e))?;

    Ok(output.status.success())
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

/// Launch GZDoom with the specified executable path and arguments.
/// Captures stdout/stderr for later retrieval via get_gzdoom_log.
#[tauri::command]
async fn launch_gzdoom(
    gzdoom_path: String,
    args: Vec<String>,
) -> Result<(), String> {
    // Security: Validate the path looks like gzdoom
    let path_lower = gzdoom_path.to_lowercase();
    if !path_lower.contains("gzdoom") {
        return Err("Invalid GZDoom path: must contain 'gzdoom'".to_string());
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
        .map_err(|e| format!("Failed to launch GZDoom at '{}': {}", gzdoom_path, e))?;

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
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_upload::init())
        .invoke_handler(tauri::generate_handler![
            launch_gzdoom,
            get_gzdoom_log,
            is_process_running,
            extract_wad_level_names,
            extract_and_save_level_names
        ]);

    // Enable MCP plugin for AI debugging in development builds (only when feature enabled)
    #[cfg(all(debug_assertions, feature = "mcp"))]
    {
        use log::info;
        info!("Development build: enabling MCP plugin for AI debugging");
        builder = builder.plugin(tauri_plugin_mcp::init_with_config(
            tauri_plugin_mcp::PluginConfig::new("doom-launcher".to_string())
                .start_socket_server(true),
        ));
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
