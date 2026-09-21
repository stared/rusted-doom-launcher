use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::gog_import::CollectedWad;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamStatus {
    pub installed: bool,
    pub steam_path: Option<String>,
    pub account_name: Option<String>,
    pub persona_name: Option<String>,
    pub libraries: Vec<String>,
    pub candidate_dirs: Vec<String>,
    pub found_wads: Vec<String>,
    pub staging_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamLogStatus {
    pub state: String, // "idle" | "downloading" | "complete" | "failed"
    pub message: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamImportResult {
    pub imported: Vec<CollectedWad>,
    pub skipped: Vec<String>,
    pub total_found: usize,
}

pub fn find_steam_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join("Library/Application Support/Steam");
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = [
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
        ];
        for c in &candidates {
            let p = PathBuf::from(c);
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home_path = PathBuf::from(home);
            let candidates = [
                home_path.join(".local/share/Steam"),
                home_path.join(".steam/steam"),
                home_path.join(".steam/root"),
                home_path.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
                home_path.join(".var/app/com.valvesoftware.Steam/.steam/steam"),
                home_path.join("snap/steam/common/.local/share/Steam"),
            ];
            for p in &candidates {
                if p.exists() {
                    return Some(p.clone());
                }
            }
        }
    }

    None
}

pub fn parse_loginusers_vdf(content: &str) -> (Option<String>, Option<String>) {
    let mut current_account: Option<String> = None;
    let mut current_persona: Option<String> = None;
    let mut current_most_recent = false;

    let mut best_account: Option<String> = None;
    let mut best_persona: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "{" {
            current_account = None;
            current_persona = None;
            current_most_recent = false;
            continue;
        }

        if trimmed == "}" {
            if current_most_recent && current_persona.is_some() {
                return (current_account, current_persona);
            }
            if best_persona.is_none() && current_persona.is_some() {
                best_account = current_account.clone();
                best_persona = current_persona.clone();
            }
            continue;
        }

        let parts: Vec<&str> = trimmed
            .split('"')
            .filter(|s| !s.trim().is_empty())
            .collect();

        if parts.len() >= 2 {
            let key = parts[0].trim();
            let val = parts[1].trim();
            if key.eq_ignore_ascii_case("AccountName") {
                current_account = Some(val.to_string());
            } else if key.eq_ignore_ascii_case("PersonaName") {
                current_persona = Some(val.to_string());
            } else if key.eq_ignore_ascii_case("MostRecent") {
                current_most_recent = val == "1";
            }
        }
    }

    (best_account, best_persona)
}

pub fn parse_libraryfolders_vdf(content: &str) -> Vec<PathBuf> {
    let mut libraries = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed
            .split('"')
            .filter(|s| !s.trim().is_empty())
            .collect();

        if parts.len() >= 2 {
            let key = parts[0].trim();
            let val = parts[1].trim();
            if key.eq_ignore_ascii_case("path") {
                let p = PathBuf::from(val);
                if p.exists() && !libraries.contains(&p) {
                    libraries.push(p);
                }
            }
        }
    }

    libraries
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

pub fn get_candidate_doom_dirs(steam_root: &Path, libraries: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let doom_subdirs = [
        "steamapps/common/DOOM + DOOM II",
        "steamapps/common/Ultimate Doom",
        "steamapps/common/Doom 2",
        "steamapps/common/Final Doom",
        "steamapps/common/Master Levels of Doom",
    ];

    let mut all_roots: Vec<PathBuf> = Vec::new();
    if !libraries.contains(&steam_root.to_path_buf()) {
        all_roots.push(steam_root.to_path_buf());
    }
    all_roots.extend_from_slice(libraries);

    for root in &all_roots {
        for sub in &doom_subdirs {
            let p = root.join(sub);
            if p.exists() && !candidates.contains(&p) {
                candidates.push(p);
            }
        }
    }

    let staging_candidates = [
        steam_root.join("steamapps/content/app_2280/depot_2281"),
        steam_root.join("Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2280/depot_2281"),
    ];
    for staging in &staging_candidates {
        if staging.exists() && !candidates.contains(staging) {
            candidates.push(staging.clone());
        }
    }

    candidates
}

