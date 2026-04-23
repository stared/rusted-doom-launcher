//! ModDB download URL resolver.
//!
//! ModDB hides direct download URLs behind Cloudflare's JS challenge on www.moddb.com.
//! The three-step handshake:
//!   1. GET /mods/{slug}/downloads/{file-slug}  -> parse file ID + MD5 + filename
//!   2. GET /downloads/start/{id}                -> parse mirror link
//!   3. GET /downloads/mirror/{id}/{mirror}/{hash} (redirects disabled) -> Location header
//!      is a time-signed https://*.dl.dbolical.com/... URL (expires ~1h).
//!
//! Only www.moddb.com is Cloudflare-fronted. The signed CDN host serves plain HTTPS,
//! so the final download goes through the existing tauri-plugin-upload path — this
//! module is only responsible for resolving page URLs to signed URLs.
//!
//! rquest is used (rather than reqwest) because Cloudflare blocks based on TLS
//! fingerprint (JA3/JA4), not User-Agent. rquest's BoringSSL default TLS config
//! passes Cloudflare's checks without needing rquest-util's Chrome emulation
//! templates (which are GPL-3.0).

use regex::Regex;
use rquest::{Client, redirect::Policy};
use serde::Serialize;
use std::sync::OnceLock;

const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Serialize, Clone)]
pub struct ResolvedModdb {
    /// Signed, time-limited CDN URL (valid ~1 hour).
    pub url: String,
    /// Lower-case hex MD5 from the ModDB page, for post-download verification.
    pub md5: Option<String>,
    /// Filename as listed by ModDB. Prefer this over deriving from the signed URL.
    pub filename: Option<String>,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("rquest client build failed: {e}"))
}

/// Pull `VALUE` out of `<h5>LABEL</h5>\s*<span class="summary">\s*VALUE\s*</span>`.
fn summary_field(html: &str, label: &str) -> Option<String> {
    static CACHE: OnceLock<std::sync::Mutex<std::collections::HashMap<String, Regex>>> =
        OnceLock::new();
    let mut cache = CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
        .lock()
        .ok()?;
    let re = cache.entry(label.to_string()).or_insert_with(|| {
        let pat = format!(
            r#"(?is)<h5>\s*{}\s*</h5>\s*<span[^>]*class="summary"[^>]*>\s*([^<]+?)\s*</span>"#,
            regex::escape(label),
        );
        Regex::new(&pat).expect("valid regex")
    });
    re.captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
}

fn parse_file_id(html: &str) -> Option<u64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"/downloads/start/(\d+)").unwrap());
    re.captures(html)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

fn parse_mirror_path(html: &str, file_id: u64) -> Option<String> {
    // Pattern: /downloads/mirror/{file_id}/{mirror_id}/{hash-hex}
    let pat = format!(r"/downloads/mirror/{}/\d+/[a-f0-9]+", file_id);
    Regex::new(&pat)
        .ok()?
        .find(html)
        .map(|m| m.as_str().to_string())
}

