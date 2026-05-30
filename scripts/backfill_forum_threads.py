#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["beautifulsoup4", "requests"]
# ///
"""
Backfill Doomworld forum-thread URLs into the WAD catalog.

For every entry in content/wads/*.json that has a DoomWiki page but no
Doomworld forum thread yet, fetch the wiki page and pull the release/discussion
thread link (the wiki labels it "... thread" and points at /vb/thread/NNNNN or
/forum/topic/NNNNN). Append it to the entry's `urls` array, which the launcher
already surfaces as a [Doomworld] chip.

Usage:
    uv run scripts/backfill_forum_threads.py --dry-run   # report only
    uv run scripts/backfill_forum_threads.py             # write changes
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from bs4 import BeautifulSoup

WADS_DIR = Path(__file__).resolve().parent.parent / "content" / "wads"
HEADERS = {"User-Agent": "DoomLauncher-WikiScraper/1.0"}

# A real thread, not a single post or an idgames/profile/cacoward link.
THREAD_RE = re.compile(r"doomworld\.com/(?:vb/thread/\d+|forum/topic/\d+|vb/showthread\.php\?t=\d+)", re.I)
URL_RE = re.compile(r"https?://[^\s)\"]+")


def wiki_url(entry: dict) -> str | None:
    candidates = list(entry.get("urls", []))
    candidates += URL_RE.findall(entry.get("notes", ""))
    for u in candidates:
        if re.search(r"doomwiki\.org/wiki/", u):
            return u
    return None


def has_forum_thread(entry: dict) -> bool:
    blob = " ".join(entry.get("urls", [])) + " " + entry.get("notes", "")
    return bool(THREAD_RE.search(blob))


def fetch(url: str) -> str:
    last: Exception | None = None
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001 - retry any transient failure
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise last  # type: ignore[misc]


def find_thread(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    anchors = [
        (a["href"], a.get_text(strip=True))
        for a in soup.find_all("a", href=True)
        if THREAD_RE.search(a["href"])
    ]
    if not anchors:
        return None
    # Prefer an anchor whose text mentions "thread" (the canonical release thread).
    for href, text in anchors:
        if "thread" in text.lower():
            return href
    return anchors[0][0]


def append_url_in_text(raw: str, new_url: str) -> str:
    """Surgically append new_url to the (non-empty) `urls` array in the raw JSON
    text, preserving all other formatting. Returns new text; raises on mismatch."""
    m = re.search(r'"urls"\s*:\s*\[(.*?)\]', raw, re.DOTALL)
    if not m:
        raise ValueError("no urls array found")
    body = m.group(1)
    indent_m = re.search(r'\n([ \t]*)"', body)
    if not indent_m:
        raise ValueError("urls array is empty — refusing to guess indentation")
    indent = indent_m.group(1)
    head = body.rstrip()                     # up to and incl. last element
    trailing_ws = body[len(head):]           # whitespace before the closing ]
    new_body = f'{head},\n{indent}{json.dumps(new_url)}{trailing_ws}'
    result = raw[: m.start(1)] + new_body + raw[m.end(1) :]
    # Verify: parses, only change is the appended url.
    before, after = json.loads(raw), json.loads(result)
    if after.get("urls") != [*before.get("urls", []), new_url]:
        raise ValueError("post-edit urls mismatch")
    after["urls"], before["urls"] = None, None
    if after != before:
        raise ValueError("post-edit entry changed beyond urls")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cap pages fetched (for testing)")
    args = ap.parse_args()

    files = sorted(WADS_DIR.glob("*.json"))

    todo = []
    for f in files:
        entry = json.loads(f.read_text(encoding="utf-8"))
        if has_forum_thread(entry):
            continue
        w = wiki_url(entry)
        if w:
            todo.append((f, entry, w))

    print(f"{len(files)} entries · {len(todo)} missing a forum thread but have a wiki page")
    if args.limit:
        todo = todo[: args.limit]

    # Fetch pages in parallel (DoomWiki throttles a serial crawl badly), then
    # apply the surgical edits sequentially so file writes never race.
    def resolve(item):
        f, entry, w = item
        try:
            return item, find_thread(fetch(w)), None
        except Exception as e:  # noqa: BLE001
            return item, None, str(e)

    found = miss = err = 0
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for (f, entry, w), thread, error in pool.map(resolve, todo):
            done += 1
            if error:
                err += 1
                print(f"  [{done}/{len(todo)}] ERR  {entry['slug']}: {error}", file=sys.stderr)
                continue
            if not thread:
                miss += 1
                print(f"  [{done}/{len(todo)}] --   {entry['slug']}: no thread on wiki page")
                continue
            found += 1
            print(f"  [{done}/{len(todo)}] OK   {entry['slug']}: {thread}")
            if not args.dry_run:
                raw = f.read_text(encoding="utf-8")
                f.write_text(append_url_in_text(raw, thread), encoding="utf-8")

    print(f"\nfound={found} no-thread={miss} errors={err}"
          + ("  (dry run, nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
