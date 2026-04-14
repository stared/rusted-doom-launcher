import { ref } from "vue";
import { exists, readDir, stat } from "@tauri-apps/plugin-fs";
import { useSettings } from "./useSettings";
import { parseSaveFile } from "../lib/saveParser";

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

  function getSaveDir(slug: string): string {
    return `${settings.value.libraryPath}/saves/${slug}`;
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
      const saveDir = getSaveDir(slug);

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
          const fileStat = await stat(`${saveDir}/${save.name}`);
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
        const parsed = await parseSaveFile(`${saveDir}/${saveName}`);
        if (!parsed) continue;

        for (const level of parsed.levels) {
          const key = `${level.levelname.toUpperCase()}_${parsed.skill}`;
          const existing = levelMap.get(key);

          if (!existing) {
            levelMap.set(key, { ...level, skill: parsed.skill });
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
              skill: parsed.skill,
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
