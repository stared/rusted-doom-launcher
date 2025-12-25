#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "google-genai",
#     "requests",
# ]
# ///
"""
Extract images from a DoomWiki page using Gemini 3 Flash.

Usage:
    uv run scripts/extract_doomwiki_images.py https://doomwiki.org/wiki/Ancient_Aliens
"""

import argparse
import json
import sys

import requests
from google import genai
from google.genai import types

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
2. SKIP: wiki logos, icons, cacoward badges, blank.gif, navigation images
3. Convert relative URLs to absolute (prefix with https://doomwiki.org)
4. Use the full-size image URL, not thumbnails (remove /thumb/ and size suffix like /320px-)
5. If no content images found, return empty images array

Return ONLY valid JSON, no markdown or explanation."""


def fetch_page(url: str) -> str:
    """Fetch HTML content from URL."""
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.text


def extract_images(html: str) -> dict:
    """Use Gemini to extract image data from HTML."""
    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=[f"HTML content:\n\n{html}\n\n{PROMPT}"],
        config=types.GenerateContentConfig(
            temperature=0.1,  # Low temperature for consistent extraction
        ),
    )

    # Extract text from response
    if response.candidates and response.candidates[0].content.parts:
        text = response.candidates[0].content.parts[0].text
        # Clean up markdown code blocks if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]  # Remove first line
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]  # Remove last ```
        text = text.strip()
        return json.loads(text)

    return {"title": "", "images": []}


def main():
    parser = argparse.ArgumentParser(description="Extract images from DoomWiki page")
    parser.add_argument("url", help="DoomWiki URL to extract images from")
    parser.add_argument("--raw", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    if "doomwiki.org" not in args.url:
        print("Error: URL must be a doomwiki.org page", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching: {args.url}", file=sys.stderr)
    html = fetch_page(args.url)
    print(f"Got {len(html)} bytes, extracting images...", file=sys.stderr)

    result = extract_images(html)

    if args.raw:
        print(json.dumps(result, indent=2))
    else:
        print(f"\nTitle: {result.get('title', 'Unknown')}")
        images = result.get("images", [])
        if images:
            print(f"Found {len(images)} image(s):\n")
            for img in images:
                print(f"  [{img.get('type', 'unknown')}]")
                print(f"    URL: {img.get('url', '')}")
                if img.get("caption"):
                    print(f"    Caption: {img['caption']}")
                print()
        else:
            print("No images found on this page.")


if __name__ == "__main__":
    main()