pub fn scan_wads_in_dirs(dirs: &[PathBuf], wanted: &[String]) -> Vec<String> {
    let wanted_lower: HashSet<String> = wanted.iter().map(|w| w.to_lowercase()).collect();
    let mut found = HashSet::new();

    for dir in dirs {
        let mut files = Vec::new();
        let _ = walk_files(dir, &mut files);
        for path in files {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if wanted_lower.contains(&lower) {
                    found.insert(lower);
                }
            }
        }
    }

    let mut list: Vec<String> = found.into_iter().collect();
    list.sort();
    list
}

pub fn detect_steam(custom_steam_path: Option<&str>, wanted: &[String]) -> SteamStatus {
    let steam_root = custom_steam_path
        .map(PathBuf::from)
        .or_else(find_steam_root);

    let Some(root) = steam_root else {
        return SteamStatus {
            installed: false,
            steam_path: None,
            account_name: None,
            persona_name: None,
            libraries: vec![],
            candidate_dirs: vec![],
            found_wads: vec![],
            staging_dir: None,
        };
    };

    let mut account_name = None;
    let mut persona_name = None;

    let loginusers_path = root.join("config/loginusers.vdf");
    if let Ok(content) = std::fs::read_to_string(&loginusers_path) {
        let (acc, persona) = parse_loginusers_vdf(&content);
        account_name = acc;
        persona_name = persona;
    }

    let mut libraries = Vec::new();
    let libraryfolders_path = root.join("steamapps/libraryfolders.vdf");
    if let Ok(content) = std::fs::read_to_string(&libraryfolders_path) {
        libraries = parse_libraryfolders_vdf(&content);
    }
    if !libraries.contains(&root) {
        libraries.insert(0, root.clone());
    }

    let candidate_dirs = get_candidate_doom_dirs(&root, &libraries);
    let found_wads = scan_wads_in_dirs(&candidate_dirs, wanted);

    let staging_candidates = [
        root.join("steamapps/content/app_2280/depot_2281"),
        root.join("Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2280/depot_2281"),
    ];
    let staging_dir = staging_candidates
        .iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());

    SteamStatus {
        installed: true,
        steam_path: Some(root.to_string_lossy().to_string()),
        account_name,
        persona_name,
        libraries: libraries.into_iter().map(|p| p.to_string_lossy().to_string()).collect(),
        candidate_dirs: candidate_dirs.into_iter().map(|p| p.to_string_lossy().to_string()).collect(),
        found_wads,
        staging_dir,
    }
}

pub fn open_steam_console() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("steam://nav/console")
            .spawn()
            .map_err(|e| format!("Failed to open steam console: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", "steam://nav/console"])
            .spawn()
            .map_err(|e| format!("Failed to open steam console: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg("steam://nav/console")
            .spawn()
            .map_err(|e| format!("Failed to open steam console: {e}"))?;
        Ok(())
    }
}

pub fn inspect_steam_content_log(steam_root: &Path) -> SteamLogStatus {
    let staging_candidates = [
        steam_root.join("steamapps/content/app_2280/depot_2281"),
        steam_root.join("Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_2280/depot_2281"),
    ];

    let core_wads = [
        "doom.wad".to_string(),
        "doom2.wad".to_string(),
        "id1.wad".to_string(),
    ];
    let found_core = scan_wads_in_dirs(&staging_candidates, &core_wads);
    if found_core.len() >= 3 {
        return SteamLogStatus {
            state: "complete".to_string(),
            message: Some("Core game files detected in Steam depot cache".to_string()),
        };
    }

    let log_path = steam_root.join("logs/content_log.txt");
    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => {
            return SteamLogStatus {
                state: "idle".to_string(),
                message: None,
            };
        }
    };

    for line in content.lines().rev().take(150) {
        let lower = line.to_lowercase();
        if lower.contains("2281") || lower.contains("2280") {
            if lower.contains("depot download complete") {
                return SteamLogStatus {
                    state: "complete".to_string(),
                    message: Some("Steam download complete".to_string()),
                };
            }
            if lower.contains("depot download failed") {
                let msg = if lower.contains("not owned") || lower.contains("401") {
                    "Game not owned on this Steam account or access denied".to_string()
                } else if lower.contains("disk write error") {
                    "Disk write error encountered in Steam".to_string()
                } else {
                    format!("Steam reported download failure: {}", line.trim())
                };
                return SteamLogStatus {
                    state: "failed".to_string(),
                    message: Some(msg),
                };
            }
            if lower.contains("downloading")
                || lower.contains("update started")
                || lower.contains("preallocating")
                || lower.contains("processing")
            {
                return SteamLogStatus {
                    state: "downloading".to_string(),
                    message: Some("Steam is actively downloading depot files...".to_string()),
                };
            }
        }
    }

    SteamLogStatus {
        state: "idle".to_string(),
        message: None,
    }
}

