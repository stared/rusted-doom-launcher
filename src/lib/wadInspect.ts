import { unzipSync, strFromU8 } from "fflate";
import type { Iwad, WadEntry } from "./schema";

export interface FileInspection {
  format: "wad" | "pk3";
  isIwad: boolean;
  mapCount: number;
  mapNames: string[];
  firstMapTitle: string;
  author: string;
  hasGameplayCode: boolean;
  suggestedType: WadEntry["type"];
  suggestedIwad: Iwad;
}

const MAP_NAME_RE = /^(MAP\d{2}|E[1-9]M[1-9])$/;

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

  const mapInfoLump = lumps.find(l => l.name === "ZMAPINFO" || l.name === "MAPINFO");
  let firstMapTitle = "";
  let author = "";
  if (mapInfoLump) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      data.subarray(mapInfoLump.offset, mapInfoLump.offset + mapInfoLump.size)
    );
    const parsed = parseMapInfo(text);
    firstMapTitle = parsed.firstMapName;
    author = parsed.author;
  }

  return {
    format: "wad",
    isIwad: magic === "IWAD",
    mapCount: mapNames.length,
    mapNames,
    firstMapTitle,
    author,
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
  const mapInfoEntry = Object.entries(entries).find(([p]) => {
    const base = (p.toLowerCase().split("/").pop() ?? "");
    return base === "mapinfo" || base === "zmapinfo" ||
      base.startsWith("mapinfo.") || base.startsWith("zmapinfo.");
  });
  if (mapInfoEntry) {
    const text = strFromU8(mapInfoEntry[1]);
    const parsed = parseMapInfo(text);
    firstMapTitle = parsed.firstMapName;
    author = parsed.author;
  }

  return {
    format: "pk3",
    isIwad: false,
    mapCount: mapNames.length,
    mapNames,
    firstMapTitle,
    author,
    hasGameplayCode,
    suggestedType: suggestType(mapNames.length, hasGameplayCode),
    suggestedIwad: guessIwad(mapNames),
  };
}

// Loose MAPINFO parser. Handles both old format (`map MAP01 "Name"`) and new
// format (`map MAP01 "Name" { … Author = "…" … }`). Whitespace-tolerant, picks
// the first map block's name and the first Author = "…" assignment it sees.
function parseMapInfo(text: string): { firstMapName: string; author: string } {
  let firstMapName = "";
  let author = "";

  const mapMatch = text.match(/^\s*map\s+\S+\s+"([^"]+)"/im);
  if (mapMatch) firstMapName = mapMatch[1];

  if (!firstMapName) {
    const nameAssign = text.match(/^\s*name\s*=\s*"([^"]+)"/im);
    if (nameAssign) firstMapName = nameAssign[1];
  }

  const authorMatch = text.match(/^\s*Author\s*=\s*"([^"]+)"/im);
  if (authorMatch) author = authorMatch[1];

  return { firstMapName, author };
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
