#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "google-genai",
#     "requests",
# ]
# ///
"""
Add images to WAD entries by extracting them from DoomWiki pages using Gemini 3 Flash.

Usage:
    uv run scripts/add_images_from_doomwiki.py
    uv run scripts/add_images_from_doomwiki.py --limit 10
    uv run scripts/add_images_from_doomwiki.py --dry-run
"""

import argparse
import json
import sys
import time
from pathlib import Path

import requests
from google import genai
from google.genai import types

WADS_DIR = Path(__file__).parent.parent / "content" / "wads"

PROMPT = """Analyze this DoomWiki HTML page and extract all relevant images.

Return a JSON object with this structure:
{
  "title": "WAD title from the page",
  "images": [
    {
      "type": "title_screen" | "screenshot" | "credits" | "intermission" | "other",
      "url": "full URL to the image (use doomwiki.org domain)",
      "caption": "description if available"
    }
  ]
}

Rules:
1. Only include content images (title screens, screenshots, credits, intermission screens)
2. SKIP: wiki logos, icons, cacoward badges, blank.gif, navigation images, Patreon icons
3. Convert relative URLs to absolute (prefix with https://doomwiki.org)
4. Use the full-size image URL, not thumbnails (remove /thumb/ and size suffix like /320px-)
5. If no content images found, return empty images array

Return ONLY valid JSON, no markdown or explanation."""


def fetch_page(url: str) -> str | None:
    """Fetch HTML content from URL."""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        print(f"    Error fetching: {e}", file=sys.stderr)
        return None


def extract_images(html: str) -> dict:
    """Use Gemini 3 Flash to extract image data from HTML."""
    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[f"HTML content:\n\n{html}\n\n{PROMPT}"],
        config=types.GenerateContentConfig(
            temperature=0.1,
        ),
    )

    if response.candidates and response.candidates[0].content.parts:
        text = response.candidates[0].content.parts[0].text
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
        return json.loads(text)

    return {"title": "", "images": []}


def process_wad(filepath: Path, dry_run: bool = False) -> tuple[bool, str]:
    """Process a single WAD entry.

    Returns: (updated, message)
    """
    entry = json.loads(filepath.read_text())
    slug = entry.get("slug", filepath.stem)

    # Get DoomWiki URL from urls field
    doomwiki_url = None
    for url in entry.get("urls", []):
        if "doomwiki.org" in url:
            doomwiki_url = url
            break

    if not doomwiki_url:
        return False, "No DoomWiki URL"

    # Skip if already has thumbnail
    if entry.get("thumbnail"):
        return False, "Already has thumbnail"

    # Fetch and extract
    html = fetch_page(doomwiki_url)
    if not html:
        return False, "Failed to fetch page"

    result = extract_images(html)
    images = result.get("images", [])

    if not images:
        return False, "No images found"

    # Find title screen for thumbnail
    thumbnail = ""
    screenshots = []

    for img in images:
        url = img.get("url", "")
        caption = img.get("caption", "")
        img_type = img.get("type", "other")

        if img_type == "title_screen" and not thumbnail:
            thumbnail = url
        else:
            screenshots.append({"url": url, "caption": caption})

    # Update entry
    if thumbnail:
        entry["thumbnail"] = thumbnail
    if screenshots:
        entry["screenshots"] = screenshots

    if not dry_run:
        filepath.write_text(json.dumps(entry, indent=2) + "\n")

    return True, f"Added {1 if thumbnail else 0} thumbnail, {len(screenshots)} screenshots"


def main():
    parser = argparse.ArgumentParser(description="Add images from DoomWiki to WAD entries")
    parser.add_argument("--limit", type=int, help="Limit to first N entries")
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    parser.add_argument("--skip-existing", action="store_true", default=True,
                        help="Skip entries that already have thumbnail (default: True)")
    args = parser.parse_args()

    print("Add Images from DoomWiki")
    print("=" * 60)
    if args.dry_run:
        print("Mode: DRY RUN")
    print()

    files = sorted(WADS_DIR.glob("*.json"))

    # Filter to only entries with DoomWiki URLs
    wads_to_process = []
    for filepath in files:
        entry = json.loads(filepath.read_text())
        has_doomwiki = any("doomwiki.org" in url for url in entry.get("urls", []))
        has_thumbnail = bool(entry.get("thumbnail"))

        if has_doomwiki and (not has_thumbnail or not args.skip_existing):
            wads_to_process.append(filepath)

    if args.limit:
        wads_to_process = wads_to_process[:args.limit]

    print(f"WADs to process: {len(wads_to_process)}")
    print("=" * 60)

    updated = 0
    skipped = 0
    errors = 0

    for i, filepath in enumerate(wads_to_process, 1):
        slug = filepath.stem
        print(f"[{i}/{len(wads_to_process)}] {slug}...", end=" ", flush=True)

        try:
            success, message = process_wad(filepath, dry_run=args.dry_run)
            if success:
                updated += 1
                print(f"✓ {message}")
            else:
                skipped += 1
                print(f"- {message}")
        except Exception as e:
            errors += 1
            print(f"✗ Error: {e}")

        # Rate limit to avoid API throttling
        if i < len(wads_to_process):
            time.sleep(0.5)

    print()
    print("=" * 60)
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")
    print(f"Errors: {errors}")


if __name__ == "__main__":
    main()
