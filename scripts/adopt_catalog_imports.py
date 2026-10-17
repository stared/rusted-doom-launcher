#!/usr/bin/env python3
"""Adopt matching DoomLauncher custom imports into the bundled WAD catalog.

The script only accepts an unambiguous exact match by title or by the archive
filename recorded in ``content/wads``. It is a dry run by default:

    python3 scripts/adopt_catalog_imports.py --library /path/to/library
    python3 scripts/adopt_catalog_imports.py --library /path/to/library --apply
    python3 scripts/adopt_catalog_imports.py --library /path/to/library --rescan-wads --apply
    python3 scripts/adopt_catalog_imports.py --library /path/to/library --clear-custom-urls --rescan-wads --apply

``--apply`` backs up the three library JSON state files before it changes them.
User data under saves/, stats/, sessions/, and level-names/ is moved to the
catalog slug. If that slug already has a download record, the entry is skipped
to avoid merging two potentially different local copies automatically. Use
``--overwrite-conflicts`` with ``--apply`` to replace such catalog state; the
replaced JSON and user-data paths are copied into the backup first.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_DIR = REPO_ROOT / "content" / "wads"
DEFAULT_LIBRARY = Path.home() / ".local/share/rusted-doom-launcher"
STATE_FILES = ("custom-wads.json", "launcher-downloads.json", "wad-ratings.json")
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
WHERE_TO_GET_RE = re.compile(r"^\s*\*+\s*Where to get the file that this text file describes\s*\*+\s*$", re.IGNORECASE | re.MULTILINE)
SECTION_HEADER_RE = re.compile(r"^\s*\*+\s*[^\n]*\s*\*+\s*$", re.MULTILINE)
KNOWN_WAD_DOMAINS = {
    "doomworld.com", "doomwiki.org", "github.com", "gitlab.com", "moddb.com",
    "archive.org", "dsdarchive.com", "doomshack.org", "zdoom.org", "zandronum.com",
}
TITLE_RE = re.compile(r"^\s*Title\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
AUTHOR_RE = re.compile(r"^\s*Authors?\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)
DATE_RE = re.compile(r"^\s*(?:Release\s*date|Date)\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")


def key(value: str) -> str:
    """Match the app's conservative title/archive normalization."""
    value = re.sub(r"\.[a-z0-9]{2,5}$", "", value.casefold())
    return re.sub(r"[^a-z0-9]+", "", value)


def basename(value: str) -> str:
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def catalog_matches() -> dict[str, list[str]]:
    """Return normalized title/archive keys mapped to possible catalog slugs."""
    matches: dict[str, list[str]] = {}
    for path in CATALOG_DIR.glob("*.json"):
        entry = load_json(path, {})
        slug = entry.get("slug")
        title = entry.get("title")
        if not isinstance(slug, str) or not isinstance(title, str):
            continue
        for value in [title, *(download.get("filename", "") for download in entry.get("downloads", []))]:
            if isinstance(value, str) and (normalized := key(value)):
                matches.setdefault(normalized, []).append(slug)
    return matches


def find_slug(entry: dict[str, Any], download: dict[str, Any], matches: dict[str, list[str]]) -> str | None:
    candidates: set[str] = set()
    for value in (entry.get("title", ""), basename(str(download.get("filename", ""))), basename(str(download.get("wadFilename", "")))):
        candidates.update(matches.get(key(str(value)), []))
    return next(iter(candidates)) if len(candidates) == 1 else None


