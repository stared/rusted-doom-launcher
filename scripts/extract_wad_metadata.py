#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "google-genai",
#     "requests",
# ]
# ///
"""
Extract comprehensive WAD metadata by crawling DoomWiki pages.

1. Fetches main wiki page
2. Uses Gemini to find relevant sub-links
3. Fetches each linked page
4. Passes all content to Gemini to extract structured metadata

Usage:
    uv run scripts/extract_wad_metadata.py https://doomwiki.org/wiki/Ancient_Aliens
    uv run scripts/extract_wad_metadata.py https://doomwiki.org/wiki/Ancient_Aliens --output output.json
"""

import argparse
import json
import sys
from pathlib import Path

import requests
from google import genai
from google.genai import types

LINK_EXTRACTION_PROMPT = """Analyze this DoomWiki HTML page for a Doom WAD/mod.

Extract all links that would contain useful information about THIS specific WAD, such as:
- Map pages (e.g., "MAP01: ...", level walkthroughs)
- Credits/authors pages
- Soundtrack/music pages
- Monster/enemy pages specific to this WAD
- Weapon pages specific to this WAD
- Any subpages about this WAD's content

DO NOT include:
- Generic Doom wiki pages (Doom II, Doom engine, etc.)
- External links (YouTube, ModDB, idgames, etc.)
- Category pages
- Navigation/template pages
- Other unrelated WAD pages

Return a JSON object:
{
  "wad_title": "Name of the WAD",
  "links": [
    {
      "url": "full URL (prefix with https://doomwiki.org if relative)",
      "description": "brief description of what this page contains"
    }
  ]
}

Return ONLY valid JSON, no markdown or explanation."""

METADATA_EXTRACTION_PROMPT = """You are analyzing DoomWiki content about a Doom WAD/mod.

I will provide the HTML content from multiple wiki pages about this WAD. Extract comprehensive metadata.

Return a JSON object with this structure:
{
  "title": "Official WAD title",
  "description": "2-3 sentence summary of what this WAD is about, its story/theme, and what makes it notable",
  "difficulty": "easy" | "medium" | "hard" | "slaughter" | "varies",
  "difficulty_notes": "explanation of difficulty (e.g., 'UV is extremely challenging, HMP recommended for most players')",
  "themes": ["list", "of", "visual/setting", "themes"],
  "gameplay_tags": ["list", "of", "gameplay", "descriptors"],
  "atmosphere_tags": ["list", "of", "mood/atmosphere", "descriptors"],
  "features": {
    "custom_monsters": true/false,
    "custom_weapons": true/false,
    "custom_music": true/false,
    "custom_textures": true/false,
    "story_driven": true/false,
    "puzzle_elements": true/false
  },
  "map_count": number or null,
  "estimated_playtime": "e.g., '8-12 hours' or null if unknown",
  "recommended_skill": "suggested skill level for average players",
  "notable_for": ["list", "of", "things", "this", "WAD", "is", "famous", "for"],
  "similar_to": ["other", "WADs", "with", "similar", "style"],
  "warnings": ["any", "content", "warnings", "like", "flashing", "lights"],
  "year": number,
  "authors": ["list", "of", "author", "names"]
}

Guidelines for tags:
- themes: alien, hell, tech-base, medieval, void, abstract, nature, urban, etc.
- gameplay_tags: challenging, slaughter, exploration, puzzle, speedrun-friendly, pistol-start, continuous, etc.
- atmosphere_tags: atmospheric, colorful, dark, creepy, beautiful, surreal, retro, modern, etc.

Be accurate - only include information that is explicitly stated or strongly implied in the content.
If information is not available, use null or empty arrays.

Return ONLY valid JSON, no markdown or explanation."""


def fetch_page(url: str) -> str | None:
    """Fetch HTML content from URL."""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.text
    except requests.RequestException as e:
        print(f"  Error fetching {url}: {e}", file=sys.stderr)
        return None


def extract_links(html: str) -> dict:
    """Use Gemini to extract relevant links from the main page."""
    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[f"HTML content:\n\n{html}\n\n{LINK_EXTRACTION_PROMPT}"],
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

    return {"wad_title": "", "links": []}


def extract_metadata(combined_content: str) -> dict:
    """Use Gemini to extract structured metadata from all page content."""
    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[f"Combined wiki content:\n\n{combined_content}\n\n{METADATA_EXTRACTION_PROMPT}"],
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

    return {}


def process_wad(url: str, max_subpages: int = 10) -> dict:
    """Process a WAD's wiki page and extract comprehensive metadata."""
    print(f"Fetching main page: {url}", file=sys.stderr)
    main_html = fetch_page(url)
    if not main_html:
        return {"error": "Failed to fetch main page"}

    print(f"  Got {len(main_html)} bytes", file=sys.stderr)

    # Extract links to subpages
    print("Extracting links to subpages...", file=sys.stderr)
    links_result = extract_links(main_html)
    links = links_result.get("links", [])
    print(f"  Found {len(links)} relevant links", file=sys.stderr)

    # Collect all page content
    all_content = [f"=== MAIN PAGE: {url} ===\n\n{main_html}"]

    # Fetch subpages (limit to avoid too many requests)
    links_to_fetch = links[:max_subpages]
    for i, link in enumerate(links_to_fetch, 1):
        link_url = link.get("url", "")
        if not link_url:
            continue

        # Ensure full URL
        if link_url.startswith("/"):
            link_url = f"https://doomwiki.org{link_url}"

        print(f"  [{i}/{len(links_to_fetch)}] Fetching: {link_url}", file=sys.stderr)
        html = fetch_page(link_url)
        if html:
            all_content.append(f"=== SUBPAGE: {link_url} ===\n\n{html}")
            print(f"    Got {len(html)} bytes", file=sys.stderr)

    # Combine all content
    combined = "\n\n".join(all_content)
    print(f"\nTotal content: {len(combined)} bytes from {len(all_content)} pages", file=sys.stderr)

    # Extract metadata from combined content
    print("Extracting metadata with Gemini...", file=sys.stderr)
    metadata = extract_metadata(combined)

    # Add source info
    metadata["_source_url"] = url
    metadata["_pages_analyzed"] = len(all_content)
    metadata["_subpages"] = [l.get("url") for l in links_to_fetch if l.get("url")]

    return metadata


def main():
    parser = argparse.ArgumentParser(description="Extract comprehensive WAD metadata from DoomWiki")
    parser.add_argument("url", help="DoomWiki URL to process")
    parser.add_argument("--output", "-o", help="Output file path (default: stdout)")
    parser.add_argument("--max-subpages", type=int, default=10, help="Maximum subpages to fetch (default: 10)")
    args = parser.parse_args()

    if "doomwiki.org" not in args.url:
        print("Error: URL must be a doomwiki.org page", file=sys.stderr)
        sys.exit(1)

    result = process_wad(args.url, max_subpages=args.max_subpages)

    output = json.dumps(result, indent=2)

    if args.output:
        Path(args.output).write_text(output + "\n")
        print(f"\nOutput written to: {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