async fn resolve(page_url: &str) -> Result<ResolvedModdb, String> {
    if !page_url.starts_with("https://www.moddb.com/") {
        return Err(format!("not a moddb.com URL: {page_url}"));
    }

    let client = client()?;

    // Step 1: info page — pull file id, filename, md5.
    let resp = client
        .get(page_url)
        .send()
        .await
        .map_err(|e| format!("step 1 request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("step 1 returned {}", resp.status()));
    }
    let page = resp
        .text()
        .await
        .map_err(|e| format!("step 1 read body failed: {e}"))?;

    let file_id =
        parse_file_id(&page).ok_or_else(|| "could not find file ID on ModDB page".to_string())?;
    let filename = summary_field(&page, "Filename");
    let md5 = summary_field(&page, "MD5 Hash").and_then(|s| {
        let s = s.to_lowercase();
        if s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            Some(s)
        } else {
            None
        }
    });

    // Step 2: /downloads/start/{id} — pull the mirror link.
    let start_url = format!("https://www.moddb.com/downloads/start/{file_id}");
    let start_resp = client
        .get(&start_url)
        .send()
        .await
        .map_err(|e| format!("step 2 request failed: {e}"))?;
    if !start_resp.status().is_success() {
        return Err(format!("step 2 returned {}", start_resp.status()));
    }
    let start_html = start_resp
        .text()
        .await
        .map_err(|e| format!("step 2 read body failed: {e}"))?;
    let mirror_path = parse_mirror_path(&start_html, file_id)
        .ok_or_else(|| "could not find mirror URL on /downloads/start page".to_string())?;

    // Step 3: follow the mirror without auto-redirect; Location is the signed CDN URL.
    let mirror_url = format!("https://www.moddb.com{mirror_path}");
    let mirror_resp = client
        .get(&mirror_url)
        .send()
        .await
        .map_err(|e| format!("step 3 request failed: {e}"))?;
    let status = mirror_resp.status();
    if !status.is_redirection() {
        return Err(format!("step 3 expected 3xx redirect, got {status}"));
    }
    let signed = mirror_resp
        .headers()
        .get("location")
        .ok_or_else(|| "mirror response missing Location header".to_string())?
        .to_str()
        .map_err(|e| format!("Location header not UTF-8: {e}"))?
        .to_string();

    Ok(ResolvedModdb { url: signed, md5, filename })
}

#[tauri::command]
pub async fn resolve_moddb_url(page_url: String) -> Result<ResolvedModdb, String> {
    resolve(&page_url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PAGE: &str = r#"
        <div>
            <h5>Filename</h5>
            <span class="summary">
                oib_ep2_ep3.zip
            </span>
        </div>
        <div>
            <h5>MD5 Hash</h5>
            <span class="summary">
                696a2c9e0dd0b5d0b58aeab91d406416
            </span>
        </div>
        <a href="/downloads/start/308230">mirror</a>
    "#;

    const SAMPLE_START: &str = r#"
        <a href="/downloads/mirror/308230/122/c0e7dca72b504db449092ff32568f3e9">mirror 1</a>
    "#;

    #[test]
    fn extracts_file_id() {
        assert_eq!(parse_file_id(SAMPLE_PAGE), Some(308230));
    }

    #[test]
    fn extracts_filename() {
        assert_eq!(
            summary_field(SAMPLE_PAGE, "Filename").as_deref(),
            Some("oib_ep2_ep3.zip"),
        );
    }

    #[test]
    fn extracts_md5() {
        assert_eq!(
            summary_field(SAMPLE_PAGE, "MD5 Hash").as_deref(),
            Some("696a2c9e0dd0b5d0b58aeab91d406416"),
        );
    }

    #[test]
    fn extracts_mirror_path() {
        assert_eq!(
            parse_mirror_path(SAMPLE_START, 308230).as_deref(),
            Some("/downloads/mirror/308230/122/c0e7dca72b504db449092ff32568f3e9"),
        );
    }

    #[test]
    fn rejects_mirror_path_for_wrong_id() {
        assert_eq!(parse_mirror_path(SAMPLE_START, 999999), None);
    }

    /// Live network test. Not run by default — `cargo test -- --ignored` to run.
    /// Verifies the full 3-step handshake against real ModDB markup and signed URL.
    #[tokio::test]
    #[ignore]
    async fn live_resolves_katabasis() {
        let page = "https://www.moddb.com/mods/ordeal-in-blood/downloads/ordeal-in-blood-katabasis";
        let r = resolve(page).await.expect("resolve must succeed");
        assert!(r.url.contains("dbolical.com"), "expected dbolical CDN, got {}", r.url);
        assert!(r.url.contains(".zip"), "signed URL should point to a .zip: {}", r.url);
        assert_eq!(r.filename.as_deref(), Some("oib_ep2_ep3.zip"));
        let md5 = r.md5.expect("MD5 should parse");
        assert_eq!(md5.len(), 32);
        assert!(md5.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
