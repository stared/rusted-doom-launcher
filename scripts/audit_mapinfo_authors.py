"""
Audit how often MAPINFO contains an Author field across local WAD/PK3 files.

Mirrors the inspector logic in src/lib/wadInspect.ts:
- WAD: parse 12-byte header, walk 16-byte lump directory, find MAPINFO/ZMAPINFO,
  decode the lump bytes, regex for Author = "...".
- PK3: open as ZIP, find any entry whose basename is MAPINFO or ZMAPINFO (with
  any extension), regex the bytes.

Pass a list of directories on the command line; defaults to the active library.
"""

from __future__ import annotations

import re
import struct
import sys
import zipfile
from pathlib import Path

DEFAULT_ROOTS = [
    "/Users/pmigdal/Library/Application Support/rusted-doom-launcher",
]

AUTHOR_RE = re.compile(rb'^\s*Author\s*=\s*"([^"]+)"', re.IGNORECASE | re.MULTILINE)
MAP_NAME_RE = re.compile(rb'^\s*map\s+\S+\s+"([^"]+)"', re.IGNORECASE | re.MULTILINE)


def inspect_wad(path: Path) -> tuple[str | None, str | None, str]:
    """Return (author, first_map_name, note). note describes parser outcome."""
    try:
        data = path.read_bytes()
    except Exception as e:
        return None, None, f"read-error: {e}"
    if len(data) < 12:
        return None, None, "too-small"
    magic = data[:4]
    if magic not in (b"IWAD", b"PWAD"):
        return None, None, f"bad-magic: {magic!r}"
    num_lumps, dir_offset = struct.unpack_from("<ii", data, 4)
    if dir_offset < 0 or dir_offset + num_lumps * 16 > len(data):
        return None, None, "bad-directory"
    mapinfo = None
    for i in range(num_lumps):
        entry = dir_offset + i * 16
        offset, size = struct.unpack_from("<ii", data, entry)
        name = data[entry + 8:entry + 16].rstrip(b"\x00").decode("ascii", "replace")
        if name in ("ZMAPINFO", "MAPINFO"):
            mapinfo = data[offset:offset + size]
            break
    note = "no-mapinfo" if mapinfo is None else "ok"
    author = None
    first = None
    if mapinfo is not None:
        m = AUTHOR_RE.search(mapinfo)
        if m:
            author = m.group(1).decode("utf-8", "replace")
        m = MAP_NAME_RE.search(mapinfo)
        if m:
            first = m.group(1).decode("utf-8", "replace")
    return author, first, note


def inspect_pk3(path: Path) -> tuple[str | None, str | None, str]:
    try:
        with zipfile.ZipFile(path) as zf:
            mapinfo_entry = None
            for name in zf.namelist():
                base = name.split("/")[-1].lower()
                if base == "mapinfo" or base == "zmapinfo" or base.startswith("mapinfo.") or base.startswith("zmapinfo."):
                    mapinfo_entry = name
                    break
            if mapinfo_entry is None:
                return None, None, "no-mapinfo"
            payload = zf.read(mapinfo_entry)
    except zipfile.BadZipFile:
        return None, None, "bad-zip"
    except Exception as e:
        return None, None, f"err: {e}"
    author = None
    first = None
    m = AUTHOR_RE.search(payload)
    if m:
        author = m.group(1).decode("utf-8", "replace")
    m = MAP_NAME_RE.search(payload)
    if m:
        first = m.group(1).decode("utf-8", "replace")
    return author, first, "ok"


def main() -> None:
    roots = [Path(p) for p in (sys.argv[1:] or DEFAULT_ROOTS)]
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            print(f"skip (not a dir): {root}", file=sys.stderr)
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in (".wad", ".pk3"):
                files.append(p)

    total = len(files)
    with_author = 0
    with_map_name = 0
    with_mapinfo = 0

    rows: list[tuple[str, str, str, str, str]] = []
    for p in sorted(files):
        ext = p.suffix.lower()
        author, first, note = (
            inspect_wad(p) if ext == ".wad" else inspect_pk3(p)
        )
        rows.append((p.name, ext, note, author or "", first or ""))
        if note == "ok":
            with_mapinfo += 1
        if author:
            with_author += 1
        if first:
            with_map_name += 1

    name_w = max((len(r[0]) for r in rows), default=10)
    print(f"{'file':<{name_w}}  ext   note         author                          first map")
    print("-" * (name_w + 90))
    for name, ext, note, author, first in rows:
        print(f"{name:<{name_w}}  {ext:<4}  {note:<11}  {author[:30]:<30}  {first[:30]}")
    print("-" * (name_w + 90))
    print(f"total: {total}  with-MAPINFO: {with_mapinfo}  with-Author: {with_author}  with-first-map-name: {with_map_name}")


if __name__ == "__main__":
    main()
