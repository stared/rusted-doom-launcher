// Streaming archive operations for downloaded WADs/mods and custom imports.
//
// Bulk archive bytes must stay out of the webview: WebKit kills the
// WebContent process when it balloons (a 500 MB mod zip read there costs
// ~3 GB RSS). The frontend gets entry listings and small size-capped
// entries (MAX_INMEMORY_READ enforces the cap); everything else streams
// disk-to-disk here.

use serde::Serialize;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use zip::ZipArchive;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntryInfo {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedGameFile {
    pub name: String,
    pub size: u64,
}

fn open_archive(zip_path: &str) -> Result<ZipArchive<File>, String> {
    let file =
        File::open(zip_path).map_err(|e| format!("Failed to open {}: {}", zip_path, e))?;
    ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP {}: {}", zip_path, e))
}

/// Basename of a zip entry path. Entry names use `/`, but Windows-created
/// archives sometimes carry `\`. Basename-only also rules out zip-slip.
fn basename(entry_path: &str) -> &str {
    entry_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(entry_path)
}

fn is_game_file(entry_path: &str) -> bool {
    let lower = entry_path.to_lowercase();
    lower.ends_with(".wad") || lower.ends_with(".pk3")
}

/// Check magic bytes of a downloaded file without reading it whole.
/// `filename` decides the expected format by extension.
pub fn validate_game_file(path: &str, filename: &str) -> Result<(), String> {
    let ext = filename
        .to_lowercase()
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_string();

    let mut file = File::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    let file_len = file
        .metadata()
        .map_err(|e| format!("Failed to stat {}: {}", path, e))?
        .len();
    let mut magic = [0u8; 4];
    let read = file
        .read(&mut magic)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;

    match ext.as_str() {
        "zip" | "pk3" => {
            if read < 2 || magic[0] != 0x50 || magic[1] != 0x4b {
                return Err(format!(
                    "Invalid ZIP file: {} - file appears corrupted or is not a ZIP archive (got {} bytes, magic: {:02x} {:02x})",
                    filename, file_len, magic[0], magic[1]
                ));
            }
        }
        "wad" => {
            if read < 4 {
                return Err(format!(
                    "Invalid WAD file: {} - file too small ({} bytes)",
                    filename, file_len
                ));
            }
            if &magic != b"IWAD" && &magic != b"PWAD" {
                return Err(format!(
                    "Invalid WAD file: {} - expected IWAD/PWAD header, got \"{}\"",
                    filename,
                    String::from_utf8_lossy(&magic)
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Stream every .wad/.pk3 inside a zip to `dest_dir` (basename only).
/// Returns name+size per extracted file; the frontend picks the primary.
pub fn extract_game_files(zip_path: &str, dest_dir: &str) -> Result<Vec<ExtractedGameFile>, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create {}: {}", dest_dir, e))?;
    let mut archive = open_archive(zip_path)?;
    let mut extracted = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry #{}: {}", i, e))?;
        if entry.is_dir() || !is_game_file(entry.name()) {
            continue;
        }
        let name = basename(entry.name()).to_string();
        if name.is_empty() {
            continue;
        }
        let dest_path = Path::new(dest_dir).join(&name);
        let mut out = File::create(&dest_path)
            .map_err(|e| format!("Failed to create {}: {}", dest_path.display(), e))?;
        let size = io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Failed to extract {}: {}", name, e))?;
        extracted.push(ExtractedGameFile { name, size });
    }

    if extracted.is_empty() {
        return Err("No WAD or PK3 files found inside ZIP archive".to_string());
    }
    Ok(extracted)
}

/// Stream a single zip entry to `dest_path`. Returns bytes written.
pub fn extract_zip_entry(zip_path: &str, entry_path: &str, dest_path: &str) -> Result<u64, String> {
    let mut archive = open_archive(zip_path)?;
    let mut entry = archive
        .by_name(entry_path)
        .map_err(|e| format!("Entry {} not found in {}: {}", entry_path, zip_path, e))?;
    let mut out = File::create(dest_path)
        .map_err(|e| format!("Failed to create {}: {}", dest_path, e))?;
    io::copy(&mut entry, &mut out).map_err(|e| format!("Failed to extract {}: {}", entry_path, e))
}

/// List file entries (path + uncompressed size). Directories are skipped.
pub fn list_zip_entries(zip_path: &str) -> Result<Vec<ZipEntryInfo>, String> {
    let mut archive = open_archive(zip_path)?;
    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry #{}: {}", i, e))?;
        if entry.is_dir() {
            continue;
        }
        entries.push(ZipEntryInfo {
            path: entry.name().to_string(),
            size: entry.size(),
        });
    }
    Ok(entries)
}

/// Hard cap on bytes handed to the webview in one read. Callers wanting more
/// must stream to disk (extract_zip_entry*) and read ranges from there.
pub const MAX_INMEMORY_READ: u64 = 16 * 1024 * 1024;

/// Read one entry into memory. Capped at MAX_INMEMORY_READ.
pub fn read_zip_entry(zip_path: &str, entry_path: &str) -> Result<Vec<u8>, String> {
    let mut archive = open_archive(zip_path)?;
    let mut entry = archive
        .by_name(entry_path)
        .map_err(|e| format!("Entry {} not found in {}: {}", entry_path, zip_path, e))?;
    if entry.size() > MAX_INMEMORY_READ {
        return Err(format!(
            "Entry {} is {} bytes, over the {} MB in-memory read cap — extract it to disk instead",
            entry_path,
            entry.size(),
            MAX_INMEMORY_READ / (1024 * 1024)
        ));
    }
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read {}: {}", entry_path, e))?;
    Ok(buf)
}

/// Create a unique, empty temp directory owned by the launcher.
/// pid + timestamp alone collide when callers race within one clock tick
/// (parallel tests do), so a process-wide counter disambiguates.
pub fn create_temp_dir() -> Result<std::path::PathBuf, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System clock error: {}", e))?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "rusted-doom-launcher-{}-{}-{}",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    Ok(dir)
}

/// Remove a temp directory previously created by create_temp_dir. Refuses
/// anything that isn't a launcher-owned directory directly under the system
/// temp dir — this is reachable from the webview. Tolerates an already
/// removed directory so double-cleanup is harmless.
pub fn cleanup_temp_dir(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    let parent_ok = p.parent() == Some(std::env::temp_dir().as_path());
    let name_ok = p
        .file_name()
        .map(|n| n.to_string_lossy().starts_with("rusted-doom-launcher-"))
        .unwrap_or(false);
    if !parent_ok || !name_ok {
        return Err(format!(
            "Refusing to remove {}: not a launcher temp directory",
            path
        ));
    }
    match std::fs::remove_dir_all(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to remove {}: {}", path, e)),
    }
}

/// Stream a zip entry into a fresh temp directory and return its path.
/// Used at pick time in the custom-mod importer so inspection and the
/// eventual copy into the library work from a real, seekable file.
pub fn extract_zip_entry_to_temp(zip_path: &str, entry_path: &str) -> Result<String, String> {
    let dir = create_temp_dir()?;
    let dest = dir.join(basename(entry_path));
    let dest_str = dest.to_string_lossy().to_string();
    extract_zip_entry(zip_path, entry_path, &dest_str)?;
    Ok(dest_str)
}

/// Read `len` bytes at `offset` from a file. Errors if the range is out of
/// bounds — short reads never succeed silently. Capped at MAX_INMEMORY_READ:
/// requested lengths come from file-internal directories, so a corrupt WAD
/// header must not translate into a multi-GB webview allocation.
pub fn read_file_range(path: &str, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    use std::io::{Seek, SeekFrom};
    if len > MAX_INMEMORY_READ {
        return Err(format!(
            "Refusing to read {} bytes from {} — over the {} MB in-memory read cap",
            len,
            path,
            MAX_INMEMORY_READ / (1024 * 1024)
        ));
    }
    let mut file = File::open(path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek {} to {}: {}", path, offset, e))?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf).map_err(|e| {
        format!(
            "Failed to read {} bytes at offset {} from {}: {}",
            len, offset, path, e
        )
    })?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("game_archives_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn make_zip(name: &str, entries: &[(&str, &[u8])]) -> String {
        let path = temp_path(name);
        let file = File::create(&path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (entry_name, data) in entries {
            writer
                .start_file(*entry_name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn extracts_wad_and_pk3_stripping_directories() {
        let zip = make_zip(
            "extract.zip",
            &[
                ("readme.txt", b"hello"),
                ("nested/dir/MyMod.pk3", b"PK\x03\x04pk3data"),
                ("maps.WAD", b"PWADxxxx"),
            ],
        );
        let dest = temp_path("extract_out");
        let mut files = extract_game_files(&zip, dest.to_str().unwrap()).unwrap();
        files.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(
            files,
            vec![
                ExtractedGameFile { name: "MyMod.pk3".into(), size: 11 },
                ExtractedGameFile { name: "maps.WAD".into(), size: 8 },
            ]
        );
        assert_eq!(std::fs::read(dest.join("maps.WAD")).unwrap(), b"PWADxxxx");
    }

    #[test]
    fn extract_errors_when_no_game_files() {
        let zip = make_zip("nogame.zip", &[("readme.txt", b"hello")]);
        let dest = temp_path("nogame_out");
        let err = extract_game_files(&zip, dest.to_str().unwrap()).unwrap_err();
        assert_eq!(err, "No WAD or PK3 files found inside ZIP archive");
    }

    #[test]
    fn lists_entries_with_sizes() {
        let zip = make_zip("list.zip", &[("a.txt", b"12345"), ("dir/b.wad", b"PWAD")]);
        let entries = list_zip_entries(&zip).unwrap();
        assert_eq!(
            entries,
            vec![
                ZipEntryInfo { path: "a.txt".into(), size: 5 },
                ZipEntryInfo { path: "dir/b.wad".into(), size: 4 },
            ]
        );
    }

    #[test]
    fn reads_single_entry() {
        let zip = make_zip("entry.zip", &[("dir/notes.txt", b"hello world")]);
        assert_eq!(read_zip_entry(&zip, "dir/notes.txt").unwrap(), b"hello world");
        assert!(read_zip_entry(&zip, "missing.txt").is_err());
    }

    #[test]
    fn read_zip_entry_rejects_oversized_entries() {
        let big = vec![0u8; (MAX_INMEMORY_READ + 1) as usize];
        let zip = make_zip("oversize.zip", &[("big.bin", &big)]);
        let err = read_zip_entry(&zip, "big.bin").unwrap_err();
        assert!(err.contains("in-memory read cap"), "{}", err);
    }

    #[test]
    fn read_file_range_rejects_oversized_lengths() {
        let path = temp_path("range_cap.bin");
        std::fs::write(&path, b"abc").unwrap();
        let err = read_file_range(path.to_str().unwrap(), 0, MAX_INMEMORY_READ + 1).unwrap_err();
        assert!(err.contains("in-memory read cap"), "{}", err);
    }

    #[test]
    fn reads_file_range_and_errors_out_of_bounds() {
        let path = temp_path("range.bin");
        std::fs::write(&path, b"0123456789").unwrap();
        let p = path.to_str().unwrap();
        assert_eq!(read_file_range(p, 2, 4).unwrap(), b"2345");
        assert_eq!(read_file_range(p, 0, 0).unwrap(), b"");
        assert!(read_file_range(p, 8, 4).is_err());
    }

    #[test]
    fn extracts_entry_to_temp_file() {
        let zip = make_zip("totemp.zip", &[("inner/mod.pk3", b"PK\x03\x04abc")]);
        let temp = extract_zip_entry_to_temp(&zip, "inner/mod.pk3").unwrap();
        assert!(temp.ends_with("mod.pk3"), "{}", temp);
        assert_eq!(std::fs::read(&temp).unwrap(), b"PK\x03\x04abc");
    }

    #[test]
    fn cleanup_removes_only_launcher_temp_dirs() {
        let dir = create_temp_dir().unwrap();
        std::fs::write(dir.join("file.wad"), b"PWAD").unwrap();
        cleanup_temp_dir(dir.to_str().unwrap()).unwrap();
        assert!(!dir.exists());
        // Idempotent: removing again is fine.
        cleanup_temp_dir(dir.to_str().unwrap()).unwrap();

        // Not launcher-owned, not under temp root: refused.
        assert!(cleanup_temp_dir("/etc").is_err());
        let foreign = std::env::temp_dir().join("some-other-dir");
        assert!(cleanup_temp_dir(foreign.to_str().unwrap()).is_err());
    }

    #[test]
    fn extract_single_entry_streams_to_dest() {
        let zip = make_zip("single.zip", &[("inner/file.pk3", b"PK\x03\x04abc")]);
        let dest = temp_path("single_out.pk3");
        let written = extract_zip_entry(&zip, "inner/file.pk3", dest.to_str().unwrap()).unwrap();
        assert_eq!(written, 7);
        assert_eq!(std::fs::read(&dest).unwrap(), b"PK\x03\x04abc");
    }

    #[test]
    fn validates_magic_bytes_per_extension() {
        let zip_ok = temp_path("v1.zip");
        std::fs::write(&zip_ok, b"PK\x03\x04rest").unwrap();
        assert!(validate_game_file(zip_ok.to_str().unwrap(), "v1.zip").is_ok());

        let zip_bad = temp_path("v2.zip");
        std::fs::write(&zip_bad, b"<html>not a zip").unwrap();
        let err = validate_game_file(zip_bad.to_str().unwrap(), "v2.zip").unwrap_err();
        assert!(err.contains("Invalid ZIP file"), "{}", err);

        let wad_ok = temp_path("v3.wad");
        std::fs::write(&wad_ok, b"IWADxxxxxxxx").unwrap();
        assert!(validate_game_file(wad_ok.to_str().unwrap(), "v3.wad").is_ok());

        let wad_bad = temp_path("v4.wad");
        std::fs::write(&wad_bad, b"JUNKxxxxxxxx").unwrap();
        let err = validate_game_file(wad_bad.to_str().unwrap(), "v4.wad").unwrap_err();
        assert!(err.contains("expected IWAD/PWAD header"), "{}", err);
    }
}