pub fn import_steam_wads(
    src_dir: &str,
    dest_dir: &str,
    wanted: &[String],
) -> Result<SteamImportResult, String> {
    let wanted_lower: Vec<String> = wanted.iter().map(|w| w.to_lowercase()).collect();
    let src = Path::new(src_dir);
    let dest = Path::new(dest_dir);

    if !src.exists() {
        return Err(format!("Source directory does not exist: {}", src_dir));
    }

    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create destination directory {}: {}", dest_dir, e))?;

    let mut files = Vec::new();
    walk_files(src, &mut files)?;
    files.sort();

    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    let mut total_found = 0;
    let mut seen_in_this_pass = HashSet::new();

    for path in files {
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(|n| n.to_lowercase()) else {
            continue;
        };

        if !wanted_lower.contains(&name) {
            continue;
        }

        total_found += 1;

        if seen_in_this_pass.contains(&name) {
            continue;
        }
        seen_in_this_pass.insert(name.clone());

        let target_file = dest.join(&name);
        let src_metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                skipped.push(format!("{}: failed to read source metadata ({})", name, e));
                continue;
            }
        };
        let src_size = src_metadata.len();

        if target_file.exists() {
            if let Ok(dest_meta) = std::fs::metadata(&target_file) {
                if dest_meta.len() == src_size {
                    skipped.push(format!("{}: already present in library", name));
                    continue;
                } else {
                    skipped.push(format!(
                        "{}: preserved existing custom file (size mismatch: local {} bytes vs steam {} bytes)",
                        name,
                        dest_meta.len(),
                        src_size
                    ));
                    continue;
                }
            }
        }

        std::fs::copy(&path, &target_file).map_err(|e| {
            format!("Failed to copy {} -> {}: {}", path.display(), target_file.display(), e)
        })?;

        imported.push(CollectedWad {
            name,
            size: src_size,
        });
    }

    Ok(SteamImportResult {
        imported,
        skipped,
        total_found,
    })
}

