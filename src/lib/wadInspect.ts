// File inspector for the custom-WAD/PK3 importer. Pulls human-readable
// metadata (title, author, year) out of user-picked files when we can.
//
// What this extracts is constrained by what real Doom files actually carry,
// which is much less than the spec implies. Hit rates measured against an
// in-the-wild library of 24 mixed WADs/PK3s (audit lives in
// scripts/audit_info_sources.py — re-run on any path with `uv run`):
//
//   Title:
//     - PK3 root .txt with `Title : ...` idgames-format       12%
//     - MAPINFO `map FOO "Name"` (first map's display name)   17% PK3, 4% WAD
//     - filename fallback                                     100%
//   Author:
//     - PK3 root .txt with `Authors : ...` idgames-format      8%
//   Year:
//     - PK3 root .txt with `Release date : ...` (4-digit year extracted)  12%
//
// What we DON'T look at, and why:
//   - MAPINFO `Author = "..."` — 0/24 hit rate. The spec defines it; in
//     practice authors don't populate it. Don't bring it back without a
//     newer audit showing it's earning its place.
//   - WAD `README` / `CREDITS` / `AUTHORS` lumps — these exist on a couple
//     of files (OTEX has one) but they're free-form prose, not idgames
//     fields. parseInfoText only matches structured `Field : value` lines,
//     so a regex pass on these lumps yields nothing on real corpora. If
//     someone wants to mine OTEX-style "X by Y\nReleased YYYY-MM-DD" text,
//     that's a separate parser, not this one.
//   - WAD `CREDIT` lump — it's a 320x200 graphic, not text.
//   - File mtime / zip-internal timestamps — too noisy (download date,
//     extraction date, etc.) to use as a year signal.
//
// Everything below is the minimum that earns its keep on the audit corpus.
import { unzipSync } from "fflate";
import { invoke } from "@tauri-apps/api/core";
import type { Iwad, WadEntry } from "./schema";

