"""
Score every WAD/PK3 in the library against multiple potential metadata
sources. We want to know which sources actually fire on real files.

Sources checked:
  * WAD: 'README', 'CREDIT', 'CREDITS', 'AUTHOR', 'AUTHORS' lumps
  * WAD: MAPINFO/ZMAPINFO with `Author = "..."` regex
  * WAD: any MAPINFO/ZMAPINFO with `map FOO "Name"` syntax
  * PK3: any `README.{txt,md}` at root
  * PK3: any `CREDITS.{txt,md}` at root
  * PK3: any `*.txt` at root with idgames `Authors? :` line
  * PK3: MAPINFO with `Author = "..."`
  * PK3: any `*.txt`/`.md` at root with a copyright line (Copyright ... <name>)

For each source, report hit count and an example file. Output sorted by hit
rate so the actually-useful ones come first.
"""

from __future__ import annotations

import re
import struct
import sys
import zipfile
from collections import Counter
from pathlib import Path

DEFAULT_ROOTS = [
    "/Users/pmigdal/Library/Application Support/rusted-doom-launcher",
]


AUTHOR_LINE_RE = re.compile(rb"^\s*Authors?\s*:\s*(.+?)$", re.IGNORECASE | re.MULTILINE)
TITLE_LINE_RE = re.compile(rb"^\s*Title\s*:\s*(.+?)$", re.IGNORECASE | re.MULTILINE)
DATE_LINE_RE = re.compile(rb"^\s*(?:Release\s*date|Date)\s*:\s*(.+?)$", re.IGNORECASE | re.MULTILINE)
COPYRIGHT_RE = re.compile(rb"Copyright\s*(?:\(c\)|\xc2\xa9)?\s*(\d{4})?[,\s]*(?:by\s+)?([A-Z][A-Za-z0-9 .'\-]+)", re.IGNORECASE)
MAPINFO_AUTHOR_RE = re.compile(rb'^\s*Author\s*=\s*"([^"]+)"', re.IGNORECASE | re.MULTILINE)
MAPINFO_MAP_NAME_RE = re.compile(rb'^\s*map\s+\S+\s+"([^"]+)"', re.IGNORECASE | re.MULTILINE)


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


def pk3_entries(path: Path) -> list[tuple[str, bytes]]:
    out = []
    try:
        with zipfile.ZipFile(path) as zf:
            for n in zf.namelist():
                out.append((n, zf.read(n)))
    except zipfile.BadZipFile:
        return []
    return out


def score_file(path: Path) -> dict[str, str]:
    """Return source-name -> example extracted value (empty if not hit)."""
    ext = path.suffix.lower()
    hits: dict[str, str] = {}

    if ext == ".wad":
        for name, payload in wad_lumps(path):
            n = name.upper()
            if n in {"README", "CREDIT", "CREDITS", "AUTHOR", "AUTHORS"}:
                # take first non-blank line
                line = next((ln for ln in payload[:1000].splitlines() if ln.strip()), b"")
                if line:
                    hits[f"WAD-lump:{n}"] = line.decode("utf-8", "replace")[:80]
            if n in {"MAPINFO", "ZMAPINFO"}:
                m = MAPINFO_AUTHOR_RE.search(payload)
                if m:
                    hits["WAD-MAPINFO-Author"] = m.group(1).decode("utf-8", "replace")
                m = MAPINFO_MAP_NAME_RE.search(payload)
                if m:
                    hits["WAD-MAPINFO-MapName"] = m.group(1).decode("utf-8", "replace")
    elif ext == ".pk3":
        for entry, payload in pk3_entries(path):
            depth = entry.count("/")
            base = entry.lower().split("/")[-1]
            is_root = (depth == 0)
            is_root_or_one_deep = depth <= 1
            stem = base.rsplit(".", 1)[0]

            if base in {"mapinfo", "zmapinfo"} or stem in {"mapinfo", "zmapinfo"}:
                m = MAPINFO_AUTHOR_RE.search(payload)
                if m:
                    hits["PK3-MAPINFO-Author"] = m.group(1).decode("utf-8", "replace")
                m = MAPINFO_MAP_NAME_RE.search(payload)
                if m:
                    hits["PK3-MAPINFO-MapName"] = m.group(1).decode("utf-8", "replace")

            if not is_root_or_one_deep:
                continue
            if base.endswith((".txt", ".md", ".nfo")):
                m = AUTHOR_LINE_RE.search(payload)
                if m:
                    val = m.group(1).decode("utf-8", "replace").strip()
                    hits.setdefault("PK3-txt-Authors-field", f"{base}: {val[:60]}")
                m = TITLE_LINE_RE.search(payload)
                if m:
                    val = m.group(1).decode("utf-8", "replace").strip()
                    hits.setdefault("PK3-txt-Title-field", f"{base}: {val[:60]}")
                m = DATE_LINE_RE.search(payload)
                if m:
                    val = m.group(1).decode("utf-8", "replace").strip()
                    hits.setdefault("PK3-txt-Date-field", f"{base}: {val[:60]}")
                m = COPYRIGHT_RE.search(payload[:3000])
                if m and m.group(2):
                    name = m.group(2).decode("utf-8", "replace").strip()
                    year = m.group(1).decode("utf-8", "replace") if m.group(1) else ""
                    hits.setdefault("PK3-txt-Copyright", f"{base}: {year} {name}".strip()[:80])

    return hits


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

    source_hits: Counter[str] = Counter()
    examples: dict[str, list[str]] = {}
    per_file: list[tuple[Path, dict[str, str]]] = []

    for p in files:
        hits = score_file(p)
        per_file.append((p, hits))
        for k, v in hits.items():
            source_hits[k] += 1
            examples.setdefault(k, []).append(f"{p.name}: {v}")

    total = len(files)
    print(f"Total files: {total}\n")
    print(f"{'source':<28}  {'hits':<6}  {'%':<6}  example")
    print("-" * 100)
    for source, count in sorted(source_hits.items(), key=lambda x: -x[1]):
        pct = f"{100 * count / total:.0f}%"
        example = examples[source][0]
        print(f"{source:<28}  {count:<6}  {pct:<6}  {example[:60]}")

    print()
    print("Per file hits:")
    for p, hits in per_file:
        ext = p.suffix.lower()
        sources = list(hits.keys()) if hits else ["(no signal)"]
        print(f"  {ext} {p.name:<40}  -> {', '.join(sources)}")


if __name__ == "__main__":
    main()
