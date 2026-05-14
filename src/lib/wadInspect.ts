import { unzipSync, strFromU8 } from "fflate";
import type { Iwad, WadEntry } from "./schema";

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

export function inspectFile(filename: string, data: Uint8Array): FileInspection {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "wad") return inspectWad(data);
  if (ext === "pk3") return inspectPk3(data);
  throw new Error(`Unsupported extension: .${ext}`);
}

function inspectWad(data: Uint8Array): FileInspection {
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
  const mapNames = lumpNames.filter(n => MAP_NAME_RE.test(n));
  const hasGameplayCode =
    lumpNames.includes("DECORATE") ||
    lumpNames.includes("ZSCRIPT") ||
    lumpNames.includes("DEHACKED");

  let firstMapTitle = "";
  let author = "";
  let year = 0;

  const mapInfoLump = lumps.find(l => l.name === "ZMAPINFO" || l.name === "MAPINFO");
  if (mapInfoLump) {
    const text = decodeLump(data, mapInfoLump.offset, mapInfoLump.size);
    const m = text.match(MAPINFO_MAP_NAME_RE);
    if (m) firstMapTitle = m[1];
  }

  // Free-form text lumps that authors use for credits/readme (OTEX-style).
  for (const readmeLump of lumps.filter(l => l.name === "README" || l.name === "AUTHORS" || l.name === "AUTHOR" || l.name === "CREDITS")) {
    const text = decodeLump(data, readmeLump.offset, readmeLump.size);
    const parsed = parseInfoText(text);
    if (!author && parsed.author) author = parsed.author;
    if (!year && parsed.year) year = parsed.year;
    if (!firstMapTitle && parsed.title) firstMapTitle = parsed.title;
  }

  return {
    format: "wad",
    isIwad: magic === "IWAD",
    mapCount: mapNames.length,
    mapNames,
    firstMapTitle,
    author,
    year,
    hasGameplayCode,
    suggestedType: suggestType(mapNames.length, hasGameplayCode),
    suggestedIwad: guessIwad(mapNames),
  };
}

function inspectPk3(data: Uint8Array): FileInspection {
  const entries = unzipSync(data);
  const paths = Object.keys(entries);

  const mapNames: string[] = [];
  for (const p of paths) {
    const m = p.match(/^maps\/(MAP\d{2}|E[1-9]M[1-9])\.(wad|map)$/i);
    if (m) mapNames.push(m[1].toUpperCase());
  }

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
  const mapInfoEntry = Object.entries(entries).find(([p]) => {
    const base = (p.toLowerCase().split("/").pop() ?? "");
    return base === "mapinfo" || base === "zmapinfo" ||
      base.startsWith("mapinfo.") || base.startsWith("zmapinfo.");
  });
  if (mapInfoEntry) {
    const text = strFromU8(mapInfoEntry[1]);
    const m = text.match(MAPINFO_MAP_NAME_RE);
    if (m) firstMapTitle = m[1];
  }

  // idgames-format text files shipped inside the PK3 root/+1 level deep.
  // These reliably carry Title/Authors/Release-date when present (Beautiful
  // Doom, game_support.pk3, etc.). Scan them in order and take first hit per
  // field.
  for (const [path, payload] of Object.entries(entries)) {
    const depth = path.split("/").length - 1;
    if (depth > 1) continue;
    const base = path.toLowerCase().split("/").pop() ?? "";
    if (!/\.(txt|md|nfo)$/i.test(base)) continue;
    const text = strFromU8(payload);
    const parsed = parseInfoText(text);
    if (!author && parsed.author) author = parsed.author;
    if (!year && parsed.year) year = parsed.year;
    if (!firstMapTitle && parsed.title) firstMapTitle = parsed.title;
    if (author && year && firstMapTitle) break;
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
  };
}

function decodeLump(data: Uint8Array, offset: number, size: number): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(offset, offset + size));
}

// Pulls Title / Authors / Date from an idgames-style .txt or a free-form
// README. Tolerant of variant spellings (Author vs Authors, Release date vs
// Date). Year is the last 4-digit year mentioned in the date string (covers
// "12.06.2020", "2020-07-03", "Jan 5, 2003", and "1994").
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
