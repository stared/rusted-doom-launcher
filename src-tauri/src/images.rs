use base64::prelude::*;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

/// Computes a deterministic cache file path for a given URL.
fn get_cache_path(app: &tauri::AppHandle, url: &str) -> Option<PathBuf> {
    let cache_dir = app.path().app_cache_dir().ok()?;
    let images_dir = cache_dir.join("images");
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = hex::encode(hasher.finalize());
    Some(images_dir.join(format!("{}.cache", hash)))
}

/// Detects standard image MIME types from raw header bytes.
fn detect_mime_type(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        "image/png"
    }
}

/// Fetches a remote image URL, saves it to the disk cache, and returns a `data:<mime>;base64,<encoded>` string.
pub async fn fetch_remote_image(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Empty URL".into());
    }

    if trimmed.starts_with("data:") || trimmed.starts_with("blob:") {
        return Ok(trimmed.to_string());
    }

    let cache_path = get_cache_path(&app, trimmed);

    // 1. Try reading from cache
    if let Some(ref path) = cache_path {
        if path.is_file() {
            if let Ok(bytes) = fs::read(path) {
                if !bytes.is_empty() {
                    let mime = detect_mime_type(&bytes);
                    let b64 = BASE64_STANDARD.encode(&bytes);
                    return Ok(format!("data:{};base64,{}", mime, b64));
                }
            }
        }
        // Keep failures on disk too. DoomWiki can reject non-browser clients;
        // retrying every image after every app restart only amplifies a 403.
        let failed_path = path.with_extension("failed");
        if failed_path.is_file() {
            let retry_after = fs::metadata(&failed_path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age >= Duration::from_secs(7 * 24 * 60 * 60));
            if !retry_after {
                return Err("Disk failure cache hit (will retry after 7 days)".into());
            }
            let _ = fs::remove_file(failed_path);
        }
    }

    // 2. Fetch using reqwest client
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(trimmed)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://doomwiki.org/")
        .header(
            "Accept",
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|e| format!("Failed to send request for {}: {}", trimmed, e))?;

    if !resp.status().is_success() {
        if let Some(ref path) = cache_path {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(path.with_extension("failed"), b"");
        }
        return Err(format!("HTTP error {}: {}", resp.status(), trimmed));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    if bytes.is_empty() {
        return Err("Received empty image response".into());
    }

    let mime = detect_mime_type(&bytes);

    // Save to cache
    if let Some(ref path) = cache_path {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, &bytes);
    }

    let b64 = BASE64_STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_mime_type() {
        assert_eq!(detect_mime_type(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]), "image/png");
        assert_eq!(detect_mime_type(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(detect_mime_type(b"GIF89a..."), "image/gif");
        assert_eq!(detect_mime_type(b"RIFF....WEBP"), "image/webp");
        assert_eq!(detect_mime_type(b"<svg>...</svg>"), "image/svg+xml");
    }

    #[test]
    fn test_cache_hashing() {
        let mut hasher = Sha256::new();
        hasher.update(b"https://doomwiki.org/w/images/e/e2/Action_Doom_title.png");
        let hash = hex::encode(hasher.finalize());
        assert_eq!(hash.len(), 64);
    }
}
