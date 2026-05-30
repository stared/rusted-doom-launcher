#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "beautifulsoup4",
#     "requests",
# ]
# ///
"""
Pull the structured metadata sidebar from a DoomWiki WAD page.

The wiki ships a consistent infobox table per WAD with: Author, Port, IWAD,
Year, idgames link, screenshots, Cacoward years. That's *everything* the
catalog needs — way more reliable than scraping the forum.

Usage:
    uv run scripts/scrape_doomwiki_wad.py <wiki-url> [<wiki-url> ...]

Prints one JSON line per page (jsonl), so you can pipe a Cacowards-missing
list straight into it.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

UA = "DoomLauncher-WikiScraper/1.0"
HEADERS = {"User-Agent": UA}


def fetch(url: str) -> str:
    if url.startswith("file://"):
        return Path(url[7:]).read_text(encoding="utf-8", errors="replace")
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    time.sleep(0.6)
    return r.text


def find_infobox(soup: BeautifulSoup):
    # The infobox table style is recognisably narrow: float:right + max-width 326px.
    for t in soup.find_all("table", class_="wikitable"):
        style = (t.get("style") or "").lower()
        if "float: right" in style or "float:right" in style:
            return t
    return None


def parse_infobox(table) -> dict:
    out: dict = {
        "title": "",
        "authors": [],
        "port": "",
        "iwad": "",
        "year": 0,
        "idgames_id": "",
        "idgames_url": "",
        "thumbnail": "",
        "cacoward_years": [],
    }
    if not table:
        return out

    # Title cell is the first <th colspan=2>.
    first_th = table.find("th")
    if first_th:
        out["title"] = first_th.get_text(strip=True)

    # Title screen image is the first <img> inside the table.
    img = table.find("img")
    if img:
        src = img.get("src", "")
        if src.startswith("/"):
            src = "https://doomwiki.org" + src
        # Strip wiki thumbnailer prefix to get the full-res file.
        src = re.sub(r"/thumb/([0-9a-f]/[0-9a-f]{2}/[^/]+)/\d+px-[^/]+$", r"/\1", src)
        out["thumbnail"] = src

    for row in table.find_all("tr"):
        th, td = row.find("th"), row.find("td")
        if not (th and td):
            continue
        key = th.get_text(" ", strip=True).lower()
        val = td.get_text(" ", strip=True)
        if "author" in key:
            out["authors"] = [a.strip() for a in re.split(r",| and ", val) if a.strip()]
        elif "port" in key:
            out["port"] = val
        elif "iwad" in key:
            out["iwad"] = val
        elif "year" in key:
            m = re.search(r"\d{4}", val)
            if m:
                out["year"] = int(m.group(0))
        elif "link" in key or "links" in key:
            a = td.find("a", href=re.compile(r"idgames/\?id=\d+"))
            if a:
                href = a["href"]
                out["idgames_url"] = href
                m = re.search(r"id=(\d+)", href)
                if m:
                    out["idgames_id"] = m.group(1)

    # Cacoward years (each Cacoward badge cell mentions the year).
    cacoward_pattern = re.compile(r"/cacowards/(\d{4})/")
    for a in table.find_all("a", href=cacoward_pattern):
        y = int(cacoward_pattern.search(a["href"]).group(1))
        if y not in out["cacoward_years"]:
            out["cacoward_years"].append(y)

    return out


def parse_page(url: str, html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    box = parse_infobox(find_infobox(soup))
    box["source_wiki_url"] = url
    return box


def normalise_port(s: str) -> str:
    # Map DoomWiki phrasing → our schema's sourcePort enum.
    t = s.lower()
    if "mbf21" in t:                   return "mbf21"
    if "boom" in t:                    return "boom"
    if "limit-removing" in t or "limit removing" in t: return "limit_removing"
    if "vanilla" in t:                 return "vanilla"
    if "gzdoom" in t or "zdoom" in t:  return "gzdoom"
    return "boom"  # safe default — most modern community megawads target Boom


def normalise_iwad(s: str) -> str:
    t = s.lower()
    if "plutonia" in t: return "plutonia"
    if "tnt" in t:      return "tnt"
    if "heretic" in t:  return "heretic"
    if "hexen" in t:    return "hexen"
    if "doom ii" in t or "doom 2" in t: return "doom2"
    if "doom" in t:     return "doom"
    return "doom2"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="+", help="DoomWiki WAD URLs (or file:///path/to/cached.html)")
    ap.add_argument("--normalize", action="store_true",
                    help="add launcher-schema-friendly fields (sourcePort, iwad_slug)")
    args = ap.parse_args()

    for url in args.urls:
        try:
            html = fetch(url)
            box = parse_page(url, html)
            if args.normalize:
                box["sourcePort"] = normalise_port(box["port"])
                box["iwad_slug"] = normalise_iwad(box["iwad"])
            print(json.dumps(box, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"source_wiki_url": url, "error": str(e)}), file=sys.stderr)


if __name__ == "__main__":
    main()
