#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Add `urls` field to all WAD entries for source attribution.

Sources:
- Scraped entries: wiki_url from wads_metadata.json
- Manual entries: hardcoded DoomWiki URLs
- Umbra: Doomworld forum thread (no wiki page exists)
"""

import json
import re
from pathlib import Path

WADS_DIR = Path(__file__).parent.parent / "content" / "wads"
METADATA_FILE = Path(__file__).parent / "data" / "wads_metadata.json"

# Manual entries with their DoomWiki URLs
MANUAL_URLS = {
    "ancient-aliens": ["https://doomwiki.org/wiki/Ancient_Aliens"],
    "brutal-doom": ["https://doomwiki.org/wiki/Brutal_Doom"],
    "eviternity": ["https://doomwiki.org/wiki/Eviternity"],
    "otex": ["https://doomwiki.org/wiki/OTEX"],
    "sigil": ["https://doomwiki.org/wiki/SIGIL"],
    "sunder": ["https://doomwiki.org/wiki/Sunder"],
}

# Special cases (no wiki page)
SPECIAL_URLS = {
    "umbra": ["https://www.doomworld.com/forum/topic/148700-umbra-rc6-mbf21/"],
}


def slugify(title: str) -> str:
    """Convert title to slug format."""
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def main():
    print("Add URLs Field to WAD Entries")
    print("=" * 60)

    # Load metadata for wiki_url lookup
    metadata = {}
    if METADATA_FILE.exists():
        data = json.loads(METADATA_FILE.read_text())
        for wad in data.get("wads", []):
            slug = slugify(wad["title"])
            if wad.get("wiki_url"):
                metadata[slug] = wad["wiki_url"]
        print(f"Loaded {len(metadata)} wiki URLs from metadata")

    # Process all WAD entries
    files = sorted(WADS_DIR.glob("*.json"))
    updated = 0
    skipped = 0
    errors = []

    for filepath in files:
        entry = json.loads(filepath.read_text())
        slug = entry.get("slug", filepath.stem)

        # Skip if already has urls field
        if entry.get("urls"):
            skipped += 1
            continue

        # Determine URLs to add
        urls = []

        # Check manual entries first
        if slug in MANUAL_URLS:
            urls = MANUAL_URLS[slug]
        # Check special cases
        elif slug in SPECIAL_URLS:
            urls = SPECIAL_URLS[slug]
        # Check metadata
        elif slug in metadata:
            urls = [metadata[slug]]
        else:
            # Try to find by matching title
            title_slug = slugify(entry.get("title", ""))
            if title_slug in metadata:
                urls = [metadata[title_slug]]

        if not urls:
            errors.append(f"{slug}: No URL found")
            continue

        # Add urls field
        entry["urls"] = urls
        filepath.write_text(json.dumps(entry, indent=2) + "\n")
        updated += 1
        print(f"  {slug}: {urls[0][:50]}...")

    print()
    print("=" * 60)
    print(f"Updated: {updated}")
    print(f"Skipped (already have urls): {skipped}")
    print(f"Errors: {len(errors)}")

    if errors:
        print("\nEntries without URLs:")
        for error in errors:
            print(f"  - {error}")


if __name__ == "__main__":
    main()
