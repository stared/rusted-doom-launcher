/**
 * WAD file parser for extracting level names.
 *
 * WAD files can contain level names in several lumps:
 * - MAPINFO: ZDoom/GZDoom format with `map MAP01 "Level Name" { ... }`
 * - EMAPINFO: Alternative format with `[MAP01] levelname = MAP01: Level Name`
 * - ZMAPINFO: Extended ZDoom format (similar to MAPINFO)
 * - UMAPINFO: Universal MAPINFO (Boom-compatible)
 */

import { invoke } from "@tauri-apps/api/core";

interface WadLump {
  name: string;
  offset: number;
  size: number;
}

async function readRange(path: string, offset: number, len: number): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file_range", { path, offset, len }));
}

/** Parse lump entries out of raw WAD directory bytes (numLumps × 16). */
function parseDirectory(dir: Uint8Array, numLumps: number): WadLump[] {
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: WadLump[] = [];
  for (let i = 0; i < numLumps; i++) {
    const entryOffset = i * 16;
    if (entryOffset + 16 > dir.length) break;

    const offset = view.getUint32(entryOffset, true);
    const size = view.getUint32(entryOffset + 4, true);

    // Read 8-byte name, strip null bytes
    let name = "";
    for (let j = 0; j < 8; j++) {
      const char = dir[entryOffset + 8 + j];
      if (char === 0) break;
      name += String.fromCharCode(char);
    }

    entries.push({ name, offset, size });
  }
  return entries;
}

/**
 * Parse MAPINFO/ZMAPINFO format.
 * Format: map MAP01 "Level Name" { ... }
 */
function parseMapinfo(content: string): Map<string, string> {
  const levels = new Map<string, string>();

  // Pattern: map MAP01 "Level Name"
  const pattern = /map\s+(\w+)\s+"([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const mapId = match[1].toUpperCase();
    const levelName = match[2];
    levels.set(mapId, levelName);
  }

  return levels;
}

/**
 * Parse EMAPINFO format.
 * Format:
 * [MAP01]
 * levelname = MAP01: Level Name
 */
function parseEmapinfo(content: string): Map<string, string> {
  const levels = new Map<string, string>();
  let currentMap: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Check for [MAP01] section header
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentMap = sectionMatch[1].toUpperCase();
      continue;
    }

    // Check for levelname = value
    if (currentMap) {
      const nameMatch = trimmed.match(/^levelname\s*=\s*(.+)/i);
      if (nameMatch) {
        let levelName = nameMatch[1].trim();
        // Remove MAP01: prefix if present
        const prefixPattern = new RegExp(`^${currentMap}:\\s*`, "i");
        levelName = levelName.replace(prefixPattern, "");
        levels.set(currentMap, levelName);
      }
    }
  }

  return levels;
}

/**
 * Parse UMAPINFO format.
 * Format:
 * MAP MAP01
 * {
 *     levelname = "Level Name"
 * }
 */
function parseUmapinfo(content: string): Map<string, string> {
  const levels = new Map<string, string>();
  let currentMap: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Check for MAP MAP01
    const mapMatch = trimmed.match(/^MAP\s+(\w+)/i);
    if (mapMatch) {
      currentMap = mapMatch[1].toUpperCase();
      continue;
    }

    // Check for levelname = "value" or levelname = value
    if (currentMap) {
      const nameMatch = trimmed.match(/^levelname\s*=\s*"?([^"]+)"?/i);
      if (nameMatch) {
        const levelName = nameMatch[1].trim();
        levels.set(currentMap, levelName);
      }
    }
  }

  return levels;
}

/**
 * Parse level names from raw MAPINFO/ZMAPINFO/EMAPINFO/UMAPINFO content.
 * Use this when you have the lump content already (e.g. from a ZIP/PK3).
 */
export function parseLevelNamesFromContent(lumpName: string, content: string): Map<string, string> {
  const upper = lumpName.toUpperCase();
  if (upper === "EMAPINFO") return parseEmapinfo(content);
  if (upper === "UMAPINFO") return parseUmapinfo(content);
  return parseMapinfo(content);
}

/**
 * Extract level names from a WAD file path.
 * Returns a Map of map ID (e.g., "MAP01") to level name.
 *
 * Reads only what it parses — header, directory and MAPINFO-family lumps
 * via byte ranges — so a 100+ MB megawad never transits the webview whole.
 */
export async function extractLevelNames(wadPath: string): Promise<Map<string, string>> {
  const header = await readRange(wadPath, 0, 12);
  const magic = String.fromCharCode(...header.slice(0, 4));
  if (magic !== "IWAD" && magic !== "PWAD") {
    throw new Error(`Invalid WAD magic: ${magic}`);
  }
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const numLumps = headerView.getUint32(4, true);
  const dirOffset = headerView.getUint32(8, true);

  const entries = parseDirectory(await readRange(wadPath, dirOffset, numLumps * 16), numLumps);
  const levels = new Map<string, string>();
  const mapinfoLumps = ["MAPINFO", "ZMAPINFO", "EMAPINFO", "UMAPINFO"];

  for (const entry of entries) {
    if (mapinfoLumps.includes(entry.name.toUpperCase()) && entry.size > 0) {
      try {
        const content = new TextDecoder("utf-8").decode(
          await readRange(wadPath, entry.offset, entry.size)
        );
        const parsed = parseLevelNamesFromContent(entry.name, content);
        for (const [mapId, levelName] of parsed) {
          if (!levels.has(mapId)) {
            levels.set(mapId, levelName);
          }
        }
      } catch (e) {
        console.warn(`Failed to parse ${entry.name}:`, e);
      }
    }
  }

  return levels;
}
