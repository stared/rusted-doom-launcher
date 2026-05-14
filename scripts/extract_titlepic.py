# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "pillow",
# ]
# ///
"""
Empirical TITLEPIC extractor — scan every WAD/PK3 in the library, decode any
TITLEPIC/INTERPIC/CREDIT/HELP/BOSSBACK graphics found, dump as PNG to /tmp.

Two code paths:
  - PK3 entry whose bytes start with the PNG magic (\\x89PNG…) → save as-is.
  - WAD lump or PK3 entry with .lmp / no extension and Doom posted-column
    layout → decode using width/height header + column offsets + posts,
    map indices through PLAYPAL (Doom2's first palette, baked at /tmp from
    DOOM2.WAD), write as 24-bit PNG. Transparent pixels (gaps between posts)
    rendered as black; TITLEPIC has no transparency in practice.

Run: uv run scripts/extract_titlepic.py
Output: /tmp/titlepic_out/<filename>--<lumpname>.png

This is a diagnostic / coverage script, not production code. The TS inspector
will mirror this logic if the coverage is worth it.
"""

from __future__ import annotations

import struct
import sys
import zipfile
from pathlib import Path

from PIL import Image  # type: ignore

DEFAULT_ROOTS = [
    "/Users/pmigdal/Library/Application Support/rusted-doom-launcher",
]

GRAPHIC_LUMP_NAMES = {
    "TITLEPIC", "INTERPIC", "CREDIT", "HELP", "HELP1", "HELP2",
    "BOSSBACK", "VICTORY2", "ENDPIC", "TITLE",
}

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

OUTDIR = Path("/tmp/titlepic_out")


def load_playpal() -> bytes:
    """Doom2's first PLAYPAL palette (256 RGB triples = 768 bytes)."""
    p = Path("/tmp/playpal.bin")
    if not p.exists():
        sys.exit("missing /tmp/playpal.bin — extract from a Doom IWAD first")
    pal = p.read_bytes()
    if len(pal) != 768:
        sys.exit(f"PLAYPAL wrong size: {len(pal)}")
    return pal


def decode_doom_picture(data: bytes, palette: bytes) -> Image.Image | None:
    """Decode a Doom posted-column picture. Returns None if format invalid."""
    if len(data) < 8:
        return None
    width, height, left, top = struct.unpack_from("<HHhh", data, 0)
    if width == 0 or height == 0 or width > 4096 or height > 4096:
        return None
    if 8 + width * 4 > len(data):
        return None
    col_offs = struct.unpack_from(f"<{width}I", data, 8)

    rgb = bytearray(width * height * 3)  # black initially

    for x, col_off in enumerate(col_offs):
        if col_off >= len(data):
            return None
        i = col_off
        prev_top = -1
        while i < len(data):
            topdelta = data[i]
            if topdelta == 0xFF:
                break
            i += 1
            if i >= len(data):
                return None
            length = data[i]
            i += 1
            # skip unused byte
            i += 1
            # Tall-patch continuation: if topdelta <= prev_top, sum.
            actual_top = topdelta if topdelta > prev_top else prev_top + topdelta
            prev_top = actual_top
            if i + length > len(data):
                return None
            for n in range(length):
                y = actual_top + n
                if 0 <= y < height:
                    idx = data[i + n]
                    base = (y * width + x) * 3
                    rgb[base + 0] = palette[idx * 3 + 0]
                    rgb[base + 1] = palette[idx * 3 + 1]
                    rgb[base + 2] = palette[idx * 3 + 2]
            i += length
            # skip trailing unused byte
            i += 1
    return Image.frombytes("RGB", (width, height), bytes(rgb))


def wad_graphics(path: Path) -> list[tuple[str, bytes]]:
    data = path.read_bytes()
    if len(data) < 12 or data[:4] not in (b"IWAD", b"PWAD"):
        return []
    nl, off = struct.unpack_from("<ii", data, 4)
    out = []
    for i in range(nl):
        e = off + i * 16
        o, s = struct.unpack_from("<ii", data, e)
        n = data[e + 8:e + 16].rstrip(b"\x00").decode("ascii", "replace").upper()
        if n in GRAPHIC_LUMP_NAMES:
            out.append((n, data[o:o + s]))
    return out


def pk3_graphics(path: Path) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(path) as zf:
            for n in zf.namelist():
                base = n.split("/")[-1].lower()
                stem = base.rsplit(".", 1)[0]
                if stem in {g.lower() for g in GRAPHIC_LUMP_NAMES}:
                    out.append((n, zf.read(n)))
    except zipfile.BadZipFile:
        pass
    return out


def save_image(path: Path, lump_name: str, payload: bytes, palette: bytes) -> str:
    OUTDIR.mkdir(parents=True, exist_ok=True)
    safe_lump = lump_name.replace("/", "_").replace("\\", "_")
    out_path = OUTDIR / f"{path.stem}--{safe_lump}.png"

    if payload.startswith(PNG_MAGIC):
        out_path.write_bytes(payload)
        return f"PNG passthrough  {out_path.name} ({len(payload):,} bytes)"
    img = decode_doom_picture(payload, palette)
    if img is None:
        return f"decode-fail     {path.name}::{lump_name}"
    img.save(out_path)
    return f"Doom-format     {out_path.name} ({img.width}x{img.height})"


def main() -> None:
    palette = load_playpal()
    roots = [Path(p) for p in (sys.argv[1:] or DEFAULT_ROOTS)]
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            print(f"skip: {root}", file=sys.stderr)
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in (".wad", ".pk3"):
                files.append(p)

    extracted = 0
    files_with_any = 0
    for p in files:
        graphics = wad_graphics(p) if p.suffix.lower() == ".wad" else pk3_graphics(p)
        if graphics:
            files_with_any += 1
            for name, payload in graphics:
                msg = save_image(p, name, payload, palette)
                print(f"{p.name:<40}  {name:<32}  {msg}")
                if "fail" not in msg:
                    extracted += 1
    print()
    print(f"files scanned: {len(files)}")
    print(f"files with any graphic: {files_with_any}")
    print(f"images extracted: {extracted}")
    print(f"output: {OUTDIR}")


if __name__ == "__main__":
    main()
