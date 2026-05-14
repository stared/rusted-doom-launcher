# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "pillow",
# ]
# ///
"""
Extract TITLEPIC from a .zip bundle (idgames-style) by finding the .wad/.pk3
inside and running the same decoder as extract_titlepic.py. Pass zip paths
as args.
"""

from __future__ import annotations

import sys
import zipfile
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_titlepic import (  # type: ignore
    GRAPHIC_LUMP_NAMES,
    PNG_MAGIC,
    decode_doom_picture,
    load_playpal,
    pk3_graphics,
    wad_graphics,
)


def main() -> None:
    palette = load_playpal()
    if len(sys.argv) < 2:
        sys.exit("usage: extract_titlepic_from_zip.py <zip> [<zip> ...]")
    outdir = Path("/tmp/titlepic_out")
    outdir.mkdir(parents=True, exist_ok=True)

    for zpath in sys.argv[1:]:
        zp = Path(zpath)
        print(f"\n=== {zp.name} ===")
        try:
            with zipfile.ZipFile(zp) as zf:
                for entry in zf.namelist():
                    if not entry.lower().endswith((".wad", ".pk3")):
                        continue
                    blob = zf.read(entry)
                    print(f"inside zip: {entry}  ({len(blob):,} bytes)")
                    inner_name = entry.split("/")[-1]
                    ext = inner_name.lower().rsplit(".", 1)[-1]

                    # Save the inner file to /tmp so we can reuse the file-based
                    # decoders that the existing script expects.
                    tmp_inner = Path(f"/tmp/_inner_{zp.stem}_{inner_name}")
                    tmp_inner.write_bytes(blob)

                    graphics = wad_graphics(tmp_inner) if ext == "wad" else pk3_graphics(tmp_inner)
                    if not graphics:
                        print("  (no title-screen-class lumps found)")
                        continue
                    for name, payload in graphics:
                        safe = name.replace("/", "_")
                        out_path = outdir / f"{zp.stem}--{inner_name}--{safe}.png"
                        if payload.startswith(PNG_MAGIC):
                            out_path.write_bytes(payload)
                            print(f"  PNG passthrough  {out_path.name}")
                        else:
                            img = decode_doom_picture(payload, palette)
                            if img is None:
                                print(f"  decode-fail      {name}")
                            else:
                                img.save(out_path)
                                print(f"  Doom-format      {out_path.name} ({img.width}x{img.height})")
        except zipfile.BadZipFile as e:
            print(f"  bad-zip: {e}")


if __name__ == "__main__":
    main()