def backup_state(library: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = library / f"catalog-adoption-backup-{stamp}"
    backup.mkdir()
    for name in STATE_FILES:
        source = library / name
        if source.exists():
            shutil.copy2(source, backup / name)
    return backup


def backup_catalog_data(library: Path, backup: Path, slug: str) -> None:
    """Save existing catalog play data before --overwrite-conflicts replaces it."""
    for directory in ("saves", "stats", "sessions"):
        source = library / directory / slug
        target = backup / directory / slug
        if source.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, target)
    source = library / "level-names" / f"{slug}.json"
    target = backup / "level-names" / f"{slug}.json"
    if source.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def move_path(source: Path, target: Path) -> None:
    if not source.exists():
        return
    if target.exists():
        raise RuntimeError(f"target already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))


def remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def move_user_data(library: Path, old_slug: str, new_slug: str) -> None:
    for directory in ("saves", "stats", "sessions"):
        move_path(library / directory / old_slug, library / directory / new_slug)
    move_path(
        library / "level-names" / f"{old_slug}.json",
        library / "level-names" / f"{new_slug}.json",
    )


def clean_urls(text: str) -> list[str]:
    match = WHERE_TO_GET_RE.search(text)
    if not match:
        return []
    section = text[match.end():]
    if next_header := SECTION_HEADER_RE.search(section):
        section = section[:next_header.start()]
    urls: list[str] = []
    for raw_url in URL_RE.findall(section):
        url = raw_url.rstrip(").,;:!?")
        host = re.sub(r"^www\.", "", url.split("/", 3)[2].casefold())
        if any(host == domain or host.endswith(f".{domain}") for domain in KNOWN_WAD_DOMAINS):
            urls.append(url)
    return list(dict.fromkeys(urls))


def read_wad_text_lumps(path: Path) -> list[str]:
    """Read only conventional prose lumps, never arbitrary binary map data."""
    try:
        with path.open("rb") as source:
            header = source.read(12)
            if len(header) != 12 or header[:4] not in (b"IWAD", b"PWAD"):
                return []
            count, directory = struct.unpack("<ii", header[4:])
            if count < 0 or count > 100_000 or directory < 0:
                return []
            source.seek(directory)
            entries = [source.read(16) for _ in range(count)]
            texts: list[str] = []
            for entry in entries:
                if len(entry) != 16:
                    continue
                offset, size, raw_name = struct.unpack("<ii8s", entry)
                name = raw_name.rstrip(b"\0").decode("ascii", "ignore").upper()
                if name not in {"README", "CREDITS", "AUTHORS", "INFO", "ABOUT"} or not 0 < size <= 1_000_000:
                    continue
                source.seek(offset)
                texts.append(source.read(size).decode("utf-8", "replace"))
            return texts
    except OSError:
        return []


def read_metadata_texts(path: Path) -> list[str]:
    texts: list[str] = []
    # A bare WAD/PK3 commonly has a same-stem .txt alongside it.
    for suffix in (".txt", ".md", ".nfo"):
        sibling = path.with_suffix(suffix)
        if sibling.is_file():
            try:
                texts.append(sibling.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    if path.suffix.lower() == ".wad":
        texts.extend(read_wad_text_lumps(path))
    if path.suffix.lower() in {".zip", ".pk3"}:
        try:
            with zipfile.ZipFile(path) as archive:
                for info in archive.infolist():
                    if info.is_dir() or not info.filename.lower().endswith((".txt", ".md", ".nfo")):
                        continue
                    if info.file_size > 1_000_000:
                        continue
                    texts.append(archive.read(info).decode("utf-8", "replace"))
        except (OSError, zipfile.BadZipFile):
            pass
    return texts


def first_match(pattern: re.Pattern[str], texts: list[str]) -> str:
    for text in texts:
        if match := pattern.search(text):
            return match.group(1).strip()
    return ""


def rescan_custom_entry(entry: dict[str, Any], download: dict[str, Any], library: Path) -> bool:
    raw_path = download.get("externalPath") or download.get("filename")
    if not isinstance(raw_path, str) or not raw_path:
        return False
    path = Path(raw_path) if download.get("externalPath") else library / raw_path
    if not path.is_file():
        return False
    texts = read_metadata_texts(path)
    if not texts:
        return False
    changed = False
    urls = list(entry.get("urls", []))
    for url in clean_urls("\n".join(texts)):
        if url not in urls:
            urls.append(url)
            changed = True
    entry["urls"] = urls
    # Do not overwrite information the user supplied. Fill only the importer
    # placeholders, using the same structured idgames fields as the app.
    title = first_match(TITLE_RE, texts)
    if title and entry.get("title", "").casefold() == path.stem.casefold():
        entry["title"] = title
        changed = True
    author = first_match(AUTHOR_RE, texts)
    authors = entry.get("authors", [])
    if author and authors == [{"name": "User import"}]:
        entry["authors"] = [{"name": name.strip()} for name in re.split(r"[,;&]", author) if name.strip()]
        changed = True
    date = first_match(DATE_RE, texts)
    years = re.findall(r"(?:19[9]\d|20\d\d)", date)
    if years and entry.get("year") == datetime.now().year:
        entry["year"] = int(years[-1])
        changed = True
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Adopt matching custom DoomLauncher imports into the WAD catalog.")
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY, help=f"Library directory (default: {DEFAULT_LIBRARY})")
    parser.add_argument("--apply", action="store_true", help="Perform the migration; otherwise print the plan only.")
    parser.add_argument("--overwrite-conflicts", action="store_true", help="Replace existing catalog downloads and play data (only valid with --apply).")
    parser.add_argument("--rescan-wads", action="store_true", help="Rescan remaining custom WADs/PK3s/ZIPs for README links and structured metadata.")
    parser.add_argument("--clear-custom-urls", action="store_true", help="Clear URLs from custom entries; combine with --rescan-wads to rebuild them.")
    args = parser.parse_args()
    if args.overwrite_conflicts and not args.apply:
        parser.error("--overwrite-conflicts requires --apply")
    library = args.library.expanduser().resolve()
    custom_path = library / "custom-wads.json"
    if not custom_path.exists():
        parser.error(f"missing {custom_path}")

    custom = load_json(custom_path, {"version": 1, "entries": []})
    downloads_state = load_json(library / "launcher-downloads.json", {"version": 1, "downloads": {}})
    ratings_state = load_json(library / "wad-ratings.json", {"version": 1, "ratings": {}})
    entries: list[dict[str, Any]] = custom.get("entries", [])
    downloads: dict[str, dict[str, Any]] = downloads_state.get("downloads", {})
    ratings: dict[str, int] = ratings_state.get("ratings", {})
    matches = catalog_matches()

    cleared_entries = 0
    cleared_urls = 0
    if args.clear_custom_urls:
        for entry in entries:
            if entry.get("_source") != "custom":
                continue
            urls = entry.get("urls", [])
            if isinstance(urls, list) and urls:
                cleared_entries += 1
                cleared_urls += len(urls)
                entry["urls"] = []
        print(f"Cleared {cleared_urls} URL(s) from {cleared_entries} custom WAD(s).")

    rescanned = 0
    if args.rescan_wads:
        for entry in entries:
            slug = entry.get("slug")
            if entry.get("_source") == "custom" and isinstance(slug, str):
                if rescan_custom_entry(entry, downloads.get(slug, {}), library):
                    rescanned += 1
        print(f"Rescan found new metadata for {rescanned} custom WAD(s).")

    planned: list[tuple[dict[str, Any], str, bool]] = []
    for entry in entries:
        old_slug = entry.get("slug")
        if not isinstance(old_slug, str) or entry.get("_source") != "custom":
            continue
        new_slug = find_slug(entry, downloads.get(old_slug, {}), matches)
        if not new_slug or new_slug == old_slug:
            continue
        has_download = new_slug in downloads
        conflicts = [library / directory / new_slug for directory in ("saves", "stats", "sessions")]
        has_data = any(path.exists() for path in conflicts) or (library / "level-names" / f"{new_slug}.json").exists()
        has_conflict = has_download or has_data
        if has_conflict and not args.overwrite_conflicts:
            reason = "catalog entry already has a download record" if has_download else "catalog entry already has play data"
            print(f"SKIP  {old_slug} -> {new_slug}: {reason}")
            continue
        planned.append((entry, new_slug, has_conflict))

    if not planned:
        if not rescanned and not cleared_entries:
            print("No unambiguous custom imports need catalog adoption.")
            return 0
        if not args.apply:
            print("Dry run only. Re-run with --apply to save the metadata changes.")
            return 0
        backup = backup_state(library)
        write_json(custom_path, custom)
        print(f"Updated metadata for {rescanned} custom WAD(s). JSON backup: {backup}")
        return 0
    print(f"Found {len(planned)} custom import(s) to adopt:")
    for entry, new_slug, has_conflict in planned:
        prefix = "OVERWRITE" if has_conflict else "ADOPT"
        print(f"  {prefix}  {entry['slug']} ({entry.get('title', 'untitled')}) -> {new_slug}")
    if not args.apply:
        print("Dry run only. Re-run with --apply to migrate these entries.")
        return 0

    backup = backup_state(library)
    for entry, new_slug, has_conflict in planned:
        old_slug = entry["slug"]
        if has_conflict:
            backup_catalog_data(library, backup, new_slug)
            for directory in ("saves", "stats", "sessions"):
                remove_path(library / directory / new_slug)
            remove_path(library / "level-names" / f"{new_slug}.json")
            downloads.pop(new_slug, None)
            ratings.pop(new_slug, None)
        move_user_data(library, old_slug, new_slug)
        if old_slug in downloads:
            downloads[new_slug] = downloads.pop(old_slug)
        if old_slug in ratings:
            ratings[new_slug] = ratings.pop(old_slug)
        elif isinstance(entry.get("rating"), int) and 0 < entry["rating"] <= 5:
            # Older imports stored the rating on the custom entry itself,
            # before ratings gained their separate state file.
            ratings[new_slug] = entry["rating"]
    removed = {entry["slug"] for entry, _, _ in planned}
    custom["entries"] = [entry for entry in entries if entry.get("slug") not in removed]
    downloads_state["downloads"] = downloads
    ratings_state["ratings"] = ratings
    write_json(custom_path, custom)
    write_json(library / "launcher-downloads.json", downloads_state)
    write_json(library / "wad-ratings.json", ratings_state)
    print(f"Adopted {len(planned)} WAD(s). JSON backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
