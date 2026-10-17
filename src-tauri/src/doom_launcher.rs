use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherGamePreview {
    pub id: i64,
    pub title: String,
    pub filename: String,
    pub author: String,
    pub release_date: Option<String>,
    pub iwad: String,
    pub tags: Vec<String>,
    pub saves_count: usize,
    pub stats_count: usize,
    pub minutes_played: i64,
    pub last_played: Option<String>,
    pub comments: String,
    pub description: String,
    pub rating: Option<i64>,
    pub extra_params: String,
    pub map_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherInspection {
    pub db_path: String,
    pub detected_root: String,
    pub detected_save_root: String,
    pub total_games: usize,
    pub total_tags: usize,
    pub tags: Vec<String>,
    pub games_preview: Vec<DoomLauncherGamePreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherSaveFile {
    pub file_id: i64,
    pub file_name: String,
    pub original_file_name: String,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherStatItem {
    pub stat_id: i64,
    pub map_name: String,
    pub kill_count: i64,
    pub total_kills: i64,
    pub secret_count: i64,
    pub total_secrets: i64,
    pub item_count: i64,
    pub total_items: i64,
    pub level_time: f64,
    pub record_time: String,
    pub skill: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherImportItem {
    pub game_file_id: i64,
    pub title: String,
    pub slug: String,
    pub filename: String,
    pub original_db_path: String,
    pub resolved_path: Option<String>,
    pub author: String,
    pub year: i32,
    pub description: String,
    pub comments: String,
    pub iwad: String,
    pub game_type: String,
    pub tags: Vec<String>,
    pub rating: Option<i64>,
    pub extra_args: Vec<String>,
    pub minutes_played: i64,
    pub last_played: Option<String>,
    pub save_files: Vec<DoomLauncherSaveFile>,
    pub stats: Vec<DoomLauncherStatItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathVerifyResult {
    pub total: usize,
    pub matched: usize,
    pub missing: Vec<String>,
    pub ready_items: Vec<DoomLauncherImportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoomLauncherImportOptions {
    pub db_path: String,
    pub source_root: String,
    pub target_root: String,
    pub selected_game_ids: Option<Vec<i64>>,
    pub import_metadata: bool,
    pub import_tags: bool,
    pub import_saves: bool,
    pub import_stats: bool,
    pub copy_to_library: bool,
    #[serde(default)]
    pub overwrite_existing: bool,
    /// Exact matches resolved against the bundled frontend catalog.  The Rust
    /// backend deliberately does not read source-tree catalog files at runtime.
    #[serde(default)]
    pub catalog_matches: HashMap<i64, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSummary {
    pub imported_games: usize,
    pub imported_tags: usize,
    pub imported_saves: usize,
    pub imported_stats: usize,
    pub skipped: usize,
}

/// Move per-WAD user data when a former `custom-*` import is adopted by the
/// bundled catalog. `rename` keeps files intact and is atomic on the library's
/// filesystem. Existing target data wins, so a re-import cannot overwrite it.
fn move_import_data(lib_root: &Path, from_slug: &str, to_slug: &str) -> Result<(), String> {
    if from_slug == to_slug {
        return Ok(());
    }
    for directory in ["saves", "stats", "sessions"] {
        let source = lib_root.join(directory).join(from_slug);
        let target = lib_root.join(directory).join(to_slug);
        if source.exists() && !target.exists() {
            fs::rename(&source, &target).map_err(|e| format!(
                "Failed to move {} to {}: {}", source.display(), target.display(), e
            ))?;
        }
    }
    let source = lib_root.join("level-names").join(format!("{}.json", from_slug));
    let target = lib_root.join("level-names").join(format!("{}.json", to_slug));
    if source.exists() && !target.exists() {
        fs::rename(&source, &target).map_err(|e| format!(
            "Failed to move {} to {}: {}", source.display(), target.display(), e
        ))?;
    }
    Ok(())
}

/// Normalizes Windows or Unix slashes to forward slashes for cross-platform processing.
fn normalize_path_str(path: &str) -> String {
    path.replace('\\', "/")
}

/// Helper to parse release year from strings like "2020-05-01", "01/05/2020", "2020".
fn parse_year_from_string(date_str: Option<&str>) -> i32 {
    let now_year = 2026;
    if let Some(s) = date_str {
        // Look for 4 consecutive digits that look like a year (1993..now_year+1)
        let chars: Vec<char> = s.chars().collect();
        for i in 0..chars.len().saturating_sub(3) {
            if chars[i].is_ascii_digit()
                && chars[i + 1].is_ascii_digit()
                && chars[i + 2].is_ascii_digit()
                && chars[i + 3].is_ascii_digit()
            {
                let yr_slice: String = chars[i..i + 4].iter().collect();
                if let Ok(yr) = yr_slice.parse::<i32>() {
                    if (1993..=now_year + 1).contains(&yr) {
                        return yr;
                    }
                }
            }
        }
    }
    1994
}

/// Maps DoomLauncher IWad name / filename to RDL IWAD enum.
fn map_iwad_name(name_or_file: Option<&str>) -> String {
    let lower = name_or_file.unwrap_or("").to_ascii_lowercase();
    if lower.contains("plutonia") {
        "plutonia".to_string()
    } else if lower.contains("tnt") {
        "tnt".to_string()
    } else if lower.contains("doom2") || lower.contains("doom 2") || lower.contains("hell on earth") {
        "doom2".to_string()
    } else if lower.contains("heretic") {
        "heretic".to_string()
    } else if lower.contains("hexen") {
        "hexen".to_string()
    } else if lower.contains("freedoom2") {
        "freedoom2".to_string()
    } else if lower.contains("freedoom") {
        "freedoom1".to_string()
    } else if lower.contains("doom") {
        "doom".to_string()
    } else {
        "doom2".to_string()
    }
}

/// Infer game type (megawad, episode, single-level, gameplay-mod, etc.).
fn infer_game_type(map_count: Option<i64>, tags: &[String], title: &str) -> String {
    let title_lower = title.to_ascii_lowercase();
    let has_mod_tag = tags.iter().any(|t| {
        let tl = t.to_ascii_lowercase();
        tl.contains("mod") || tl.contains("gameplay") || tl.contains("hud") || tl.contains("weapon")
    });

    if has_mod_tag || title_lower.contains("hud") || title_lower.contains("brutality") {
        return "gameplay-mod".to_string();
    }

    if let Some(count) = map_count {
        if count > 15 {
            "megawad".to_string()
        } else if count > 1 {
            "episode".to_string()
        } else {
            "single-level".to_string()
        }
    } else {
        "megawad".to_string()
    }
}

/// Simple slug generator for Rust.
fn to_kebab(s: &str) -> String {
    let mut result = String::new();
    let mut last_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            result.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            result.push('-');
            last_dash = true;
        }
    }
    result.trim_matches('-').to_string()
}

/// Detects the longest common path prefix among game filenames in the SQLite DB.
fn detect_common_prefix(paths: &[String]) -> String {
    let mut dir_paths: Vec<String> = Vec::new();
    for p in paths {
        let norm = normalize_path_str(p);
        if let Some(pos) = norm.rfind('/') {
            let dir = &norm[..=pos];
            if !dir.is_empty() {
                dir_paths.push(dir.to_string());
            }
        }
    }

    if dir_paths.is_empty() {
        return String::new();
    }

    let first = &dir_paths[0];
    let mut prefix_len = first.len();

    for path in &dir_paths[1..] {
        let mut match_len = 0;
        for (a, b) in first.chars().zip(path.chars()) {
            if a.to_ascii_lowercase() == b.to_ascii_lowercase() {
                match_len += 1;
            } else {
                break;
            }
        }
        if match_len < prefix_len {
            prefix_len = match_len;
        }
    }

    let prefix_slice = &first[..prefix_len];
    if let Some(pos) = prefix_slice.rfind('/') {
        first[..=pos].replace('/', "\\")
    } else {
        String::new()
    }
}

/// Inspect DoomLauncher SQLite database.
pub fn inspect_db(db_path: impl AsRef<Path>) -> Result<DoomLauncherInspection, String> {
    let path = db_path.as_ref();
    if !path.exists() {
        return Err(format!("SQLite file not found: {}", path.display()));
    }

    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open SQLite database {}: {}", path.display(), e))?;

    // Read Configuration table if available
    let mut detected_save_root = String::new();
    if let Ok(mut stmt) = conn.prepare("SELECT Name, Value FROM Configuration WHERE Name = 'SaveGameDirectory'") {
        if let Ok(mut rows) = stmt.query([]) {
            if let Ok(Some(row)) = rows.next() {
                let val: Result<String, _> = row.get(1);
                if let Ok(v) = val {
                    detected_save_root = v;
                }
            }
        }
    }

    // Read Tags
    let mut tags_map: HashMap<i64, String> = HashMap::new();
    let mut tags_list: Vec<String> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT TagID, Name FROM Tags ORDER BY TagID") {
        if let Ok(tag_rows) = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((id, name))
        }) {
            for tag in tag_rows.flatten() {
                tags_list.push(tag.1.clone());
                tags_map.insert(tag.0, tag.1);
            }
        }
    }

    // Read TagMapping (TagMapping.FileID corresponds to GameFiles.GameFileID in DoomLauncher)
    let mut game_tags: HashMap<i64, Vec<String>> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT FileID, TagID FROM TagMapping") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let file_id: i64 = row.get(0)?;
            let tag_id: i64 = row.get(1)?;
            Ok((file_id, tag_id))
        }) {
            for item in rows.flatten() {
                if let Some(tag_name) = tags_map.get(&item.1) {
                    game_tags.entry(item.0).or_default().push(tag_name.clone());
                }
            }
        }
    }

    // Read IWads
    let mut iwads_map: HashMap<i64, String> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT IWadID, Name, FileName FROM IWads") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let name: Option<String> = row.get(1).ok();
            let filename: Option<String> = row.get(2).ok();
            let iwad_id_str = map_iwad_name(name.as_deref().or(filename.as_deref()));
            Ok((id, iwad_id_str))
        }) {
            for (id, iwad_str) in rows.flatten() {
                iwads_map.insert(id, iwad_str);
            }
        }
    }

    // Read Save count per game (Files where FileTypeID = 3)
    let mut saves_count: HashMap<i64, usize> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT GameFileID, COUNT(*) FROM Files WHERE FileTypeID = 3 GROUP BY GameFileID") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let g_id: i64 = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((g_id, cnt as usize))
        }) {
            for (id, cnt) in rows.flatten() {
                saves_count.insert(id, cnt);
            }
        }
    }

    // Read Stats count per game
    let mut stats_count: HashMap<i64, usize> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT GameFileID, COUNT(*) FROM Stats GROUP BY GameFileID") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let g_id: i64 = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((g_id, cnt as usize))
        }) {
            for (id, cnt) in rows.flatten() {
                stats_count.insert(id, cnt);
            }
        }
    }

    // Read GameFiles
    let mut all_paths: Vec<String> = Vec::new();
    let mut games_preview: Vec<DoomLauncherGamePreview> = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT GameFileID, FileName, Title, Author, ReleaseDate, Description, \
             Comments, Rating, IWadID, LastPlayed, MinutesPlayed, SettingsExtraParams, MapCount \
             FROM GameFiles ORDER BY GameFileID",
        )
        .map_err(|e| format!("Failed to prepare GameFiles query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let filename: String = row.get(1).unwrap_or_default();
            let title: Option<String> = row.get(2).ok();
            let author: Option<String> = row.get(3).ok();
            let release_date: Option<String> = row.get(4).ok();
            let description: Option<String> = row.get(5).ok();
            let comments: Option<String> = row.get(6).ok();
            let rating: Option<i64> = row.get(7).ok();
            let iwad_id: Option<i64> = row.get(8).ok();
            let last_played: Option<String> = row.get(9).ok();
            let minutes_played: Option<i64> = row.get(10).ok();
            let extra_params: Option<String> = row.get(11).ok();
            let map_count: Option<i64> = row.get(12).ok();

            Ok((
                id,
                filename,
                title,
                author,
                release_date,
                description,
                comments,
                rating,
                iwad_id,
                last_played,
                minutes_played,
                extra_params,
                map_count,
            ))
        })
        .map_err(|e| format!("Failed to read GameFiles: {}", e))?;

    for item in rows.flatten() {
        let (
            id,
            filename,
            title,
            author,
            release_date,
            description,
            comments,
            rating,
            iwad_id,
            last_played,
            minutes_played,
            extra_params,
            map_count,
        ) = item;

        if !filename.is_empty() {
            all_paths.push(filename.clone());
        }

        let fallback_title = if let Some(p) = filename.rfind(['/', '\\']) {
            filename[p + 1..].to_string()
        } else {
            filename.clone()
        };

        let resolved_title = title.filter(|t| !t.trim().is_empty()).unwrap_or(fallback_title);
        let resolved_author = author.unwrap_or_default();
        let tags = game_tags.get(&id).cloned().unwrap_or_default();
        let iwad = iwad_id
            .and_then(|iid| iwads_map.get(&iid))
            .cloned()
            .unwrap_or_else(|| "doom2".to_string());

        let save_cnt = saves_count.get(&id).copied().unwrap_or(0);
        let stat_cnt = stats_count.get(&id).copied().unwrap_or(0);

        games_preview.push(DoomLauncherGamePreview {
            id,
            title: resolved_title,
            filename,
            author: resolved_author,
            release_date,
            iwad,
            tags,
            saves_count: save_cnt,
            stats_count: stat_cnt,
            minutes_played: minutes_played.unwrap_or(0),
            last_played,
            comments: comments.unwrap_or_default(),
            description: description.unwrap_or_default(),
            rating,
            extra_params: extra_params.unwrap_or_default(),
            map_count,
        });
    }

    let detected_root = detect_common_prefix(&all_paths);

    Ok(DoomLauncherInspection {
        db_path: path.to_string_lossy().to_string(),
        detected_root,
        detected_save_root,
        total_games: games_preview.len(),
        total_tags: tags_list.len(),
        tags: tags_list,
        games_preview,
    })
}

