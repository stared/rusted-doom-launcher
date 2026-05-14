"""
Read headers and contents of every WAD/PK3 in the library and dump
everything that might carry author / year / title metadata. We DON'T pre-
filter for a specific field name — we look at:

  * WAD: every lump's name + first 200 bytes of human-readable content,
    full text of MAPINFO/ZMAPINFO if present.
  * PK3: every entry path, plus the first 2 KB of each .txt/.md/README and
    of MAPINFO/ZMAPINFO/zscript/decorate text lumps.

The point is to SEE what's actually there, not to validate a guess.
"""

from __future__ import annotations

import struct
import sys
import zipfile
from pathlib import Path

DEFAULT_ROOTS = [
    "/Users/pmigdal/Library/Application Support/rusted-doom-launcher",
]

TEXT_EXTS = (".txt", ".md", ".nfo", ".rst")
TEXT_LUMP_BASENAMES = {
    "mapinfo", "zmapinfo", "umapinfo",
    "decorate", "zscript",
    "credits", "authors", "author", "readme",
    "gameinfo", "keyconf", "language",
}


def is_printable(b: bytes) -> bool:
    if not b:
        return False
    printable = sum(1 for c in b if 9 <= c <= 13 or 32 <= c < 127)
    return printable / len(b) > 0.85


def wad_lumps(path: Path) -> list[tuple[str, bytes]]:
    data = path.read_bytes()
    if len(data) < 12 or data[:4] not in (b"IWAD", b"PWAD"):
        return []
    num_lumps, dir_offset = struct.unpack_from("<ii", data, 4)
    out = []
    for i in range(num_lumps):
        entry = dir_offset + i * 16
        if entry + 16 > len(data):
            break
        offset, size = struct.unpack_from("<ii", data, entry)
        name = data[entry + 8:entry + 16].rstrip(b"\x00").decode("ascii", "replace")
        payload = data[offset:offset + size] if size and 0 <= offset < len(data) else b""
        out.append((name, payload))
    return out


def dump_wad(path: Path) -> None:
    print(f"\n{'#' * 80}")
    print(f"# WAD: {path}")
    print(f"# size: {path.stat().st_size:,} bytes")
    print(f"{'#' * 80}")
    lumps = wad_lumps(path)
    print(f"lump count: {len(lumps)}")
    interesting = []
    for name, payload in lumps:
        ln = name.lower()
        if ln in TEXT_LUMP_BASENAMES or ln in ("credit", "author", "authors"):
            interesting.append((name, payload))
        elif is_printable(payload[:200]) and len(payload) < 5000:
            # Small text-looking lump
            interesting.append((name, payload))
    print(f"text-ish lumps: {len(interesting)}")
    for name, payload in interesting:
        print(f"--- lump: {name} ({len(payload)} bytes) ---")
        try:
            text = payload[:2000].decode("utf-8", errors="replace")
        except Exception:
            text = repr(payload[:2000])
        print(text)


def dump_pk3(path: Path) -> None:
    print(f"\n{'#' * 80}")
    print(f"# PK3: {path}")
    print(f"# size: {path.stat().st_size:,} bytes")
    print(f"{'#' * 80}")
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
            print(f"entry count: {len(names)}")
            # Print top-level structure summary
            top_level = sorted({n.split("/")[0] for n in names if "/" in n})
            print(f"top-level: {top_level}")

            interesting: list[tuple[str, bytes]] = []
            for n in names:
                low = n.lower()
                base = low.split("/")[-1]
                # Match text-y root files OR known text lumps
                if low.endswith(TEXT_EXTS):
                    interesting.append((n, zf.read(n)))
                    continue
                # match bare lump names like "mapinfo" or "mapinfo.txt"
                stem = base.rsplit(".", 1)[0]
                if stem in TEXT_LUMP_BASENAMES or base in TEXT_LUMP_BASENAMES:
                    interesting.append((n, zf.read(n)))

            print(f"text-ish entries: {len(interesting)}")
            for n, payload in interesting:
                print(f"--- entry: {n} ({len(payload)} bytes) ---")
                try:
                    text = payload[:2000].decode("utf-8", errors="replace")
                except Exception:
                    text = repr(payload[:2000])
                print(text)
    except zipfile.BadZipFile:
        print("bad-zip")
    except Exception as e:
        print(f"err: {e}")


def main() -> None:
    roots = [Path(p) for p in (sys.argv[1:] or DEFAULT_ROOTS)]
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            print(f"skip (not a dir): {root}", file=sys.stderr)
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in (".wad", ".pk3"):
                files.append(p)
    for p in files:
        if p.suffix.lower() == ".wad":
            dump_wad(p)
        else:
            dump_pk3(p)


if __name__ == "__main__":
    main()
