import { ref } from "vue";
import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
import { unzipSync, strFromU8 } from "fflate";
import { useSettings } from "./useSettings";

export interface LevelStats {
  levelname: string;
  killcount: number;
  totalkills: number;
  secretcount: number;
  totalsecrets: number;
  itemcount: number;
  totalitems: number;
  leveltime: number; // in tics (35 tics = 1 second)
}

export interface WadSaveInfo {
  slug: string;
  saveCount: number;
  mapsPlayed: number;
  lastPlayed: Date | null;
  levels: LevelStats[]; // Detailed per-level stats (best stats across all saves)
}

// Singleton state - cache save info per slug
const saveInfoCache = ref<Map<string, WadSaveInfo>>(new Map());

export function useSaves() {
  const { getLibraryPath } = useSettings();

  async function getSaveDir(slug: string): Promise<string> {
    const libraryPath = await getLibraryPath();
    return `${libraryPath}/saves/${slug}`;
  }

  async function getSaveInfo(slug: string): Promise<WadSaveInfo | null> {
    // Check cache first
    if (saveInfoCache.value.has(slug)) {
      return saveInfoCache.value.get(slug)!;
    }

    try {
      const saveDir = await getSaveDir(slug);
      const entries = await readDir(saveDir);
      const saveFiles = entries.filter(e => e.name?.endsWith(".zds"));

      if (saveFiles.length === 0) {
        return null;
      }

      // Get last modified date from most recent save
      let lastPlayed: Date | null = null;
      for (const save of saveFiles) {
        try {
          const fileStat = await stat(`${saveDir}/${save.name}`);
          const mtime = fileStat.mtime ? new Date(fileStat.mtime) : null;
          if (mtime && (!lastPlayed || mtime > lastPlayed)) {
            lastPlayed = mtime;
          }
        } catch { /* ignore stat errors */ }
      }

      // Parse all saves to find unique maps played and aggregate best stats
      const levels = await aggregateLevelStats(saveDir, saveFiles.map(s => s.name!));

      const info: WadSaveInfo = {
        slug,
        saveCount: saveFiles.length,
        mapsPlayed: levels.length,
        lastPlayed,
        levels,
      };

      saveInfoCache.value.set(slug, info);
      return info;
    } catch {
      // Save directory doesn't exist or is empty
      return null;
    }
  }

  async function aggregateLevelStats(saveDir: string, saveNames: string[]): Promise<LevelStats[]> {
    // Map of levelname -> best stats for that level
    const levelMap = new Map<string, LevelStats>();

    for (const saveName of saveNames) {
      try {
        const levels = await parseSaveFile(`${saveDir}/${saveName}`);
        for (const level of levels) {
          const key = level.levelname.toUpperCase();
          const existing = levelMap.get(key);

          if (!existing) {
            levelMap.set(key, level);
          } else {
            // Keep best stats (most kills, secrets, items; fastest time)
            levelMap.set(key, {
              levelname: level.levelname,
              killcount: Math.max(existing.killcount, level.killcount),
              totalkills: level.totalkills, // totals should be same
              secretcount: Math.max(existing.secretcount, level.secretcount),
              totalsecrets: level.totalsecrets,
              itemcount: Math.max(existing.itemcount, level.itemcount),
              totalitems: level.totalitems,
              leveltime: Math.min(existing.leveltime, level.leveltime), // fastest time
            });
          }
        }
      } catch {
        // Skip saves that can't be parsed
      }
    }

    // Sort levels by name (MAP01, MAP02, etc.)
    return Array.from(levelMap.values()).sort((a, b) =>
      a.levelname.localeCompare(b.levelname, undefined, { numeric: true })
    );
  }

  async function parseSaveFile(path: string): Promise<LevelStats[]> {
    const data = await readFile(path);
    const uint8 = new Uint8Array(data);

    try {
      // .zds files are ZIP archives in modern GZDoom
      const unzipped = unzipSync(uint8);

      // Look for globals.json which contains statistics
      const globalsEntry = unzipped["globals.json"];
      if (!globalsEntry) {
        return [];
      }

      const globalsJson = strFromU8(globalsEntry);
      const globals = JSON.parse(globalsJson);

      // Extract level stats from statistics.levels
      const levels = globals?.statistics?.levels;
      if (!Array.isArray(levels)) {
        return [];
      }

      return levels.map((level: Record<string, unknown>) => ({
        levelname: String(level.levelname || ""),
        killcount: Number(level.killcount || 0),
        totalkills: Number(level.totalkills || 0),
        secretcount: Number(level.secretcount || 0),
        totalsecrets: Number(level.totalsecrets || 0),
        itemcount: Number(level.itemcount || 0),
        totalitems: Number(level.totalitems || 0),
        leveltime: Number(level.leveltime || 0),
      }));
    } catch {
      // Not a valid ZIP or JSON - might be old binary format
      return [];
    }
  }

  async function loadAllSaveInfo(slugs: string[]): Promise<void> {
    // Load save info for all WADs in parallel
    await Promise.all(slugs.map(slug => getSaveInfo(slug)));
  }

  function getCachedSaveInfo(slug: string): WadSaveInfo | null {
    return saveInfoCache.value.get(slug) ?? null;
  }

  function clearCache(): void {
    saveInfoCache.value.clear();
  }

  // Refresh a single WAD's save info (e.g., after playing)
  async function refreshSaveInfo(slug: string): Promise<WadSaveInfo | null> {
    saveInfoCache.value.delete(slug);
    return getSaveInfo(slug);
  }

  return {
    getSaveInfo,
    loadAllSaveInfo,
    getCachedSaveInfo,
    refreshSaveInfo,
    clearCache,
  };
}
