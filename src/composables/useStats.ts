import { ref } from "vue";
import { readDir, readTextFile, writeTextFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { isExistsError, isNotFoundError } from "../lib/errors";
import {
  PlaySessionSchema,
  SKILL_FROM_NUMBER,
  type PlaySession,
  type LevelPlayStats,
  type SkillLevel,
} from "../lib/statsSchema";
import { parseSaveFile } from "../lib/saveParser";
import { useLibrary } from "./useLibrary";
import { useLevelNames } from "./useLevelNames";

/** Aggregated level stats with skill from session. */
export interface AggregatedLevel extends LevelPlayStats {
  skill: SkillLevel;
}

/** Summary of all play data for a WAD. */
export interface WadPlaySummary {
  slug: string;
  sessionCount: number;
  mapsPlayed: number;
  lastPlayed: Date | null;
  levels: AggregatedLevel[];
}

// Singleton cache
const summaryCache = ref<Map<string, WadPlaySummary>>(new Map());

// Parse level name from GZDoom info.json Comment field
// Format: "MAP13 - Polychromatic Terrace" or "E1M1 - Hangar"
function parseLevelNameFromComment(comment: string): { id: string; name: string } | null {
  const match = comment.match(/^(MAP\d+|E\d+M\d+)\s*-\s*(.+)$/i);
  if (match) {
    return { id: match[1].toUpperCase(), name: match[2].trim() };
  }
  return null;
}

// Generate a content-based hash for session deduplication
// This identifies unique gameplay states regardless of which save file they came from
function generateSessionHash(session: Omit<PlaySession, "capturedAt">): string {
  // Create a deterministic string from gameplay data only
  const payload = {
    wad: session.wadSlug,
    skill: session.skill,
    start: session.startLevel,
    // Include all level stats that define the gameplay state
    levels: session.levels.map(l => ({
      id: l.id,
      k: l.kills,
      tk: l.totalKills,
      i: l.items,
      ti: l.totalItems,
      s: l.secrets,
      ts: l.totalSecrets,
      t: l.timeTics,
    })),
  };

  // Simple hash function (djb2)
  const str = JSON.stringify(payload);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0; // Convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

export function useStats() {
  const { statsDir, savesDir } = useLibrary();
  const { getCachedLevelNames, loadLevelNames, mergeLevelNames } = useLevelNames();

  // Check if a session with this content hash already exists
  async function sessionHashExists(statsDir: string, hash: string): Promise<boolean> {
    const filepath = `${statsDir}/${hash}.json`;
    try {
      return await exists(filepath);
    } catch {
      return false;
    }
  }

  // Capture stats from all save files for a WAD
  async function captureStats(slug: string): Promise<number> {
    const savesDirPath = savesDir(slug);
    const statsDirPath = statsDir(slug);

    // Check if saves directory exists
    try {
      if (!(await exists(savesDirPath))) {
        return 0;
      }
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`Error checking saves dir for ${slug}:`, e);
      }
      return 0;
    }

    // Ensure stats directory exists ("already exists" is the only acceptable failure)
    try {
      await mkdir(statsDirPath, { recursive: true });
    } catch (e) {
      if (!isExistsError(e)) {
        console.error(`Error creating stats dir for ${slug}:`, e);
        return 0;
      }
    }

    // Read all save files
    let saveFiles: { name: string; mtime: Date }[];
    try {
      const entries = await readDir(savesDirPath);
      saveFiles = [];
      for (const entry of entries) {
        if (entry.name?.endsWith(".zds")) {
          try {
            const fileStat = await stat(`${savesDirPath}/${entry.name}`);
            const mtime = fileStat.mtime ? new Date(fileStat.mtime) : new Date();
            saveFiles.push({ name: entry.name, mtime });
          } catch { /* Skip files we can't stat */ }
        }
      }
    } catch (e) {
      console.error(`Error reading saves dir for ${slug}:`, e);
      return 0;
    }

    let capturedCount = 0;
    const discoveredNames = new Map<string, string>();

    for (const save of saveFiles) {
      const savePath = `${savesDirPath}/${save.name}`;
      const parsed = await parseSaveFile(savePath);
      if (!parsed || parsed.levels.length === 0) continue;

      const skill: SkillLevel = SKILL_FROM_NUMBER[parsed.skill] ?? "HMP";

      // Collect level name from save file Comment for the central store
      if (parsed.infoComment) {
        const nameInfo = parseLevelNameFromComment(parsed.infoComment);
        if (nameInfo) discoveredNames.set(nameInfo.id, nameInfo.name);
      }

      // Session stores raw IDs as names; display names applied at read time
      const levels: LevelPlayStats[] = parsed.levels.map((level) => ({
        id: level.levelname.toUpperCase(),
        name: level.levelname.toUpperCase(),
        kills: level.killcount,
        totalKills: level.totalkills,
        items: level.itemcount,
        totalItems: level.totalitems,
        secrets: level.secretcount,
        totalSecrets: level.totalsecrets,
        timeTics: level.leveltime,
      }));

      const session: Omit<PlaySession, "capturedAt"> = {
        schemaVersion: 1,
        wadSlug: slug,
        startLevel: parsed.startLevel.toUpperCase(),
        skill,
        sourceFile: save.name,
        levels,
      };

      const hash = generateSessionHash(session);
      if (await sessionHashExists(statsDirPath, hash)) continue;

      const fullSession: PlaySession = { ...session, capturedAt: save.mtime.toISOString() };
      try {
        await writeTextFile(`${statsDirPath}/${hash}.json`, JSON.stringify(fullSession, null, 2));
        capturedCount++;
        console.log(`[Stats] Captured session from ${save.name} → ${hash}.json`);
      } catch (e) {
        console.error(`Error writing stats file:`, e);
      }
    }

    // Merge any discovered level names into the central store
    if (discoveredNames.size > 0) {
      await mergeLevelNames(slug, discoveredNames);
    }

    return capturedCount;
  }

  // Load all play sessions for a WAD
  async function loadAllSessions(slug: string): Promise<PlaySession[]> {
    const statsDirPath = statsDir(slug);

    try {
      if (!(await exists(statsDirPath))) return [];
    } catch {
      return [];
    }

    let files: string[];
    try {
      const entries = await readDir(statsDirPath);
      files = entries
        .filter((e) => e.name?.endsWith(".json"))
        .map((e) => e.name!)
        .sort();
    } catch {
      return [];
    }

    // Level names from central store (WAD MAPINFO + save file Comments)
    const levelNames = getCachedLevelNames(slug) ?? await loadLevelNames(slug);

    const sessions: PlaySession[] = [];
    for (const filename of files) {
      try {
        const content = await readTextFile(`${statsDirPath}/${filename}`);
        const parsed = PlaySessionSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          const session = parsed.data;
          // Apply display names from central level names store
          if (levelNames) {
            for (const level of session.levels) {
              if (level.name === level.id) {
                const name = levelNames.get(level.id);
                if (name) level.name = name;
              }
            }
          }
          sessions.push(session);
        } else {
          console.warn(`Invalid session file ${filename}:`, parsed.error.format());
        }
      } catch (e) {
        console.error(`Error reading session file ${filename}:`, e);
      }
    }

    return sessions;
  }

  /** Build a WadPlaySummary from sessions (best-per-level aggregation). */
  function buildSummary(slug: string, sessions: PlaySession[]): WadPlaySummary {
    // Best level stats per level+skill combo
    const bestByKey = new Map<string, AggregatedLevel>();
    for (const session of sessions) {
      for (const level of session.levels) {
        const key = `${level.id}_${session.skill}`;
        const existing = bestByKey.get(key);
        if (
          !existing ||
          level.kills > existing.kills ||
          (level.kills === existing.kills && level.timeTics < existing.timeTics)
        ) {
          bestByKey.set(key, { ...level, skill: session.skill });
        }
      }
    }

    const levels = Array.from(bestByKey.values()).sort((a, b) => {
      const nameCompare = a.id.localeCompare(b.id, undefined, { numeric: true });
      if (nameCompare !== 0) return nameCompare;
      return a.skill.localeCompare(b.skill);
    });

    const uniqueLevels = new Set(levels.map(l => l.id));
    const lastPlayed = sessions.length > 0
      ? new Date(Math.max(...sessions.map(s => new Date(s.capturedAt).getTime())))
      : null;

    return {
      slug,
      sessionCount: sessions.length,
      mapsPlayed: uniqueLevels.size,
      lastPlayed,
      levels,
    };
  }

  /** Load play summary for a WAD (cached). */
  async function getPlaySummary(slug: string): Promise<WadPlaySummary | null> {
    if (summaryCache.value.has(slug)) {
      return summaryCache.value.get(slug)!;
    }
    const sessions = await loadAllSessions(slug);
    if (sessions.length === 0) return null;
    const summary = buildSummary(slug, sessions);
    summaryCache.value.set(slug, summary);
    return summary;
  }

  function getCachedPlaySummary(slug: string): WadPlaySummary | null {
    return summaryCache.value.get(slug) ?? null;
  }

  async function loadAllPlaySummaries(slugs: string[]): Promise<void> {
    await Promise.all(slugs.map(slug => getPlaySummary(slug)));
  }

  async function refreshPlaySummary(slug: string): Promise<WadPlaySummary | null> {
    summaryCache.value.delete(slug);
    return getPlaySummary(slug);
  }

  return {
    captureStats,
    loadAllSessions,
    getCachedPlaySummary,
    loadAllPlaySummaries,
    refreshPlaySummary,
  };
}
