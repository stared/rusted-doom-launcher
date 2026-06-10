// Collection step of the GOG installer import. innoextract preserves the
// installer's directory layout (`doom2/DOOM2.WAD`, `master/wads/…`,
// `DOOM_Data/StreamingAssets/doom.wad`), which varies per installer — so
// the frontend extracts into a temp directory and this walks it, moving
// every wanted WAD flat into the destination under its canonical
// lowercase name. The temp directory is removed afterwards.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::game_archives::create_temp_dir;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectedWad {
    pub name: String,
    pub size: u64,
}

pub fn make_temp_dir() -> Result<String, String> {
    Ok(create_temp_dir()?.to_string_lossy().to_string())
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry in {}: {}", dir.display(), e))?;
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

/// Move every file from `src_dir` (recursively) whose basename matches one
/// of `wanted` (case-insensitive) into `dest_dir` under the canonical
/// lowercase name, then delete `src_dir`. The first match per name wins —
/// some installers carry duplicate WADs (e.g. a DOS copy alongside the
/// main one).
pub fn collect_known_wads(
    src_dir: &str,
    dest_dir: &str,
    wanted: &[String],
) -> Result<Vec<CollectedWad>, String> {
    let wanted_lower: Vec<String> = wanted.iter().map(|w| w.to_lowercase()).collect();

    let mut files = Vec::new();
    walk_files(Path::new(src_dir), &mut files)?;
    files.sort();

    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create {}: {}", dest_dir, e))?;

    let mut collected: Vec<CollectedWad> = Vec::new();
    for path in files {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
            continue;
        };
        if !wanted_lower.contains(&name) {
            continue;
        }
        if collected.iter().any(|c| c.name == name) {
            continue;
        }
        let dest = Path::new(dest_dir).join(&name);
        std::fs::copy(&path, &dest).map_err(|e| {
            format!("Failed to copy {} -> {}: {}", path.display(), dest.display(), e)
        })?;
        let size = std::fs::metadata(&dest)
            .map_err(|e| format!("Failed to stat {}: {}", dest.display(), e))?
            .len();
        collected.push(CollectedWad { name, size });
    }

    std::fs::remove_dir_all(src_dir)
        .map_err(|e| format!("Failed to clean up {}: {}", src_dir, e))?;

    Ok(collected)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(files: &[(&str, &[u8])]) -> (PathBuf, PathBuf) {
        let src = create_temp_dir().unwrap();
        let dest = create_temp_dir().unwrap();
        for (rel, data) in files {
            let path = src.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, data).unwrap();
        }
        (src, dest)
    }

    fn wanted(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn collects_wads_from_nested_dirs_with_canonical_names() {
        let (src, dest) = setup(&[
            ("doom2/DOOM2.WAD", b"PWAD2222"),
            ("DOOM_Data/StreamingAssets/doom.wad", b"IWAD1111"),
            ("master/wads/TEETH.WAD", b"PWADxxxx"),
            ("tmp/error.png", b"png"),
        ]);
        let got = collect_known_wads(
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
            &wanted(&["doom.wad", "doom2.wad"]),
        )
        .unwrap();
        assert_eq!(
            got,
            vec![
                CollectedWad { name: "doom.wad".into(), size: 8 },
                CollectedWad { name: "doom2.wad".into(), size: 8 },
            ]
        );
        assert_eq!(std::fs::read(dest.join("doom2.wad")).unwrap(), b"PWAD2222");
        assert!(!dest.join("TEETH.WAD").exists());
        assert!(!src.exists(), "src temp dir should be removed");
    }

    #[test]
    fn first_duplicate_wins() {
        let (src, dest) = setup(&[
            ("doom2/DOOM2.WAD", b"MAIN"),
            ("dosdoom/base/doom2/DOOM2.WAD", b"DOS!"),
        ]);
        let got = collect_known_wads(
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
            &wanted(&["doom2.wad"]),
        )
        .unwrap();
        assert_eq!(got.len(), 1);
        // files are sorted, so "doom2/..." sorts before "dosdoom/..."
        assert_eq!(std::fs::read(dest.join("doom2.wad")).unwrap(), b"MAIN");
    }

    #[test]
    fn empty_when_nothing_matches() {
        let (src, dest) = setup(&[("readme.txt", b"hi")]);
        let got = collect_known_wads(
            src.to_str().unwrap(),
            dest.to_str().unwrap(),
            &wanted(&["doom.wad"]),
        )
        .unwrap();
        assert!(got.is_empty());
        assert!(!src.exists());
    }
}
