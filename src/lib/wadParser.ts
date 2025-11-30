/**
 * WAD file parser for extracting level names.
 *
 * WAD files can contain level names in several lumps:
 * - MAPINFO: ZDoom/GZDoom format with `map MAP01 "Level Name" { ... }`
 * - EMAPINFO: Alternative format with `[MAP01] levelname = MAP01: Level Name`
 * - ZMAPINFO: Extended ZDoom format (similar to MAPINFO)
 * - UMAPINFO: Universal MAPINFO (Boom-compatible)
 */

import { readFile } from "@tauri-apps/plugin-fs";

interface WadEntry {
  name: string;
  offset: number;
  size: number;
}

/**
 * Parse WAD directory from raw data and return list of lump entries.
 */
function parseWadDirectory(data: Uint8Array): WadEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // WAD header: 4 bytes magic, 4 bytes num_lumps, 4 bytes dir_offset
  if (data.length < 12) {
    throw new Error("Invalid WAD file: too short");
  }

  const magic = String.fromCharCode(...data.slice(0, 4));
  if (magic !== "IWAD" && magic !== "PWAD") {
    throw new Error(`Invalid WAD magic: ${magic}`);
  }

  const numLumps = view.getUint32(4, true);
  const dirOffset = view.getUint32(8, true);

  const entries: WadEntry[] = [];
  for (let i = 0; i < numLumps; i++) {
    const entryOffset = dirOffset + i * 16;
    if (entryOffset + 16 > data.length) break;

    const offset = view.getUint32(entryOffset, true);
    const size = view.getUint32(entryOffset + 4, true);

    // Read 8-byte name, strip null bytes
    let name = "";
    for (let j = 0; j < 8; j++) {
      const char = data[entryOffset + 8 + j];
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
 * Extract level names from in-memory WAD data.
 * Returns a Map of map ID (e.g., "MAP01") to level name.
 */
export function extractLevelNamesFromData(data: Uint8Array): Map<string, string> {
  const entries = parseWadDirectory(data);
  const levels = new Map<string, string>();
  const mapinfoLumps = ["MAPINFO", "ZMAPINFO", "EMAPINFO", "UMAPINFO"];

  for (const entry of entries) {
    if (mapinfoLumps.includes(entry.name.toUpperCase()) && entry.size > 0) {
      try {
        const lumpData = data.slice(entry.offset, entry.offset + entry.size);
        const content = new TextDecoder("utf-8").decode(lumpData);

        const parsed =
          entry.name.toUpperCase() === "EMAPINFO" ? parseEmapinfo(content) :
          entry.name.toUpperCase() === "UMAPINFO" ? parseUmapinfo(content) :
          parseMapinfo(content);

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

/**
 * Extract level names from a WAD file path.
 * Returns a Map of map ID (e.g., "MAP01") to level name.
 */
export async function extractLevelNames(wadPath: string): Promise<Map<string, string>> {
  const data = await readFile(wadPath);
  return extractLevelNamesFromData(new Uint8Array(data));
}