function decodeText(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

// Caps for reading archive entries during inspection; larger entries are
// skipped and inspection degrades gracefully.
const MAX_TEXT_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_ENTRY_BYTES = 32 * 1024 * 1024;

export interface FileInspection {
  format: "wad" | "pk3";
  isIwad: boolean;
  mapCount: number;
  mapNames: string[];
  firstMapTitle: string;
  author: string;
  year: number;             // 0 if not found
  hasGameplayCode: boolean;
  suggestedType: WadEntry["type"];
  suggestedIwad: Iwad;
  titlepic: Titlepic | null;
}

export interface Titlepic {
  png: Uint8Array;
  width: number;
  height: number;
}

// Doom2's first PLAYPAL palette (256 × RGB = 768 bytes), baked in so the
// decoder doesn't need to find an IWAD at inspect time. PWADs almost never
// ship their own PLAYPAL; they rely on the IWAD's, which for Doom 1 and Doom 2
// is functionally identical for non-status-bar pixels. Source: extracted from
// DOOM2.WAD via scripts/extract_titlepic.py.
const DOOM_PLAYPAL_HEX = "0000001f170b170f074b4b4bffffff1b1b1b1313130b0b0b0707072f371f232b0f171f070f17004f3b2b4733233f2b1bffb7b7f7ababf3a3a3eb9797e78f8fdf8787db7b7bd37373cb6b6bc76363bf5b5bbb5757b34f4faf4747a73f3fa33b3b9b3333972f2f8f2b2b8b2323831f1f7f1b1b7717177313136b0f0f670b0b5f07075b07075307074f0000470000430000ffebdfffe3d3ffdbc7ffd3bbffcfb3ffc7a7ffbf9bffbb93ffb383f7ab7befa373e79b6bdf9363d78b5bcf8353cb7f4fbf7b4bb37347ab6f43a36b3f9b633b8f5f378757337f532f774f2b6b47275f4323533f1f4b371b3f2f17332b132b230fefefefe7e7e7dfdfdfdbdbdbd3d3d3cbcbcbc7c7c7bfbfbfb7b7b7b3b3b3abababa7a7a79f9f9f9797979393938b8b8b8383837f7f7f7777776f6f6f6b6b6b6363635b5b5b5757574f4f4f4747474343433b3b3b3737372f2f2f27272723232377ff6f6fef6767df5f5fcf575bbf4f53af474b9f3f4393373f832f37732b2f632327531b1f431717330f13230b0b1707bfa78fb79f87af977fa78f779f876f9b7f6b937b638b735b836b577b634f775f4b6f574367533f5f4b37574333533f2f9f83638f7753836b4b775f3f6753335b472b4f3b2343331b7b7f636f7357676b4f5b634753573b474f333f472b373f27ffff73ebdb57d7bb43c39b2faf7b1f9b5b13874307732b00ffffffffdbdbffbbbbff9b9bff7b7bff5f5fff3f3fff1f1fff0000ef0000e30000d70000cb0000bf0000b30000a700009b00008b00007f00007300006700005b00004f0000430000e7e7ffc7c7ffababff8f8fff7373ff5353ff3737ff1b1bff0000ff0000e30000cb0000b300009b00008300006b000053ffffffffebdbffd7bbffc79bffb37bffa35bff8f3bff7f1bf37317eb6f0fdf670fd75f0bcb5707c34f00b74700af4300ffffffffffd7ffffb3ffff8fffff6bffff47ffff23ffff00a73f009f3700932f008723004f3b27432f1b3723132f1b0b00005300004700003b00002f00002300001700000b000000ff9f43ffe74bff7bffff00ffcf00cf9f009b6f006ba76b6b";

let cachedPalette: Uint8Array | null = null;
function getPalette(): Uint8Array {
  if (cachedPalette) return cachedPalette;
  const out = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    out[i] = parseInt(DOOM_PLAYPAL_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  cachedPalette = out;
  return out;
}

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function startsWithPng(data: Uint8Array): boolean {
  if (data.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (data[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

// Decode a Doom posted-column picture into an RGB Uint8Array.
// Returns null if the bytes don't look like a valid picture.
function decodeDoomPicture(data: Uint8Array): { rgb: Uint8Array; width: number; height: number } | null {
  if (data.length < 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  // leftoffset/topoffset at bytes 4..7 — unused for full-screen images.
  if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;
  if (8 + width * 4 > data.length) return null;

  const palette = getPalette();
  const rgb = new Uint8Array(width * height * 3);

  for (let x = 0; x < width; x++) {
    const colOff = view.getUint32(8 + x * 4, true);
    if (colOff >= data.length) return null;
    let i = colOff;
    let prevTop = -1;
    while (i < data.length) {
      const topdelta = data[i];
      if (topdelta === 0xff) break;
      i += 1;
      if (i >= data.length) return null;
      const length = data[i];
      i += 1;
      // skip unused padding byte
      i += 1;
      // tall-patch continuation: if topdelta <= prevTop, it's a delta from prevTop
      const actualTop = topdelta > prevTop ? topdelta : prevTop + topdelta;
      prevTop = actualTop;
      if (i + length > data.length) return null;
      for (let n = 0; n < length; n++) {
        const y = actualTop + n;
        if (y >= 0 && y < height) {
          const idx = data[i + n];
          const base = (y * width + x) * 3;
          rgb[base + 0] = palette[idx * 3 + 0];
          rgb[base + 1] = palette[idx * 3 + 1];
          rgb[base + 2] = palette[idx * 3 + 2];
        }
      }
      i += length;
      // skip trailing unused padding byte
      i += 1;
    }
  }
  return { rgb, width, height };
}

async function encodeRgbToPng(rgb: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4 + 0] = rgb[i * 3 + 0];
    imageData.data[i * 4 + 1] = rgb[i * 3 + 1];
    imageData.data[i * 4 + 2] = rgb[i * 3 + 2];
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

// Reads a candidate title-screen lump (from a WAD or PK3 entry) and returns
// PNG bytes ready to drop on disk. Two paths: PNG passthrough when the entry
// is already PNG (modern PK3s), and Doom posted-column decode otherwise.
async function imageBytesToPng(data: Uint8Array): Promise<Titlepic | null> {
  if (startsWithPng(data)) {
    // Read width/height from the PNG IHDR for the caller's info; otherwise we'd
    // have to decode the PNG just to know its dimensions.
    if (data.length < 24) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { png: data, width, height };
  }
  const decoded = decodeDoomPicture(data);
  if (!decoded) return null;
  const png = await encodeRgbToPng(decoded.rgb, decoded.width, decoded.height);
  return { png, width: decoded.width, height: decoded.height };
}

const MAP_NAME_RE = /^(MAP\d{2}|E[1-9]M[1-9])$/;

// idgames "Doom file template" fields. They look like:
//   Title       : Beautiful Doom
//   Authors     : Jekyll Grim Payne, Gifty
//   Release date: 12.06.2020
// Field name is left-aligned, whitespace before colon, value to end of line.
const TXT_TITLE_RE = /^\s*Title\s*:\s*(.+?)\s*$/im;
const TXT_AUTHOR_RE = /^\s*Authors?\s*:\s*(.+?)\s*$/im;
const TXT_DATE_RE = /^\s*(?:Release\s*date|Date)\s*:\s*(.+?)\s*$/im;

const MAPINFO_MAP_NAME_RE = /^\s*map\s+\S+\s+"([^"]+)"/im;

export async function inspectFile(filename: string, data: Uint8Array): Promise<FileInspection> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "wad") return inspectWad(data);
  if (ext === "pk3") return inspectPk3(data);
  throw new Error(`Unsupported extension: .${ext}`);
}

async function inspectWad(data: Uint8Array): Promise<FileInspection> {
  if (data.length < 12) throw new Error("WAD file too small");
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "IWAD" && magic !== "PWAD") {
    throw new Error(`Not a WAD file (magic: ${magic})`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numLumps = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);

  const lumps: { name: string; offset: number; size: number }[] = [];
  for (let i = 0; i < numLumps; i++) {
    const entry = dirOffset + i * 16;
    const offset = view.getInt32(entry, true);
    const size = view.getInt32(entry + 4, true);
    let name = "";
    for (let j = 0; j < 8; j++) {
      const c = data[entry + 8 + j];
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    lumps.push({ name, offset, size });
  }

  const lumpNames = lumps.map(l => l.name);
  const mapNames = Array.from(new Set(lumpNames.filter(n => MAP_NAME_RE.test(n)))).sort();
  const hasGameplayCode =
    lumpNames.includes("DECORATE") ||
    lumpNames.includes("ZSCRIPT") ||
    lumpNames.includes("DEHACKED");

  let firstMapTitle = "";

  const mapInfoLump = lumps.find(l => l.name === "ZMAPINFO" || l.name === "MAPINFO");
  if (mapInfoLump) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      data.subarray(mapInfoLump.offset, mapInfoLump.offset + mapInfoLump.size)
    );
    const m = text.match(MAPINFO_MAP_NAME_RE);
    if (m) firstMapTitle = m[1];
  }

  let titlepic: Titlepic | null = null;
  // Try TITLEPIC first, then INTERPIC as fallback; modern megawads sometimes
  // skip TITLEPIC but still have an interpic.
  for (const lumpName of ["TITLEPIC", "INTERPIC"]) {
    const lump = lumps.find(l => l.name === lumpName);
    if (lump) {
      const bytes = data.subarray(lump.offset, lump.offset + lump.size);
      try {
        titlepic = await imageBytesToPng(bytes);
        if (titlepic) break;
      } catch (e) {
        console.warn(`[wadInspect] ${lumpName} decode failed:`, e);
      }
    }
  }

  return {
    format: "wad",
    isIwad: magic === "IWAD",
    mapCount: mapNames.length,
    mapNames,
    firstMapTitle,
    author: "",
    year: 0,
    hasGameplayCode,
    suggestedType: suggestType(mapNames.length, hasGameplayCode),
    suggestedIwad: guessIwad(mapNames),
    titlepic,
  };
}

// One pk3 entry the inspector can lazily pull — backed by an in-memory
// unzip or by the Rust `read_zip_entry` command.
interface Pk3EntryRef {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

/** Inspect a .pk3 on disk from its zip-entry listing. */
export async function inspectPk3FromArchive(archivePath: string): Promise<FileInspection> {
  const entries = await invoke<{ path: string; size: number }[]>("list_zip_entries", {
    zipPath: archivePath,
  });
  const refs: Pk3EntryRef[] = entries.map(e => ({
    path: e.path,
    size: e.size,
    read: async () =>
      new Uint8Array(
        await invoke<ArrayBuffer>("read_zip_entry", {
          zipPath: archivePath,
          entryPath: e.path,
          maxBytes: e.size,
        })
      ),
  }));
  return inspectPk3Entries(refs);
}

async function inspectPk3(data: Uint8Array): Promise<FileInspection> {
  const entries = unzipSync(data);
  const refs: Pk3EntryRef[] = Object.entries(entries).map(([path, payload]) => ({
    path,
    size: payload.length,
    read: async () => payload,
  }));
  return inspectPk3Entries(refs);
}

async function inspectPk3Entries(refs: Pk3EntryRef[]): Promise<FileInspection> {
  const paths = refs.map(r => r.path);

  const mapNamesSet = new Set<string>();
  for (const p of paths) {
    const m = p.match(/^maps\/(MAP\d{2}|E[1-9]M[1-9])\.(wad|map)$/i);
    if (m) mapNamesSet.add(m[1].toUpperCase());
  }
  const mapNames = Array.from(mapNamesSet).sort();

  const basenames = paths.map(p => (p.toLowerCase().split("/").pop() ?? ""));
  const hasGameplayCode = basenames.some(b =>
    b === "decorate" || b.startsWith("decorate.") ||
    b === "zscript" || b.startsWith("zscript.") ||
    b === "dehacked" || b.startsWith("dehacked.")
  );

  let firstMapTitle = "";
  let author = "";
  let year = 0;

  // MAPINFO/ZMAPINFO — used only for the human-readable map name.
  const mapInfoEntry = refs.find(r => {
    const base = (r.path.toLowerCase().split("/").pop() ?? "");
    return base === "mapinfo" || base === "zmapinfo" ||
      base.startsWith("mapinfo.") || base.startsWith("zmapinfo.");
  });
  if (mapInfoEntry && mapInfoEntry.size <= MAX_TEXT_ENTRY_BYTES) {
    const text = decodeText(await mapInfoEntry.read());
    const m = text.match(MAPINFO_MAP_NAME_RE);
    if (m) firstMapTitle = m[1];
  }

  // idgames-format text files shipped inside the PK3 root/+1 level deep.
  // These reliably carry Title/Authors/Release-date when present (Beautiful
  // Doom, game_support.pk3, etc.). Scan them in order and take first hit per
  // field.
  for (const ref of refs) {
    const depth = ref.path.split("/").length - 1;
    if (depth > 1) continue;
    const base = ref.path.toLowerCase().split("/").pop() ?? "";
    if (!/\.(txt|md|nfo)$/i.test(base)) continue;
    if (ref.size > MAX_TEXT_ENTRY_BYTES) continue;
    const text = decodeText(await ref.read());
    const parsed = parseInfoText(text);
    if (!author && parsed.author) author = parsed.author;
    if (!year && parsed.year) year = parsed.year;
    if (!firstMapTitle && parsed.title) firstMapTitle = parsed.title;
    if (author && year && firstMapTitle) break;
  }

  // Look for TITLEPIC/INTERPIC under any common path: graphics/, root, or as
  // a bare entry with no folder. Modern PK3s ship PNG; old ones ship Doom-format.
  let titlepic: Titlepic | null = null;
  const candidatePaths = ["TITLEPIC", "INTERPIC"];
  for (const candidate of candidatePaths) {
    const entry = refs.find(r => {
      const base = (r.path.split("/").pop() ?? "").toUpperCase();
      const stem = base.replace(/\.[^.]+$/, "");
      return stem === candidate;
    });
    if (entry && entry.size <= MAX_IMAGE_ENTRY_BYTES) {
      try {
        titlepic = await imageBytesToPng(await entry.read());
        if (titlepic) break;
      } catch (e) {
        console.warn(`[wadInspect] ${candidate} decode failed:`, e);
      }
    }
  }

  return {
    format: "pk3",
    isIwad: false,
    mapCount: mapNames.length,
    mapNames,
    firstMapTitle,
    author,
    year,
    hasGameplayCode,
    suggestedType: suggestType(mapNames.length, hasGameplayCode),
    suggestedIwad: guessIwad(mapNames),
    titlepic,
  };
}

// Pulls Title / Authors / Date from an idgames-format text file. Tolerant of
// variant spellings (Author vs Authors, Release date vs Date). Year is the
// last 4-digit year mentioned in the date string — covers "12.06.2020",
// "2020-07-03", "Jan 5, 2003", and bare "1994".
export function parseInfoText(text: string): { title: string; author: string; year: number } {
  const titleMatch = text.match(TXT_TITLE_RE);
  const authorMatch = text.match(TXT_AUTHOR_RE);
  const dateMatch = text.match(TXT_DATE_RE);

  let year = 0;
  if (dateMatch) {
    const yearMatches = dateMatch[1].match(/(19[9]\d|20\d\d)/g);
    if (yearMatches && yearMatches.length > 0) {
      year = parseInt(yearMatches[yearMatches.length - 1], 10);
    }
  }

  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    author: authorMatch ? authorMatch[1].trim() : "",
    year,
  };
}

/**
 * Minimal inspection for files too large to read into the webview.
 * Import still works; the user just fills in metadata by hand.
 */
export function fallbackInspection(format: "wad" | "pk3"): FileInspection {
  return {
    format,
    isIwad: false,
    mapCount: 0,
    mapNames: [],
    firstMapTitle: "",
    author: "",
    year: 0,
    hasGameplayCode: false,
    suggestedType: format === "pk3" ? "gameplay-mod" : "megawad",
    suggestedIwad: "doom2",
    titlepic: null,
  };
}

function suggestType(mapCount: number, hasGameplayCode: boolean): WadEntry["type"] {
  if (mapCount === 0 && hasGameplayCode) return "gameplay-mod";
  if (mapCount >= 15) return "megawad";
  if (mapCount >= 2) return "episode";
  if (mapCount === 1) return "single-level";
  return "megawad";
}

function guessIwad(mapNames: string[]): Iwad {
  return mapNames.some(n => /^E[1-9]M[1-9]$/.test(n)) ? "doom" : "doom2";
}
