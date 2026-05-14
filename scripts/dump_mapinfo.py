"""
Dump the first 2 KB of each MAPINFO/ZMAPINFO lump in the library so we can
eyeball whether *any* author-like metadata is present under a different name.
"""

from __future__ import annotations

import struct
import sys
import zipfile
from pathlib import Path

DEFAULT_ROOTS = [
    "/Users/pmigdal/Library/Application Support/rusted-doom-launcher",
]


def wad_mapinfo(path: Path) -> bytes | None:
    data = path.read_bytes()
    if len(data) < 12:
        return None
    if data[:4] not in (b"IWAD", b"PWAD"):
        return None
    num_lumps, dir_offset = struct.unpack_from("<ii", data, 4)
    for i in range(num_lumps):
        entry = dir_offset + i * 16
        offset, size = struct.unpack_from("<ii", data, entry)
        name = data[entry + 8:entry + 16].rstrip(b"\x00").decode("ascii", "replace")
        if name in ("ZMAPINFO", "MAPINFO"):
            return data[offset:offset + size]
    return None


def pk3_mapinfo(path: Path) -> bytes | None:
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                base = name.split("/")[-1].lower()
                if base == "mapinfo" or base == "zmapinfo" or base.startswith("mapinfo.") or base.startswith("zmapinfo."):
                    return zf.read(name)
    except zipfile.BadZipFile:
        return None
    return None


def main() -> None:
    roots = [Path(p) for p in (sys.argv[1:] or DEFAULT_ROOTS)]
    for root in roots:
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext not in (".wad", ".pk3"):
                continue
            payload = wad_mapinfo(p) if ext == ".wad" else pk3_mapinfo(p)
            if not payload:
                continue
            print("=" * 80)
            print(f"{p.name}  ({len(payload)} bytes)")
            print("=" * 80)
            head = payload[:2048].decode("utf-8", errors="replace")
            print(head)
            print()


if __name__ == "__main__":
    main()
