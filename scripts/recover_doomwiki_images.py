#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pillow",
#     "requests",
# ]
# ///
"""
Batch recover DoomWiki thumbnails and screenshots from the Wayback Machine,
optimize them into lightweight WebP images in content/assets/, and optionally
update content/wads/*.json and content/wads-pending/*.json with CDN URLs.

Usage:
    uv run scripts/recover_doomwiki_images.py --thumbnails-only
    uv run scripts/recover_doomwiki_images.py --limit 10
    uv run scripts/recover_doomwiki_images.py --dry-run
    uv run scripts/recover_doomwiki_images.py
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from PIL import Image

REPO_ROOT = Path(__file__).parent.parent
CONTENT_DIRS = [
    REPO_ROOT / "content" / "wads",
    REPO_ROOT / "content" / "wads-pending",
]
ASSETS_DIR = REPO_ROOT / "content" / "assets"
THUMBNAILS_DIR = ASSETS_DIR / "thumbnails"
SCREENSHOTS_DIR = ASSETS_DIR / "screenshots"

CDN_BASE = "https://cdn.jsdelivr.net/gh/stared/rusted-doom-launcher@main/content/assets"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


def make_session() -> requests.Session:
    """Create a requests session with connection pooling."""
    s = requests.Session()
    s.headers.update(HEADERS)
    adapter = HTTPAdapter(pool_connections=5, pool_maxsize=5)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def clean_filename(name: str) -> str:
    """Sanitize a filename for screenshot storage."""
    name = unquote(name)
    name = re.sub(r"[^\w\-_.]", "_", name)
    return name.lower()


def is_valid_image(data: bytes) -> bool:
    return (
        data.startswith(b"\x89PNG")
        or data.startswith(b"GIF8")
        or data.startswith(b"\xff\xd8")
        or data.startswith(b"RIFF")
    )


def fetch_from_wayback(session: requests.Session, url: str, timeout: int = 6) -> bytes | None:
    """Fetch an archived snapshot of a DoomWiki URL from the Wayback Machine."""
    # Attempt 1: direct timestamp snapshot id_
    wb_url = f"https://web.archive.org/web/20230101000000id_/{url}"
    try:
        resp = session.get(wb_url, timeout=timeout, allow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 500 and is_valid_image(resp.content):
            return resp.content
    except Exception:
        pass

    # Attempt 2: latest available snapshot via web/2/
    wb_fallback = f"https://web.archive.org/web/2id_/{url}"
    try:
        resp = session.get(wb_fallback, timeout=timeout, allow_redirects=True)
        if resp.status_code == 200 and len(resp.content) > 500 and is_valid_image(resp.content):
            return resp.content
    except Exception:
        pass

    return None


def optimize_image(data: bytes, max_width: int = 640) -> bytes | None:
    """Resize (if over max_width) and encode to WebP."""
    try:
        img = Image.open(io.BytesIO(data))
    except Exception as e:
        print(f"    [Error] Invalid image format: {e}", file=sys.stderr)
        return None

    # Downscale if larger than max_width, keeping aspect ratio
    if img.width > max_width:
        new_height = int(img.height * max_width / img.width)
        img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

    # For paletted images (P mode), lossless WebP is usually smallest and pixel-exact
    buf_lossless = io.BytesIO()
    try:
        img.save(buf_lossless, format="WEBP", lossless=True)
        lossless_bytes = buf_lossless.getvalue()
    except Exception:
        lossless_bytes = None

    # For RGBA/RGB, test quality=85
    buf_lossy = io.BytesIO()
    try:
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            rgb_img = img.convert("RGBA")
        else:
            rgb_img = img.convert("RGB")
        rgb_img.save(buf_lossy, format="WEBP", quality=85, method=6)
        lossy_bytes = buf_lossy.getvalue()
    except Exception:
        lossy_bytes = None

    if lossless_bytes and lossy_bytes:
        return lossless_bytes if len(lossless_bytes) <= len(lossy_bytes) else lossy_bytes
    return lossless_bytes or lossy_bytes


def main():
    parser = argparse.ArgumentParser(description="Recover DoomWiki images via Wayback Machine")
    parser.add_argument("--slug", type=str, default="", help="Only process a specific WAD slug")
    parser.add_argument("--thumbnails-only", action="store_true", help="Only recover primary thumbnails")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of processed WADs")
    parser.add_argument("--dry-run", action="store_true", help="Preview actions without downloading/saving")
    parser.add_argument("--skip-update-json", action="store_true", help="Do not update the JSON files")
    args = parser.parse_args()

    session = make_session()

    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    if not args.thumbnails_only:
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    recovered_thumbs = 0
    failed_thumbs: list[tuple[str, str]] = []
    recovered_screenshots = 0
    failed_screenshots: list[tuple[str, str]] = []

    json_files: list[Path] = []
    for d in CONTENT_DIRS:
        if d.exists():
            json_files.extend(sorted(d.glob("*.json")))

    print(f"Found {len(json_files)} WAD JSON files across content directories.")

    processed = 0
    for jf in json_files:
        if args.limit and processed >= args.limit:
            break

        try:
            wad_data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Error reading {jf.name}: {e}")
            continue

        slug = wad_data.get("slug", jf.stem)
        if args.slug and slug != args.slug:
            continue
        modified = False

        # --- 1. Primary Thumbnail ---
        thumb_url = wad_data.get("thumbnail", "")
        if thumb_url and "doomwiki.org/w/images" in thumb_url:
            processed += 1
            target_file = THUMBNAILS_DIR / f"{slug}.webp"
            cdn_url = f"{CDN_BASE}/thumbnails/{slug}.webp"

            if target_file.exists():
                print(f"[{slug}] Thumbnail already cached: {target_file.name}")
                if wad_data.get("thumbnail") != cdn_url and not args.skip_update_json:
                    wad_data["thumbnail"] = cdn_url
                    modified = True
            elif not args.dry_run:
                print(f"[{slug}] Fetching thumbnail: {thumb_url}")
                raw_bytes = fetch_from_wayback(session, thumb_url)
                if raw_bytes:
                    webp_bytes = optimize_image(raw_bytes)
                    if webp_bytes:
                        target_file.write_bytes(webp_bytes)
                        print(f"  ✓ Saved {target_file.name} ({len(webp_bytes):,} bytes)")
                        recovered_thumbs += 1
                        if not args.skip_update_json:
                            wad_data["thumbnail"] = cdn_url
                            modified = True
                    else:
                        print(f"  ✗ Failed to optimize thumbnail for {slug}")
                        failed_thumbs.append((slug, thumb_url))
                else:
                    print(f"  ✗ Failed to fetch thumbnail from Wayback for {slug}")
                    failed_thumbs.append((slug, thumb_url))
                time.sleep(0.8)  # Polite pause for Wayback connection limits

        # --- 2. Screenshots (if not thumbnails-only) ---
        if not args.thumbnails_only:
            screenshots = wad_data.get("screenshots", [])
            new_screenshots = []
            wad_sc_dir = SCREENSHOTS_DIR / slug

            for idx, sc in enumerate(screenshots):
                sc_url = sc.get("url", "")
                caption = sc.get("caption", "")

                if "doomwiki.org/w/images" in sc_url:
                    wad_sc_dir.mkdir(parents=True, exist_ok=True)
                    img_name = sc_url.split("/")[-1]
                    clean_name = clean_filename(Path(img_name).stem)
                    sc_target = wad_sc_dir / f"{idx:02d}_{clean_name}.webp"
                    sc_cdn_url = f"{CDN_BASE}/screenshots/{slug}/{idx:02d}_{clean_name}.webp"

                    if sc_target.exists():
                        new_screenshots.append({"url": sc_cdn_url, "caption": caption})
                        if sc_url != sc_cdn_url:
                            modified = True
                    elif not args.dry_run:
                        print(f"[{slug}] Fetching screenshot #{idx}: {sc_url}")
                        raw_bytes = fetch_from_wayback(session, sc_url)
                        if raw_bytes:
                            webp_bytes = optimize_image(raw_bytes)
                            if webp_bytes:
                                sc_target.write_bytes(webp_bytes)
                                print(f"  ✓ Saved screenshot {sc_target.name} ({len(webp_bytes):,} bytes)")
                                recovered_screenshots += 1
                                new_screenshots.append({"url": sc_cdn_url, "caption": caption})
                                modified = True
                            else:
                                new_screenshots.append(sc)
                                failed_screenshots.append((slug, sc_url))
                        else:
                            print(f"  ✗ Failed to fetch screenshot for {slug}")
                            new_screenshots.append(sc)
                            failed_screenshots.append((slug, sc_url))
                        time.sleep(0.8)
                    else:
                        new_screenshots.append(sc)
                else:
                    new_screenshots.append(sc)

            if modified and not args.skip_update_json:
                wad_data["screenshots"] = new_screenshots

        # Write back updated JSON
        if modified and not args.dry_run and not args.skip_update_json:
            jf.write_text(json.dumps(wad_data, indent=2) + "\n", encoding="utf-8")
            print(f"  [JSON] Updated {jf.name}")

    print("\n" + "=" * 50)
    print(f"Summary:")
    print(f"  Recovered Thumbnails: {recovered_thumbs}")
    print(f"  Failed Thumbnails: {len(failed_thumbs)}")
    if failed_thumbs:
        for slug, u in failed_thumbs:
            print(f"    - {slug}: {u}")
    if not args.thumbnails_only:
        print(f"  Recovered Screenshots: {recovered_screenshots}")
        print(f"  Failed Screenshots: {len(failed_screenshots)}")
        if failed_screenshots:
            for slug, u in failed_screenshots:
                print(f"    - {slug}: {u}")


if __name__ == "__main__":
    main()