/// Expands leading `~` or `~/` to the user's home directory.
fn expand_tilde(path_str: &str) -> PathBuf {
    let trimmed = path_str.trim();
    if trimmed == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    } else if let Some(stripped) = trimmed.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    } else if let Some(stripped) = trimmed.strip_prefix("~\\") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(trimmed)
}

/// Normalizes strings for loose name comparisons (alphanumeric only, lowercase).
fn loose_key(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Recursively indexes files in a directory up to max_depth.
fn index_directory_files(
    dir: &Path,
    max_depth: usize,
    current_depth: usize,
    map: &mut HashMap<String, PathBuf>,
) {
    if current_depth > max_depth || !dir.is_dir() {
        return;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                let path = entry.path();
                if ft.is_file() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let lower = file_name.to_ascii_lowercase();
                    let loose = loose_key(&file_name);
                    map.entry(lower).or_insert_with(|| path.clone());
                    if !loose.is_empty() {
                        map.entry(loose).or_insert(path);
                    }
                } else if ft.is_dir() {
                    index_directory_files(&path, max_depth, current_depth + 1, map);
                }
            }
        }
    }
}

/// Resolves a game path from DB into a local file path on disk.
fn resolve_candidate_path(
    db_file_name: &str,
    source_root: &str,
    target_root: &str,
    db_dir: Option<&Path>,
    file_index: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    let norm_db = normalize_path_str(db_file_name);
    let norm_source = normalize_path_str(source_root);

    let base_name = if let Some(pos) = norm_db.rfind('/') {
        &norm_db[pos + 1..]
    } else {
        &norm_db
    };

    if base_name.is_empty() {
        return None;
    }

    // 1. Direct check: Does db_file_name exist directly as a path?
    let direct_path = expand_tilde(db_file_name);
    if direct_path.is_file() {
        return Some(direct_path);
    }

    let target_dir = expand_tilde(target_root);

    // 2. If source_root prefix matched
    if !norm_source.is_empty() && target_dir.is_dir() {
        let source_clean = norm_source.trim_end_matches('/');
        if norm_db.to_ascii_lowercase().starts_with(&source_clean.to_ascii_lowercase()) {
            let rel = &norm_db[source_clean.len()..];
            let rel_clean = rel.trim_start_matches('/');
            let candidate = target_dir.join(rel_clean);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 3. Check directly in target_root / base_name
    if target_dir.is_dir() {
        let candidate = target_dir.join(base_name);
        if candidate.is_file() {
            return Some(candidate);
        }

        // Check common subfolders: Games, GameFiles, GameWads, Mods, etc.
        for sub in &[
            "Games",
            "GameFiles",
            "GameWads",
            "GameFiles/GameWads",
            "Mods",
            "Enhancement",
            "UI",
            "Graphics",
            "Wads",
            "Weapons",
        ] {
            let candidate = target_dir.join(sub).join(base_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 4. Check adjacent to SQLite DB (e.g. DoomLauncher/GameFiles/)
    if let Some(db_parent) = db_dir {
        let candidate = db_parent.join("GameFiles").join(base_name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let candidate_direct = db_parent.join(base_name);
        if candidate_direct.is_file() {
            return Some(candidate_direct);
        }
        for sub in &["GameFiles/GameWads", "GameFiles/Games", "Backup"] {
            let candidate = db_parent.join(sub).join(base_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 5. Lookup in pre-indexed directory files
    let lower_base = base_name.to_ascii_lowercase();
    if let Some(found) = file_index.get(&lower_base) {
        if found.is_file() {
            return Some(found.clone());
        }
    }

    let loose = loose_key(base_name);
    if !loose.is_empty() {
        if let Some(found) = file_index.get(&loose) {
            if found.is_file() {
                return Some(found.clone());
            }
        }
    }

    None
}

/// Resolves save files for a game in candidate directories or indexed map.
fn resolve_save_file_path(
    save_filename: &str,
    target_root: &str,
    db_dir: Option<&Path>,
    save_index: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    let target_dir = expand_tilde(target_root);
    let sub_paths = [
        "SaveGames",
        "GameFiles/SaveGames",
        "saves",
        "GameFiles/saves",
        "",
    ];

    if target_dir.is_dir() {
        for sub in &sub_paths {
            let candidate = if sub.is_empty() {
                target_dir.join(save_filename)
            } else {
                target_dir.join(sub).join(save_filename)
            };
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    if let Some(db_parent) = db_dir {
        for sub in &["GameFiles/SaveGames", "SaveGames", "GameFiles/saves", ""] {
            let candidate = if sub.is_empty() {
                db_parent.join(save_filename)
            } else {
                db_parent.join(sub).join(save_filename)
            };
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // Check index
    let lower = save_filename.to_ascii_lowercase();
    if let Some(p) = save_index.get(&lower) {
        if p.is_file() {
            return Some(p.clone());
        }
    }

    None
}

/// Verify game files and save files on disk before performing the import.
pub fn verify_files(
    db_path: impl AsRef<Path>,
    source_root: &str,
    target_root: &str,
) -> Result<PathVerifyResult, String> {
    let inspection = inspect_db(&db_path)?;
    let db_path_ref = db_path.as_ref();
    let conn = Connection::open_with_flags(
        db_path_ref,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open DB for verify: {}", e))?;

    let db_path_buf = expand_tilde(db_path_ref.to_str().unwrap_or(""));
    let db_dir = db_path_buf.parent();
    let target_dir = expand_tilde(target_root);

    // Build recursive file and save index
    let mut file_index: HashMap<String, PathBuf> = HashMap::new();
    let mut save_index: HashMap<String, PathBuf> = HashMap::new();

    if let Some(parent) = db_dir {
        index_directory_files(parent, 4, 0, &mut file_index);
        let save_dir = parent.join("GameFiles/SaveGames");
        if save_dir.is_dir() {
            index_directory_files(&save_dir, 2, 0, &mut save_index);
        }
    }

    if target_dir.is_dir() {
        index_directory_files(&target_dir, 5, 0, &mut file_index);
        let save_dir = target_dir.join("SaveGames");
        if save_dir.is_dir() {
            index_directory_files(&save_dir, 2, 0, &mut save_index);
        }
        let gf_save_dir = target_dir.join("GameFiles/SaveGames");
        if gf_save_dir.is_dir() {
            index_directory_files(&gf_save_dir, 2, 0, &mut save_index);
        }
    }

    // Read Save files (`Files` with FileTypeID = 3)
    let mut game_saves: HashMap<i64, Vec<DoomLauncherSaveFile>> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT FileID, GameFileID, FileName, OriginalFileName FROM Files WHERE FileTypeID = 3",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let file_id: i64 = row.get(0)?;
            let game_file_id: i64 = row.get(1)?;
            let file_name: String = row.get(2)?;
            let orig_name: Option<String> = row.get(3).ok();
            Ok((file_id, game_file_id, file_name, orig_name))
        }) {
            for (file_id, game_file_id, file_name, orig_name) in rows.flatten() {
                let original_file_name = orig_name.unwrap_or_else(|| file_name.clone());
                let resolved_path = resolve_save_file_path(&file_name, target_root, db_dir, &save_index)
                    .or_else(|| resolve_save_file_path(&original_file_name, target_root, db_dir, &save_index))
                    .map(|p| p.to_string_lossy().to_string());

                game_saves.entry(game_file_id).or_default().push(DoomLauncherSaveFile {
                    file_id,
                    file_name,
                    original_file_name,
                    resolved_path,
                });
            }
        }
    }

    // Read Stats
    let mut game_stats: HashMap<i64, Vec<DoomLauncherStatItem>> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT StatID, GameFileID, MapName, KillCount, TotalKills, SecretCount, \
         TotalSecrets, ItemCount, TotalItems, LevelTime, RecordTime, Skill FROM Stats",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let stat_id: i64 = row.get(0)?;
            let game_file_id: i64 = row.get(1)?;
            let map_name: String = row.get(2)?;
            let kill_count: i64 = row.get(3)?;
            let total_kills: i64 = row.get(4)?;
            let secret_count: i64 = row.get(5)?;
            let total_secrets: i64 = row.get(6)?;
            let item_count: i64 = row.get(7)?;
            let total_items: i64 = row.get(8)?;
            let level_time: f64 = row.get(9)?;
            let record_time: String = row.get(10)?;
            let skill: Option<i64> = row.get(11).ok();

            Ok((
                stat_id,
                game_file_id,
                map_name,
                kill_count,
                total_kills,
                secret_count,
                total_secrets,
                item_count,
                total_items,
                level_time,
                record_time,
                skill,
            ))
        }) {
            for item in rows.flatten() {
                let (
                    stat_id,
                    game_file_id,
                    map_name,
                    kill_count,
                    total_kills,
                    secret_count,
                    total_secrets,
                    item_count,
                    total_items,
                    level_time,
                    record_time,
                    skill,
                ) = item;
                game_stats.entry(game_file_id).or_default().push(DoomLauncherStatItem {
                    stat_id,
                    map_name,
                    kill_count,
                    total_kills,
                    secret_count,
                    total_secrets,
                    item_count,
                    total_items,
                    level_time,
                    record_time,
                    skill,
                });
            }
        }
    }

    let mut ready_items: Vec<DoomLauncherImportItem> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    let mut matched_count = 0;

    let mut used_slugs: HashSet<String> = HashSet::new();

    for game in inspection.games_preview {
        let resolved = resolve_candidate_path(&game.filename, source_root, target_root, db_dir, &file_index);
        let resolved_path_str = resolved.as_ref().map(|p| p.to_string_lossy().to_string());

        let norm_name = normalize_path_str(&game.filename);
        let base_filename = if let Some(pos) = norm_name.rfind('/') {
            norm_name[pos + 1..].to_string()
        } else {
            norm_name.clone()
        };

        if resolved.is_some() {
            matched_count += 1;
        } else {
            missing.push(base_filename.clone());
        }

        // Generate clean unique slug
        let mut base_slug = to_kebab(&game.title);
        if base_slug.is_empty() {
            base_slug = to_kebab(&base_filename);
        }
        if base_slug.is_empty() {
            base_slug = format!("dl-game-{}", game.id);
        }

        let mut candidate_slug = format!("custom-{}", base_slug);
        let mut counter = 2;
        while used_slugs.contains(&candidate_slug) {
            candidate_slug = format!("custom-{}-{}", base_slug, counter);
            counter += 1;
        }
        used_slugs.insert(candidate_slug.clone());

        let year = parse_year_from_string(game.release_date.as_deref());
        let game_type = infer_game_type(game.map_count, &game.tags, &game.title);

        let extra_args: Vec<String> = game
            .extra_params
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        let saves = game_saves.remove(&game.id).unwrap_or_default();
        let stats = game_stats.remove(&game.id).unwrap_or_default();

        ready_items.push(DoomLauncherImportItem {
            game_file_id: game.id,
            title: game.title,
            slug: candidate_slug,
            filename: base_filename,
            original_db_path: game.filename,
            resolved_path: resolved_path_str,
            author: if game.author.trim().is_empty() {
                "DoomLauncher Import".to_string()
            } else {
                game.author
            },
            year,
            description: game.description,
            comments: game.comments,
            iwad: game.iwad,
            game_type,
            tags: game.tags,
            rating: game.rating,
            extra_args,
            minutes_played: game.minutes_played,
            last_played: game.last_played,
            save_files: saves,
            stats,
        });
    }

    Ok(PathVerifyResult {
        total: ready_items.len(),
        matched: matched_count,
        missing,
        ready_items,
    })
}

/// Execute import of verified items into the RDL library.
pub fn execute_import(
    library_path: impl AsRef<Path>,
    options: DoomLauncherImportOptions,
) -> Result<ImportSummary, String> {
    let lib_root = library_path.as_ref();
    if !lib_root.exists() {
        return Err(format!("Library directory does not exist: {}", lib_root.display()));
    }

    let verification = verify_files(&options.db_path, &options.source_root, &options.target_root)?;

    let selected_set: Option<HashSet<i64>> = options
        .selected_game_ids
        .map(|ids| ids.into_iter().collect());

    // Read existing custom-wads.json
    let custom_wads_path = lib_root.join("custom-wads.json");
    let mut existing_custom_wads: Vec<serde_json::Value> = Vec::new();
    if custom_wads_path.exists() {
        if let Ok(content) = fs::read_to_string(&custom_wads_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(entries) = json.get("entries").and_then(|e| e.as_array()) {
                    existing_custom_wads = entries.clone();
                }
            }
        }
    }

    let mut existing_slugs: HashSet<String> = existing_custom_wads
        .iter()
        .filter_map(|e| e.get("slug").and_then(|s| s.as_str()).map(|s| s.to_string()))
        .collect();

    // Read existing launcher-downloads.json
    let downloads_path = lib_root.join("launcher-downloads.json");
    let mut downloads_map: HashMap<String, serde_json::Value> = HashMap::new();
    if downloads_path.exists() {
        if let Ok(content) = fs::read_to_string(&downloads_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(dl) = json.get("downloads").and_then(|d| d.as_object()) {
                    for (k, v) in dl {
                        downloads_map.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    let ratings_path = lib_root.join("wad-ratings.json");
    let mut ratings_map: HashMap<String, serde_json::Value> = HashMap::new();
    if let Ok(content) = fs::read_to_string(&ratings_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(ratings) = json.get("ratings").and_then(|r| r.as_object()) {
                for (slug, rating) in ratings {
                    ratings_map.insert(slug.clone(), rating.clone());
                }
            }
        }
    }

    let mut imported_games = 0;
    let mut imported_saves = 0;
    let mut imported_stats = 0;
    let mut skipped = 0;

    let mut all_tags_set: HashSet<String> = HashSet::new();

    for item in verification.ready_items {
        if let Some(ref sel) = selected_set {
            if !sel.contains(&item.game_file_id) {
                skipped += 1;
                continue;
            }
        }

        // We require a resolved source file to import
        let source_file_path = match item.resolved_path {
            Some(ref p) => PathBuf::from(p),
            None => {
                skipped += 1;
                continue;
            }
        };

        if !source_file_path.is_file() {
            skipped += 1;
            continue;
        }

        // Re-running an import must not make duplicate entries. The verifier
        // produces stable slugs for a database, so an existing slug identifies
        // a game that has already been imported.
        let final_slug = options.catalog_matches.get(&item.game_file_id)
            .cloned()
            .unwrap_or_else(|| item.slug.clone());
        let is_catalog_match = final_slug != item.slug;
        let existing_index = existing_custom_wads
            .iter()
            .position(|entry| entry.get("slug").and_then(|slug| slug.as_str()) == Some(item.slug.as_str())
                || entry.get("slug").and_then(|slug| slug.as_str()) == Some(final_slug.as_str()));
        if (existing_index.is_some() || downloads_map.contains_key(&final_slug)) && !options.overwrite_existing {
            skipped += 1;
            continue;
        }
        existing_slugs.insert(final_slug.clone());

        // A prior import was written as custom before catalog matching existed.
        // Adopt it now and retain all locally collected play data.
        if is_catalog_match {
            if let Some(index) = existing_index {
                let old_slug = existing_custom_wads[index]
                    .get("slug").and_then(|slug| slug.as_str()).unwrap_or(&item.slug).to_string();
                move_import_data(lib_root, &old_slug, &final_slug)?;
                existing_custom_wads.remove(index);
                if let Some(rating) = ratings_map.remove(&old_slug) {
                    ratings_map.entry(final_slug.clone()).or_insert(rating);
                }
                if let Some(download) = downloads_map.remove(&old_slug) {
                    downloads_map.entry(final_slug.clone()).or_insert(download);
                }
            }
        }

        // Handle copying vs external reference
        let file_size = fs::metadata(&source_file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let final_filename: String;
        let final_external_path: String;

        if options.copy_to_library {
            final_filename = item.filename.clone();
            final_external_path = String::new();
            let dest_file = lib_root.join(&final_filename);
            if !dest_file.exists() || options.overwrite_existing {
                if let Err(e) = fs::copy(&source_file_path, &dest_file) {
                    return Err(format!(
                        "Failed to copy game file {} -> {}: {}",
                        source_file_path.display(),
                        dest_file.display(),
                        e
                    ));
                }
            }
        } else {
            final_filename = item.filename.clone();
            final_external_path = source_file_path.to_string_lossy().to_string();
        }

        // Create WadEntry JSON object
        let authors: Vec<serde_json::Value> = item
            .author
            .split([',', ';', '&'])
            .map(|a| a.trim())
            .filter(|a| !a.is_empty())
            .map(|name| serde_json::json!({ "name": name }))
            .collect();

        let authors_array = if authors.is_empty() {
            vec![serde_json::json!({ "name": "DoomLauncher Import" })]
        } else {
            authors
        };

        let tags_to_store = if options.import_tags {
            for t in &item.tags {
                all_tags_set.insert(t.clone());
            }
            item.tags.clone()
        } else {
            Vec::new()
        };

        let now_iso = "2026-08-29T00:00:00.000Z";

        let custom_entry = serde_json::json!({
            "slug": final_slug,
            "title": item.title,
            "authors": authors_array,
            "year": item.year,
            "description": if item.description.is_empty() { "Imported from DoomLauncher" } else { &item.description },
            "iwad": item.iwad,
            "type": item.game_type,
            "sourcePort": "gzdoom",
            "requires": [],
            "downloads": [],
            "thumbnail": "",
            "screenshots": [],
            "youtubeVideos": [],
            "awards": [],
            "tags": tags_to_store,
            "rating": item.rating.unwrap_or(0).clamp(0, 5),
            "difficulty": "unknown",
            "urls": [],
            "notes": item.comments,
            "extraArgs": item.extra_args,
            "_schemaVersion": 1,
            "_source": "custom"
        });

        if options.import_metadata && !is_catalog_match {
            if let Some(index) = existing_index {
                existing_custom_wads[index] = custom_entry;
            } else {
                existing_custom_wads.push(custom_entry);
            }
        }

        // Add to launcher-downloads.json
        downloads_map.insert(
            final_slug.clone(),
            serde_json::json!({
                "filename": final_filename,
                "wadFilename": final_filename,
                "downloadedAt": now_iso,
                "size": file_size,
                "externalPath": final_external_path
            }),
        );

        // Import Save Files if requested
        if options.import_saves && !item.save_files.is_empty() {
            let saves_dir = lib_root.join("saves").join(&final_slug);
            let _ = fs::create_dir_all(&saves_dir);

            for save in item.save_files {
                if let Some(src_str) = save.resolved_path {
                    let src_path = PathBuf::from(src_str);
                    if src_path.is_file() {
                        let dest_name = if save.original_file_name.ends_with(".zds") {
                            save.original_file_name
                        } else {
                            format!("{}.zds", save.original_file_name)
                        };
                        let dest_path = saves_dir.join(dest_name);
                        if fs::copy(&src_path, &dest_path).is_ok() {
                            imported_saves += 1;
                        }
                    }
                }
            }
        }

        // Import Stats if requested
        if options.import_stats && !item.stats.is_empty() {
            let stats_dir = lib_root.join("stats").join(&final_slug);
            let _ = fs::create_dir_all(&stats_dir);

            // Group stats into levels
            let mut levels: Vec<serde_json::Value> = Vec::new();
            let mut start_level = "MAP01".to_string();

            for (idx, stat) in item.stats.iter().enumerate() {
                if idx == 0 {
                    start_level = stat.map_name.clone();
                }
                let time_tics = (stat.level_time * 35.0).round() as u64;
                levels.push(serde_json::json!({
                    "id": stat.map_name,
                    "name": stat.map_name,
                    "kills": stat.kill_count.max(0),
                    "totalKills": stat.total_kills.max(0),
                    "items": stat.item_count.max(0),
                    "totalItems": stat.total_items.max(0),
                    "secrets": stat.secret_count.max(0),
                    "totalSecrets": stat.total_secrets.max(0),
                    "timeTics": time_tics
                }));
            }

            if !levels.is_empty() {
                let session = serde_json::json!({
                    "schemaVersion": 1,
                    "wadSlug": final_slug,
                    "startLevel": start_level,
                    "skill": "UV",
                    "capturedAt": now_iso,
                    "sourceFile": "doomlauncher_import.zds",
                    "levels": levels
                });

                let session_hash = format!("dl_session_{}", item.game_file_id);
                let stat_file = stats_dir.join(format!("{}.json", session_hash));
                if let Ok(json_str) = serde_json::to_string_pretty(&session) {
                    if fs::write(stat_file, json_str).is_ok() {
                        imported_stats += 1;
                    }
                }
            }
        }

        imported_games += 1;
    }

    let imported_tags = all_tags_set.len();

    // Write back custom-wads.json
    let custom_wads_obj = serde_json::json!({
        "version": 1,
        "entries": existing_custom_wads
    });
    let custom_wads_json = serde_json::to_string_pretty(&custom_wads_obj)
        .map_err(|e| format!("Failed to serialize custom-wads.json: {}", e))?;
    fs::write(&custom_wads_path, custom_wads_json)
        .map_err(|e| format!("Failed to write custom-wads.json: {}", e))?;

    // Write back launcher-downloads.json
    let downloads_obj = serde_json::json!({
        "version": 1,
        "downloads": downloads_map
    });
    let downloads_json = serde_json::to_string_pretty(&downloads_obj)
        .map_err(|e| format!("Failed to serialize launcher-downloads.json: {}", e))?;
    fs::write(&downloads_path, downloads_json)
        .map_err(|e| format!("Failed to write launcher-downloads.json: {}", e))?;

    let ratings_obj = serde_json::json!({ "version": 1, "ratings": ratings_map });
    let ratings_json = serde_json::to_string_pretty(&ratings_obj)
        .map_err(|e| format!("Failed to serialize wad-ratings.json: {}", e))?;
    fs::write(&ratings_path, ratings_json)
        .map_err(|e| format!("Failed to write wad-ratings.json: {}", e))?;

    Ok(ImportSummary {
        imported_games,
        imported_tags,
        imported_saves,
        imported_stats,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn test_parse_year() {
        assert_eq!(parse_year_from_string(Some("2019-12-10")), 2019);
        assert_eq!(parse_year_from_string(Some("10/05/2021")), 2021);
        assert_eq!(parse_year_from_string(Some("1994")), 1994);
        assert_eq!(parse_year_from_string(None), 1994);
    }

    #[test]
    fn test_map_iwad_name() {
        assert_eq!(map_iwad_name(Some("DOOM2.zip")), "doom2");
        assert_eq!(map_iwad_name(Some("PLUTONIA.zip")), "plutonia");
        assert_eq!(map_iwad_name(Some("TNT.zip")), "tnt");
        assert_eq!(map_iwad_name(Some("DOOM.zip")), "doom");
    }

    #[test]
    fn test_inspect_and_verify() {
        let temp_dir = std::env::temp_dir().join("rdl_dl_test");
        let _ = fs::create_dir_all(&temp_dir);
        let db_file = temp_dir.join("test_dl.sqlite");

        let conn = Connection::open(&db_file).unwrap();
        conn.execute_batch(
            "CREATE TABLE Configuration (ConfigID INTEGER PRIMARY KEY, Name TEXT, Value TEXT);
             CREATE TABLE Tags (TagID INTEGER PRIMARY KEY, Name TEXT, HasTab INT, HasColor INT, Color INT, ExcludeFromOtherTabs INT, Favorite INT);
             CREATE TABLE TagMapping (FileID INTEGER, TagID INTEGER);
             CREATE TABLE IWads (IWadID INTEGER PRIMARY KEY, Name TEXT, FileName TEXT);
             CREATE TABLE Files (FileID INTEGER PRIMARY KEY, GameFileID INTEGER, FileName TEXT, FileTypeID INTEGER, OriginalFileName TEXT);
             CREATE TABLE GameFiles (GameFileID INTEGER PRIMARY KEY, FileName TEXT, Title TEXT, Author TEXT, ReleaseDate TEXT, Description TEXT, Comments TEXT, Rating INTEGER, IWadID INTEGER, LastPlayed TEXT, MinutesPlayed INTEGER, SettingsExtraParams TEXT, MapCount INTEGER);
             CREATE TABLE Stats (StatID INTEGER PRIMARY KEY, GameFileID INTEGER, MapName TEXT, KillCount INTEGER, TotalKills INTEGER, SecretCount INTEGER, TotalSecrets INTEGER, ItemCount INTEGER, TotalItems INTEGER, LevelTime REAL, RecordTime TEXT, Skill INTEGER);
             
             INSERT INTO Tags VALUES (1, 'Slaughter', 1, 0, 0, 0, 0);
             INSERT INTO Tags VALUES (2, 'Favorite', 1, 0, 0, 0, 1);
             INSERT INTO TagMapping VALUES (10, 1);
             INSERT INTO TagMapping VALUES (10, 2);
             INSERT INTO IWads VALUES (2, 'Doom II', 'DOOM2.zip');
             INSERT INTO GameFiles VALUES (10, 'H:\\Games\\Doom\\DoomMods\\Games\\sunlust.zip', 'Sunlust', 'Dan & Ribbiks', '2015-08-01', 'Hard slaughter wad', 'Great music', 5, 2, '2022-01-01', 120, '-skill 4', 32);
             INSERT INTO Stats VALUES (100, 10, 'MAP01', 50, 50, 2, 2, 10, 10, 120.5, '2022-01-01', 3);
            ",
        ).unwrap();

        let inspection = inspect_db(&db_file).unwrap();
        assert_eq!(inspection.total_games, 1);
        assert_eq!(inspection.total_tags, 2);
        assert_eq!(inspection.games_preview[0].title, "Sunlust");
        assert_eq!(inspection.games_preview[0].tags.len(), 2);
        assert!(inspection.games_preview[0].tags.contains(&"Slaughter".to_string()));

        // Create the dummy game file to test verification
        let game_file = temp_dir.join("sunlust.zip");
        fs::write(&game_file, b"PK...dummy zip").unwrap();

        let verify = verify_files(&db_file, "H:\\Games\\Doom\\DoomMods\\Games", &temp_dir.to_string_lossy()).unwrap();
        assert_eq!(verify.matched, 1);
        assert_eq!(verify.ready_items[0].slug, "custom-sunlust");
        assert_eq!(verify.ready_items[0].game_type, "megawad");
        assert_eq!(verify.ready_items[0].rating, Some(5));

        let library_dir = temp_dir.join("library");
        fs::create_dir_all(&library_dir).unwrap();
        let result = execute_import(
            &library_dir,
            DoomLauncherImportOptions {
                db_path: db_file.to_string_lossy().to_string(),
                source_root: "H:\\Games\\Doom\\DoomMods\\Games".to_string(),
                target_root: temp_dir.to_string_lossy().to_string(),
                selected_game_ids: Some(vec![10]),
                import_metadata: true,
                import_tags: true,
                import_saves: false,
                import_stats: false,
                copy_to_library: false,
                overwrite_existing: false,
                catalog_matches: HashMap::new(),
            },
        ).unwrap();
        assert_eq!(result.imported_games, 1);
        let custom_wads: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(library_dir.join("custom-wads.json")).unwrap(),
        ).unwrap();
        assert_eq!(custom_wads["entries"][0]["rating"], 5);

        let repeat_result = execute_import(
            &library_dir,
            DoomLauncherImportOptions {
                db_path: db_file.to_string_lossy().to_string(),
                source_root: "H:\\Games\\Doom\\DoomMods\\Games".to_string(),
                target_root: temp_dir.to_string_lossy().to_string(),
                selected_game_ids: Some(vec![10]),
                import_metadata: true,
                import_tags: true,
                import_saves: false,
                import_stats: false,
                copy_to_library: false,
                overwrite_existing: false,
                catalog_matches: HashMap::new(),
            },
        ).unwrap();
        assert_eq!(repeat_result.imported_games, 0);
        assert_eq!(repeat_result.skipped, 1);
        let custom_wads: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(library_dir.join("custom-wads.json")).unwrap(),
        ).unwrap();
        assert_eq!(custom_wads["entries"].as_array().unwrap().len(), 1);

        conn.execute("UPDATE GameFiles SET Rating = 4 WHERE GameFileID = 10", []).unwrap();
        let overwrite_result = execute_import(
            &library_dir,
            DoomLauncherImportOptions {
                db_path: db_file.to_string_lossy().to_string(),
                source_root: "H:\\Games\\Doom\\DoomMods\\Games".to_string(),
                target_root: temp_dir.to_string_lossy().to_string(),
                selected_game_ids: Some(vec![10]),
                import_metadata: true,
                import_tags: true,
                import_saves: false,
                import_stats: false,
                copy_to_library: false,
                overwrite_existing: true,
                catalog_matches: HashMap::new(),
            },
        ).unwrap();
        assert_eq!(overwrite_result.imported_games, 1);
        let custom_wads: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(library_dir.join("custom-wads.json")).unwrap(),
        ).unwrap();
        assert_eq!(custom_wads["entries"].as_array().unwrap().len(), 1);
        assert_eq!(custom_wads["entries"][0]["rating"], 4);

        // A catalog match adopts an old custom import without retaining a
        // duplicate custom entry, while keeping its downloaded file record.
        let catalog_result = execute_import(
            &library_dir,
            DoomLauncherImportOptions {
                db_path: db_file.to_string_lossy().to_string(),
                source_root: "H:\\Games\\Doom\\DoomMods\\Games".to_string(),
                target_root: temp_dir.to_string_lossy().to_string(),
                selected_game_ids: Some(vec![10]),
                import_metadata: true,
                import_tags: true,
                import_saves: false,
                import_stats: false,
                copy_to_library: false,
                overwrite_existing: true,
                catalog_matches: HashMap::from([(10, "sunlust".to_string())]),
            },
        ).unwrap();
        assert_eq!(catalog_result.imported_games, 1);
        let custom_wads: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(library_dir.join("custom-wads.json")).unwrap(),
        ).unwrap();
        assert!(custom_wads["entries"].as_array().unwrap().is_empty());
        let downloads: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(library_dir.join("launcher-downloads.json")).unwrap(),
        ).unwrap();
        assert!(downloads["downloads"].get("sunlust").is_some());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_inspect_real_db_if_exists() {
        let repo_root_db = Path::new("../DoomLauncher.sqlite");
        if repo_root_db.exists() {
            let res = inspect_db(repo_root_db).unwrap();
            assert!(res.total_games > 0);
            assert!(res.total_tags > 0);
            assert!(!res.detected_root.is_empty());

            // Test verification when pointing to DoomLauncher db in ~/Games/DoomLauncher/
            let user_dl_db = expand_tilde("~/Games/DoomLauncher/DoomLauncher.sqlite");
            if user_dl_db.exists() {
                let verify_res = verify_files(
                    &user_dl_db,
                    "H:\\Games\\Doom\\DoomMods\\Games",
                    "~/Games/DoomMods",
                ).unwrap();
                assert!(verify_res.matched >= 90, "Matched {} should be >= 90", verify_res.matched);
            }
        }
    }
}
