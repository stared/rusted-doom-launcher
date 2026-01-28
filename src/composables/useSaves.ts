import { ref } from "vue";
import { join } from "@tauri-apps/api/path";
import { exists, readDir, readFile, stat } from "@tauri-apps/plugin-fs";
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
  skill: number; // 0-4, skill level this was played on
}

// GZDoom skill levels
export const SKILL_NAMES = [
  "I'm too young to die",
  "Hey, not too rough",
  "Hurt me plenty",
  "Ultra-Violence",
  "Nightmare",
] as const;

export interface WadSaveInfo {
  slug: string;
  saveCount: number;
  mapsPlayed: number;
  lastPlayed: Date | null;
  levels: LevelStats[]; // Per-level stats, one entry per level+skill combination
}

// Singleton state - cache save info per slug
const saveInfoCache = ref<Map<string, WadSaveInfo>>(new Map());

export function useSaves() {
  const { settings } = useSettings();

  async function getSaveDir(slug: string): Promise<string> {
    return join(settings.value.libraryPath, "saves", slug);
  }

  async function getSaveInfo(slug: string): Promise<WadSaveInfo | null> {
    // Check cache first
    if (saveInfoCache.value.has(slug)) {
      return saveInfoCache.value.get(slug)!;
    }

    // Skip if settings not initialized yet (prevents permission errors on startup)
    if (!settings.value.libraryPath) {
      return null;
    }

    try {
      const saveDir = await getSaveDir(slug);

      // No save directory = no saves
      if (!(await exists(saveDir))) {
        return null;
      }

      const entries = await readDir(saveDir);
      const saveFiles = entries.filter(e => e.name?.endsWith(".zds"));

      if (saveFiles.length === 0) {
        return null;
      }

      // Get last modified date from most recent save
      let lastPlayed: Date | null = null;
      for (const save of saveFiles) {
        try {
          const savePath = await join(saveDir, save.name!);
          const fileStat = await stat(savePath);
          const mtime = fileStat.mtime ? new Date(fileStat.mtime) : null;
          if (mtime && (!lastPlayed || mtime > lastPlayed)) {
            lastPlayed = mtime;
          }
        } catch (e) {
          console.error(`Error getting stats for save ${save.name}:`, e);
        }
      }

      // Parse all saves to collect level stats (keep each level+skill combo)
      const levels = await collectLevelStats(saveDir, saveFiles.map(s => s.name!));

      // Count unique maps (regardless of skill)
      const uniqueMaps = new Set(levels.map(l => l.levelname.toUpperCase()));

      const info: WadSaveInfo = {
        slug,
        saveCount: saveFiles.length,
        mapsPlayed: uniqueMaps.size,
        lastPlayed,
        levels,
      };

      saveInfoCache.value.set(slug, info);
      return info;
    } catch (e) {
      console.error(`Error getting save info for ${slug}:`, e);
      return null;
    }
  }

  async function collectLevelStats(saveDir: string, saveNames: string[]): Promise<LevelStats[]> {
    // Key by levelname+skill to keep separate entries for each difficulty
    const levelMap = new Map<string, LevelStats>();

    for (const saveName of saveNames) {
      try {
        const savePath = await join(saveDir, saveName);
        const { levels } = await parseSaveFile(savePath);

        for (const level of levels) {
          const key = `${level.levelname.toUpperCase()}_${level.skill}`;
          const existing = levelMap.get(key);

          if (!existing) {
            levelMap.set(key, level);
          } else {
            // Same level+skill: keep best stats
            levelMap.set(key, {
              levelname: level.levelname,
              killcount: Math.max(existing.killcount, level.killcount),
              totalkills: level.totalkills,
              secretcount: Math.max(existing.secretcount, level.secretcount),
              totalsecrets: level.totalsecrets,
              itemcount: Math.max(existing.itemcount, level.itemcount),
              totalitems: level.totalitems,
              leveltime: Math.min(existing.leveltime, level.leveltime),
              skill: level.skill,
            });
          }
        }
      } catch (e) {
        console.error(`Failed to parse save file ${saveName}:`, e);
      }
    }

    // Sort by level name, then by skill
    return Array.from(levelMap.values()).sort((a, b) => {
      const nameCompare = a.levelname.localeCompare(b.levelname, undefined, { numeric: true });
      if (nameCompare !== 0) return nameCompare;
      return a.skill - b.skill;
    });
  }

  async function parseSaveFile(path: string): Promise<{ levels: LevelStats[]; skill: number }> {
    const data = await readFile(path);
    const uint8 = new Uint8Array(data);

    try {
      // .zds files are ZIP archives in modern GZDoom
      const unzipped = unzipSync(uint8);

      // Look for globals.json which contains statistics
      const globalsEntry = unzipped["globals.json"];
      if (!globalsEntry) {
        return { levels: [], skill: 2 };
      }

      const globalsJson = strFromU8(globalsEntry);
      const globals = JSON.parse(globalsJson);

      // Extract skill level from servercvars.skill
      const skill = Number(globals?.servercvars?.skill ?? 2);

      // Extract level stats from statistics.levels
      const statsLevels = globals?.statistics?.levels;
      if (!Array.isArray(statsLevels)) {
        return { levels: [], skill };
      }

      const levels = statsLevels.map((level: Record<string, unknown>) => ({
        levelname: String(level.levelname || ""),
        killcount: Number(level.killcount || 0),
        totalkills: Number(level.totalkills || 0),
        secretcount: Number(level.secretcount || 0),
        totalsecrets: Number(level.totalsecrets || 0),
        itemcount: Number(level.itemcount || 0),
        totalitems: Number(level.totalitems || 0),
        leveltime: Number(level.leveltime || 0),
        skill,
      }));

      return { levels, skill };
    } catch (e) {
      // Not a valid ZIP or JSON - might be old binary format
      console.warn(`Save file ${path} couldn't be parsed (may be old binary format):`, e);
      return { levels: [], skill: 2 };
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
