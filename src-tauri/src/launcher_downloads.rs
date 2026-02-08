use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherDownloads {
	pub version: u8,
	pub downloads: HashMap<String, DownloadInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadInfo {
	pub filename: String,
	#[serde(rename = "downloadedAt")]
	pub downloaded_at: String,
	pub size: u64,
}

impl LauncherDownloads {
	pub fn empty() -> Self {
		Self {
			version: 1,
			downloads: HashMap::new(),
		}
	}
}

/// Build the full path to launcher-downloads.json in a library directory.
pub fn launcher_downloads_path(library_path: impl AsRef<Path>) -> PathBuf {
	library_path.as_ref().join("launcher-downloads.json")
}

/// Read launcher-downloads.json from disk.
pub fn read_launcher_downloads(path: impl AsRef<Path>) -> Result<LauncherDownloads, String> {
	let path = path.as_ref();
	let content = fs::read_to_string(path)
		.map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
	serde_json::from_str::<LauncherDownloads>(&content)
		.map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// Read launcher-downloads.json, returning an empty state if the file is missing.
pub fn read_launcher_downloads_or_empty(
	path: impl AsRef<Path>,
) -> Result<LauncherDownloads, String> {
	let path = path.as_ref();
	match fs::read_to_string(path) {
		Ok(content) => serde_json::from_str::<LauncherDownloads>(&content)
			.map_err(|e| format!("Failed to parse {}: {}", path.display(), e)),
		Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LauncherDownloads::empty()),
		Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
	}
}

/// Write launcher-downloads.json to disk, creating parent directories if needed.
pub fn write_launcher_downloads(
	path: impl AsRef<Path>,
	state: &LauncherDownloads,
) -> Result<(), String> {
	let path = path.as_ref();
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)
			.map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
	}
	let json = serde_json::to_string_pretty(state)
		.map_err(|e| format!("Failed to serialize launcher downloads: {}", e))?;
	fs::write(path, json)
		.map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}
