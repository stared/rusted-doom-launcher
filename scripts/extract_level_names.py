#!/usr/bin/env python3
"""
Extract level names from WAD files.

WAD files can contain level names in several lumps:
- MAPINFO: ZDoom/GZDoom format with `map MAP01 "Level Name" { ... }`
- EMAPINFO: Alternative format with `[MAP01] levelname = MAP01: Level Name`
- ZMAPINFO: Extended ZDoom format (similar to MAPINFO)
- UMAPINFO: Universal MAPINFO (Boom-compatible)

Usage:
    uv run scripts/extract_level_names.py <wad_file>
    uv run scripts/extract_level_names.py <wad_file> --json
"""

import struct
import re
import sys
import json
from pathlib import Path


def read_wad_directory(wad_path: Path) -> list[tuple[str, int, int]]:
    """Read WAD directory and return list of (name, offset, size) tuples."""
    with open(wad_path, "rb") as f:
        # WAD header: 4 bytes magic, 4 bytes num_lumps, 4 bytes dir_offset
        header = f.read(12)
        if len(header) < 12:
            raise ValueError("Invalid WAD file: too short")

        magic = header[:4].decode("ascii", errors="ignore")
        if magic not in ("IWAD", "PWAD"):
            raise ValueError(f"Invalid WAD magic: {magic}")

        num_lumps, dir_offset = struct.unpack("<II", header[4:12])

        # Read directory
        f.seek(dir_offset)
        entries = []
        for _ in range(num_lumps):
            entry = f.read(16)
            if len(entry) < 16:
                break
            offset, size = struct.unpack("<II", entry[:8])
            name = entry[8:16].rstrip(b"\x00").decode("ascii", errors="ignore")
            entries.append((name, offset, size))

        return entries


def read_lump(wad_path: Path, offset: int, size: int) -> bytes:
    """Read lump data from WAD file."""
    with open(wad_path, "rb") as f:
        f.seek(offset)
        return f.read(size)


def parse_mapinfo(content: str) -> dict[str, str]:
    """
    Parse MAPINFO/ZMAPINFO format.
    Format: map MAP01 "Level Name" { ... }
    """
    levels = {}

    # Pattern: map MAP01 "Level Name" or map MAP01 lookup "HUSTR_E1M1"
    # Also handles: map MAP01 "Level Name" {}
    pattern = r'map\s+(\w+)\s+"([^"]+)"'
    for match in re.finditer(pattern, content, re.IGNORECASE):
        map_id = match.group(1).upper()
        level_name = match.group(2)
        levels[map_id] = level_name

    return levels


def parse_emapinfo(content: str) -> dict[str, str]:
    """
    Parse EMAPINFO format.
    Format:
    [MAP01]
    levelname = MAP01: Level Name
    """
    levels = {}
    current_map = None

    for line in content.split("\n"):
        line = line.strip()

        # Check for [MAP01] section header
        section_match = re.match(r"\[(\w+)\]", line)
        if section_match:
            current_map = section_match.group(1).upper()
            continue

        # Check for levelname = value
        if current_map:
            name_match = re.match(r"levelname\s*=\s*(.+)", line, re.IGNORECASE)
            if name_match:
                level_name = name_match.group(1).strip()
                # Remove MAP01: prefix if present
                level_name = re.sub(r"^" + current_map + r":\s*", "", level_name)
                levels[current_map] = level_name

    return levels


def parse_umapinfo(content: str) -> dict[str, str]:
    """
    Parse UMAPINFO format.
    Format:
    MAP MAP01
    {
        levelname = "Level Name"
    }
    """
    levels = {}
    current_map = None

    for line in content.split("\n"):
        line = line.strip()

        # Check for MAP MAP01
        map_match = re.match(r"MAP\s+(\w+)", line, re.IGNORECASE)
        if map_match:
            current_map = map_match.group(1).upper()
            continue

        # Check for levelname = "value" or levelname = value
        if current_map:
            name_match = re.match(r'levelname\s*=\s*"?([^"]+)"?', line, re.IGNORECASE)
            if name_match:
                level_name = name_match.group(1).strip()
                levels[current_map] = level_name

    return levels


def extract_level_names(wad_path: Path) -> dict[str, str]:
    """Extract level names from a WAD file."""
    entries = read_wad_directory(wad_path)
    levels = {}

    # Look for MAPINFO-style lumps
    mapinfo_lumps = ["MAPINFO", "ZMAPINFO", "EMAPINFO", "UMAPINFO"]

    for name, offset, size in entries:
        if name.upper() in mapinfo_lumps and size > 0:
            try:
                data = read_lump(wad_path, offset, size)
                content = data.decode("utf-8", errors="ignore")

                if name.upper() == "EMAPINFO":
                    parsed = parse_emapinfo(content)
                elif name.upper() == "UMAPINFO":
                    parsed = parse_umapinfo(content)
                else:
                    parsed = parse_mapinfo(content)

                # Merge, preferring earlier lumps
                for map_id, level_name in parsed.items():
                    if map_id not in levels:
                        levels[map_id] = level_name

            except Exception as e:
                print(f"Warning: Failed to parse {name}: {e}", file=sys.stderr)

    return levels


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    wad_path = Path(sys.argv[1])
    if not wad_path.exists():
        print(f"Error: File not found: {wad_path}", file=sys.stderr)
        sys.exit(1)

    output_json = "--json" in sys.argv

    try:
        levels = extract_level_names(wad_path)

        if not levels:
            print("No level names found in WAD file.", file=sys.stderr)
            sys.exit(0)

        if output_json:
            print(json.dumps(levels, indent=2))
        else:
            # Sort by map ID (numeric sort for MAP01, MAP02, etc.)
            def sort_key(item):
                map_id = item[0]
                # Extract number from MAP01, E1M1, etc.
                match = re.search(r"(\d+)", map_id)
                return (int(match.group(1)) if match else 999, map_id)

            for map_id, level_name in sorted(levels.items(), key=sort_key):
                print(f"{map_id}: {level_name}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
