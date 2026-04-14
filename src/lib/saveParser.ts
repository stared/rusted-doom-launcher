/**
 * Shared parser for GZDoom .zds save files.
 * Both useSaves and useStats need to parse the same ZIP→JSON structure.
 */

import { readFile } from "@tauri-apps/plugin-fs";
import { unzipSync, strFromU8 } from "fflate";

/** Raw level stats as stored in globals.json */
export interface RawLevelStats {
  levelname: string;
  killcount: number;
  totalkills: number;
  secretcount: number;
  totalsecrets: number;
  itemcount: number;
  totalitems: number;
  leveltime: number;
}

/** Result of parsing a .zds save file */
export interface ParsedSave {
  skill: number;
  startLevel: string;
  levels: RawLevelStats[];
  /** Level name from info.json Comment field, if available */
  infoComment: string | null;
}

/**
 * Parse a .zds save file and extract skill, levels, and metadata.
 * Returns null if the file can't be parsed (old binary format, corrupt, etc).
 */
export async function parseSaveFile(path: string): Promise<ParsedSave | null> {
  try {
    const data = await readFile(path);
    const unzipped = unzipSync(new Uint8Array(data));

    const globalsEntry = unzipped["globals.json"];
    if (!globalsEntry) return null;

    const globals = JSON.parse(strFromU8(globalsEntry));
    const skill = Number(globals?.servercvars?.skill ?? 2);
    const statsLevels = globals?.statistics?.levels;

    if (!Array.isArray(statsLevels)) {
      return { skill, startLevel: "MAP01", levels: [], infoComment: null };
    }

    const startLevel = String(
      globals?.statistics?.startlevel ?? statsLevels[0]?.levelname ?? "MAP01"
    );

    const levels: RawLevelStats[] = statsLevels.map((level: Record<string, unknown>) => ({
      levelname: String(level.levelname || ""),
      killcount: Number(level.killcount || 0),
      totalkills: Number(level.totalkills || 0),
      secretcount: Number(level.secretcount || 0),
      totalsecrets: Number(level.totalsecrets || 0),
      itemcount: Number(level.itemcount || 0),
      totalitems: Number(level.totalitems || 0),
      leveltime: Number(level.leveltime || 0),
    }));

    // Extract level name from info.json Comment field if available
    let infoComment: string | null = null;
    const infoEntry = unzipped["info.json"];
    if (infoEntry) {
      try {
        const info = JSON.parse(strFromU8(infoEntry));
        infoComment = info.Comment ?? null;
      } catch {
        // Ignore info.json parse errors
      }
    }

    return { skill, startLevel, levels, infoComment };
  } catch (e) {
    console.warn(`Save file ${path} couldn't be parsed (may be old binary format):`, e);
    return null;
  }
}
