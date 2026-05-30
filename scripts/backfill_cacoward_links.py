#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["beautifulsoup4", "requests"]
# ///
"""
Backfill Cacoward writeup URLs into the WAD catalog.

For every awarded entry (awards[].type == "cacoward") that has a DoomWiki page
but no Cacoward link yet, scrape the wiki infobox for the Cacowards writeup URL
(forms vary by year: /cacowards/YYYY/, /11years/, /22years/, ...) and append it
to the entry's `urls` array. The launcher surfaces it as a [Cacoward] chip.

Usage:
    uv run scripts/backfill_cacoward_links.py --dry-run
    uv run scripts/backfill_cacoward_links.py
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

CACO_RE = re.compile(r"doomworld\.com/(?:cacowards/\d+|\d+years)/?", re.I)
URL_RE = re.compile(r"https?://[^\s)\"]+")


def wiki_url(entry: dict) -> str | None:
    for u in [*entry.get("urls", []), *URL_RE.findall(entry.get("notes", ""))]:
        if re.search(r"doomwiki\.org/wiki/", u):
            return u
    return None


def is_awarded(entry: dict) -> bool:
    return any(a.get("type") == "cacoward" for a in entry.get("awards", []))


def has_cacoward(entry: dict) -> bool:
    blob = " ".join(entry.get("urls", [])) + " " + entry.get("notes", "")
    return bool(CACO_RE.search(blob))


def fetch(url: str) -> str:
    last: Exception | None = None
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise last  # type: ignore[misc]


def find_infobox(soup: BeautifulSoup):
    for t in soup.find_all("table", class_="wikitable"):
        style = (t.get("style") or "").lower()
        if "float: right" in style or "float:right" in style:
            return t
    return None


def find_cacoward(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    box = find_infobox(soup)
    # Only trust the infobox — the page footer navbox lists every Cacoward year.
    scope = box if box is not None else soup
    for a in scope.find_all("a", href=True):
        m = CACO_RE.search(a["href"])
        if m:
            url = m.group(0)
            if url.startswith("http"):
                return url if url.endswith("/") else url + "/"
            return "https://www." + url.lstrip("/")
    return None


def append_url_in_text(raw: str, new_url: str) -> str:
    m = re.search(r'"urls"\s*:\s*\[(.*?)\]', raw, re.DOTALL)
    if not m:
        raise ValueError("no urls array found")
    body = m.group(1)
    indent_m = re.search(r'\n([ \t]*)"', body)
    if not indent_m:
        raise ValueError("urls array is empty")
    indent = indent_m.group(1)
    head = body.rstrip()
    trailing_ws = body[len(head):]
    new_body = f'{head},\n{indent}{json.dumps(new_url)}{trailing_ws}'
    result = raw[: m.start(1)] + new_body + raw[m.end(1) :]
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
    args = ap.parse_args()

    files = sorted(WADS_DIR.glob("*.json"))
    todo = []
    for f in files:
        entry = json.loads(f.read_text(encoding="utf-8"))
        if not is_awarded(entry) or has_cacoward(entry):
            continue
        w = wiki_url(entry)
        if w:
            todo.append((f, entry, w))

    print(f"{len(files)} entries · {len(todo)} awarded, missing a Cacoward link, with a wiki page")

    def resolve(item):
        f, entry, w = item
        try:
            return item, find_cacoward(fetch(w)), None
        except Exception as e:  # noqa: BLE001
            return item, None, str(e)

    found = miss = err = 0
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for (f, entry, w), caco, error in pool.map(resolve, todo):
            done += 1
            if error:
                err += 1
                print(f"  [{done}/{len(todo)}] ERR  {entry['slug']}: {error}", file=sys.stderr)
                continue
            if not caco:
                miss += 1
                print(f"  [{done}/{len(todo)}] --   {entry['slug']}: no cacoward link in infobox")
                continue
            found += 1
            print(f"  [{done}/{len(todo)}] OK   {entry['slug']}: {caco}")
            if not args.dry_run:
                raw = f.read_text(encoding="utf-8")
                f.write_text(append_url_in_text(raw, caco), encoding="utf-8")

    print(f"\nfound={found} no-cacoward={miss} errors={err}"
          + ("  (dry run, nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
