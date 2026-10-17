#!/usr/bin/env python3
"""Merge duplicate DoomLauncher imports without losing play data.

By default this only reports duplicate groups. Pass --apply to update the
library. The script creates JSON backups before making changes and keeps all
conflicting saves, stats and sessions by renaming the moved duplicate file.

Examples:
  python3 scripts/merge_duplicate_imports.py
  python3 scripts/merge_duplicate_imports.py --apply
  python3 scripts/merge_duplicate_imports.py --library /path/to/library --apply
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_LIBRARY = Path.home() / ".local/share/rusted-doom-launcher"
JSON_FILES = ("custom-wads.json", "launcher-downloads.json", "wad-ratings.json")
DATA_DIRS = ("saves", "stats", "sessions")


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().casefold())


def source_key(record: dict[str, Any]) -> str:
    path = record.get("externalPath") or record.get("wadFilename") or record.get("filename") or ""
    return normalize(Path(path).name)


def suffix_rank(slug: str) -> tuple[int, int, int, str]:
    """Prefer the original import (no generated -2/-3 suffix)."""
    match = re.search(r"-(\d+)$", slug)
    return (1 if match else 0, int(match.group(1)) if match else 0, len(slug), slug)


def kebab(text: str) -> str:
    """Match the importer's ASCII-only Rust `to_kebab` helper."""
    parts: list[str] = []
    previous_was_separator = True
    for char in text:
        if char.isascii() and char.isalnum():
            parts.append(char.lower())
            previous_was_separator = False
        elif not previous_was_separator:
            parts.append("-")
            previous_was_separator = True
    return "".join(parts).strip("-")


def choose_primary(entries: list[dict[str, Any]], ratings: dict[str, Any]) -> dict[str, Any]:
    # Prefer the slug the importer would have generated from the title.  A
    # title itself may end in a number (for example "RTC 3057 ... 04"), so
    # merely treating every trailing number as a collision suffix is wrong.
    # Rating is only a tiebreaker; ratings are merged below either way.
    expected_slug = f"custom-{kebab(str(entries[0].get('title', '')))}"
    return min(
        entries,
        key=lambda entry: (
            0 if entry.get("slug") == expected_slug else 1,
            suffix_rank(str(entry["slug"])),
            -int(ratings.get(entry["slug"], entry.get("rating", 0)) or 0),
        ),
    )


def merge_entry(primary: dict[str, Any], duplicates: list[dict[str, Any]], ratings: dict[str, Any]) -> None:
    all_entries = [primary, *duplicates]
    primary["tags"] = list(dict.fromkeys(tag for entry in all_entries for tag in entry.get("tags", [])))
    primary["authors"] = list(dict.fromkeys(
        json.dumps(author, sort_keys=True) for entry in all_entries for author in entry.get("authors", [])
    ))
    primary["authors"] = [json.loads(author) for author in primary["authors"]]
    primary["rating"] = max(int(entry.get("rating", 0) or 0) for entry in all_entries)
    for field in ("description", "notes"):
        primary[field] = max((str(entry.get(field, "")) for entry in all_entries), key=len, default="")

    merged_rating = max(
        [int(ratings.get(entry["slug"], entry.get("rating", 0)) or 0) for entry in all_entries],
        default=0,
    )
    if merged_rating:
        ratings[primary["slug"]] = merged_rating


def move_tree(source: Path, destination: Path, duplicate_slug: str, apply: bool) -> int:
    if not source.exists():
        return 0
    moved = 0
    for file_path in source.rglob("*"):
        if not file_path.is_file():
            continue
        relative = file_path.relative_to(source)
        target = destination / relative
        if target.exists():
            target = target.with_name(f"{target.stem}.from-{duplicate_slug}{target.suffix}")
        print(f"  data: {file_path} -> {target}")
        moved += 1
        if apply:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(file_path), str(target))
    if apply:
        shutil.rmtree(source, ignore_errors=True)
    return moved