pub fn cleanup_steam_staging(staging_dir: &str) -> Result<(), String> {
    let p = Path::new(staging_dir);
    if !p.exists() {
        return Ok(());
    }

    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Invalid staging directory path: {}", e))?;
    let path_str = canonical.to_string_lossy().replace('\\', "/");

    if path_str.contains("steamapps/common") {
        return Err("Refusing to delete: directory is an active game installation, not a staging cache.".to_string());
    }

    if !path_str.contains("steamapps/content/app_2280") {
        return Err("Refusing to delete: path is not within the Steam content staging depot for Doom.".to_string());
    }

    // Safely remove the staging directory
    std::fs::remove_dir_all(&canonical)
        .map_err(|e| format!("Failed to remove staging directory {}: {}", canonical.display(), e))?;

    // If parent directory is app_2280, clean it up ONLY if it is empty
    if let Some(parent) = canonical.parent() {
        if parent.file_name().and_then(|n| n.to_str()) == Some("app_2280") {
            let _ = std::fs::remove_dir(parent);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_archives::create_temp_dir;

    #[test]
    fn test_parse_loginusers_vdf() {
        let content = r#"
"users"
{
    "76561198015323984"
    {
        "AccountName"       "testuser"
        "PersonaName"       "DoomSlayer"
        "RememberPassword"  "1"
        "MostRecent"        "1"
        "Timestamp"         "1790011494"
    }
}
"#;
        let (acc, persona) = parse_loginusers_vdf(content);
        assert_eq!(acc, Some("testuser".to_string()));
        assert_eq!(persona, Some("DoomSlayer".to_string()));
    }

    #[test]
    fn test_parse_libraryfolders_vdf() {
        let temp = create_temp_dir().unwrap();
        let lib1 = temp.join("lib1");
        let lib2 = temp.join("lib2");
        std::fs::create_dir_all(&lib1).unwrap();
        std::fs::create_dir_all(&lib2).unwrap();

        let content = format!(
            r#"
"libraryfolders"
{{
    "0"
    {{
        "path"      "{}"
    }}
    "1"
    {{
        "path"      "{}"
    }}
}}
"#,
            lib1.to_string_lossy(),
            lib2.to_string_lossy()
        );

        let parsed = parse_libraryfolders_vdf(&content);
        assert_eq!(parsed.len(), 2);
        assert!(parsed.contains(&lib1));
        assert!(parsed.contains(&lib2));
    }

    #[test]
    fn test_import_steam_wads_zero_overwrite_guard() {
        let src = create_temp_dir().unwrap();
        let dest = create_temp_dir().unwrap();

        let src_sub = src.join("base");
        std::fs::create_dir_all(&src_sub).unwrap();
        std::fs::write(src_sub.join("DOOM.WAD"), b"OFFICIAL_DOOM").unwrap();
        std::fs::write(src_sub.join("DOOM2.WAD"), b"OFFICIAL_DOOM2_NEW").unwrap();

        std::fs::write(dest.join("doom2.wad"), b"CUSTOM_MODIFIED_DOOM2_DIFFERENT_SIZE").unwrap();

        let wanted = vec!["doom.wad".to_string(), "doom2.wad".to_string()];
        let res = import_steam_wads(
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
            &wanted,
        )
        .unwrap();

        assert_eq!(res.imported.len(), 1);
        assert_eq!(res.imported[0].name, "doom.wad");
        assert_eq!(std::fs::read(dest.join("doom.wad")).unwrap(), b"OFFICIAL_DOOM");

        assert_eq!(
            std::fs::read(dest.join("doom2.wad")).unwrap(),
            b"CUSTOM_MODIFIED_DOOM2_DIFFERENT_SIZE"
        );
        assert!(res.skipped.iter().any(|s| s.contains("doom2.wad") && s.contains("preserved")));
    }

    #[test]
    fn test_cleanup_steam_staging_sandbox() {
        let temp = create_temp_dir().unwrap();

        let common_dir = temp.join("steamapps/common/Ultimate Doom");
        std::fs::create_dir_all(&common_dir).unwrap();
        let err = cleanup_steam_staging(common_dir.to_str().unwrap());
        assert!(err.is_err());
        assert!(common_dir.exists());

        let staging_dir = temp.join("steamapps/content/app_2280/depot_2281");
        std::fs::create_dir_all(&staging_dir).unwrap();
        let ok = cleanup_steam_staging(staging_dir.to_str().unwrap());
        assert!(ok.is_ok());
        assert!(!staging_dir.exists());
    }

    #[test]
    fn test_inspect_steam_content_log_detects_staging_wads() {
        let temp = create_temp_dir().unwrap();
        let staging = temp.join("steamapps/content/app_2280/depot_2281");
        let base = staging.join("base");
        let rerelease = staging.join("rerelease");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&rerelease).unwrap();

        std::fs::write(base.join("DOOM.WAD"), b"X".repeat(100)).unwrap();
        std::fs::write(base.join("doom2.wad"), b"X".repeat(100)).unwrap();
        std::fs::write(rerelease.join("id1.wad"), b"X".repeat(100)).unwrap();

        let status = inspect_steam_content_log(&temp);
        assert_eq!(status.state, "complete");
    }
}