def merge_level_names(library: Path, primary_slug: str, duplicate_slug: str, apply: bool) -> None:
    directory = library / "level-names"
    source = directory / f"{duplicate_slug}.json"
    target = directory / f"{primary_slug}.json"
    if not source.exists():
        return
    print(f"  level names: {source} -> {target}")
    if not apply:
        return
    if not target.exists():
        shutil.move(str(source), str(target))
        return
    try:
        primary = load_json(target, {})
        duplicate = load_json(source, {})
        if isinstance(primary, dict) and isinstance(duplicate, dict):
            write_json(target, {**duplicate, **primary})
            source.unlink()
            return
    except (OSError, json.JSONDecodeError):
        pass
    conflict = source.with_name(f"{duplicate_slug}.from-duplicate.json")
    shutil.move(str(source), str(conflict))


def backup_json(library: Path) -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = library / f"duplicate-import-backup-{stamp}"
    backup.mkdir()
    for name in JSON_FILES:
        source = library / name
        if source.exists():
            shutil.copy2(source, backup / name)
    print(f"JSON backups: {backup}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge repeated DoomLauncher imports.")
    parser.add_argument("--library", type=Path, default=DEFAULT_LIBRARY, help=f"Library path (default: {DEFAULT_LIBRARY})")
    parser.add_argument("--apply", action="store_true", help="Write changes; otherwise only print the planned merge.")
    args = parser.parse_args()
    library: Path = args.library.expanduser().resolve()
    custom_path = library / "custom-wads.json"
    if not custom_path.exists():
        print(f"Missing {custom_path}", file=sys.stderr)
        return 2

    custom = load_json(custom_path, {"version": 1, "entries": []})
    downloads_state = load_json(library / "launcher-downloads.json", {"version": 1, "downloads": {}})
    ratings_state = load_json(library / "wad-ratings.json", {"version": 1, "ratings": {}})
    entries: list[dict[str, Any]] = custom.get("entries", [])
    downloads: dict[str, dict[str, Any]] = downloads_state.get("downloads", {})
    ratings: dict[str, Any] = ratings_state.get("ratings", {})

    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        slug = entry.get("slug")
        if not isinstance(slug, str) or not slug.startswith("custom-"):
            continue
        key = source_key(downloads.get(slug, {}))
        title = normalize(str(entry.get("title", "")))
        if key and title:
            groups[(key, title)].append(entry)

    duplicate_groups = [group for group in groups.values() if len(group) > 1]
    if not duplicate_groups:
        print("No duplicate imports found.")
        return 0

    print(f"Found {len(duplicate_groups)} duplicate import groups.")
    removed_slugs: set[str] = set()
    for group in duplicate_groups:
        primary = choose_primary(group, ratings)
        duplicates = [entry for entry in group if entry is not primary]
        print(f"\nKeep {primary['slug']} ({primary['title']})")
        for duplicate in duplicates:
            print(f"  merge {duplicate['slug']}")
            removed_slugs.add(duplicate["slug"])
            merge_entry(primary, [duplicate], ratings)
            for directory in DATA_DIRS:
                move_tree(library / directory / duplicate["slug"], library / directory / primary["slug"], duplicate["slug"], args.apply)
            merge_level_names(library, primary["slug"], duplicate["slug"], args.apply)

            if primary["slug"] not in downloads and duplicate["slug"] in downloads:
                downloads[primary["slug"]] = downloads[duplicate["slug"]]
            downloads.pop(duplicate["slug"], None)
            ratings.pop(duplicate["slug"], None)

    print(f"\nWill remove {len(removed_slugs)} duplicate entries.")
    if not args.apply:
        print("Dry run only. Re-run with --apply to create backups and perform this merge.")
        return 0

    backup_json(library)
    custom["entries"] = [entry for entry in entries if entry.get("slug") not in removed_slugs]
    downloads_state["downloads"] = downloads
    ratings_state["ratings"] = ratings
    write_json(custom_path, custom)
    write_json(library / "launcher-downloads.json", downloads_state)
    write_json(library / "wad-ratings.json", ratings_state)
    print("Merge complete. Restart Rusted Doom Launcher to reload the library.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
