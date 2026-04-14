import { ref } from "vue";
import { readDir, readTextFile, writeTextFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { isNotFoundError } from "../lib/errors";
import {
  PlaySessionSchema,
  SKILL_FROM_NUMBER,
  type PlaySession,
  type LevelPlayStats,
  type SkillLevel,
} from "../lib/statsSchema";
import { parseSaveFile } from "../lib/saveParser";
import { useLibrary } from "./useLibrary";

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
export function parseLevelNameFromComment(comment: string): { id: string; name: string } | null {
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

  // Load or create level names mapping for a WAD
  async function loadLevelNames(statsDir: string): Promise<Map<string, string>> {
    const filepath = `${statsDir}/level-names.json`;
    try {
      if (await exists(filepath)) {
        const content = await readTextFile(filepath);
        const data = JSON.parse(content) as Record<string, string>;
        return new Map(Object.entries(data));
      }
    } catch {
      // Ignore errors, return empty map
    }
    return new Map();
  }

  // Save level names mapping
  async function saveLevelNames(statsDir: string, names: Map<string, string>): Promise<void> {
    const filepath = `${statsDir}/level-names.json`;
    const data = Object.fromEntries(names);
    await writeTextFile(filepath, JSON.stringify(data, null, 2));
  }

  // Parse a single .zds save file and extract session data
  async function parseSaveForStats(
    savePath: string,
    saveFileName: string
  ): Promise<Omit<PlaySession, "capturedAt"> | null> {
    const parsed = await parseSaveFile(savePath);
    if (!parsed || parsed.levels.length === 0) return null;

    const skill: SkillLevel = SKILL_FROM_NUMBER[parsed.skill] ?? "HMP";

    // Extract level name from info.json Comment if available
    const levelNameMap = new Map<string, string>();
    if (parsed.infoComment) {
      const nameInfo = parseLevelNameFromComment(parsed.infoComment);
      if (nameInfo) {
        levelNameMap.set(nameInfo.id, nameInfo.name);
      }
    }

    const levels: LevelPlayStats[] = parsed.levels.map((level) => {
      const id = level.levelname.toUpperCase();
      return {
        id,
        name: levelNameMap.get(id) ?? id,
        kills: level.killcount,
        totalKills: level.totalkills,
        items: level.itemcount,
        totalItems: level.totalitems,
        secrets: level.secretcount,
        totalSecrets: level.totalsecrets,
        timeTics: level.leveltime,
      };
    });

    // Extract slug from path (assumes path ends with /saves/{slug}/filename.zds)
    const pathParts = savePath.split("/");
    const slugIndex = pathParts.indexOf("saves") + 1;
    const wadSlug = slugIndex > 0 ? pathParts[slugIndex] : "unknown";

    return {
      schemaVersion: 1,
      wadSlug,
      startLevel: parsed.startLevel.toUpperCase(),
      skill,
      sourceFile: saveFileName,
      levels,
    };
  }

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

    // Ensure stats directory exists
    try {
      await mkdir(statsDirPath, { recursive: true });
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`Error creating stats dir for ${slug}:`, e);
        return 0;
      }
    }

    // Load existing level names mapping
    const levelNames = await loadLevelNames(statsDirPath);
    let levelNamesUpdated = false;

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
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch (e) {
      console.error(`Error reading saves dir for ${slug}:`, e);
      return 0;
    }

    let capturedCount = 0;

    // Process each save file
    for (const save of saveFiles) {
      const savePath = `${savesDirPath}/${save.name}`;
      const session = await parseSaveForStats(savePath, save.name);

      if (!session) continue;

      // Accumulate any new level names we discovered
      for (const level of session.levels) {
        if (level.name !== level.id && !levelNames.has(level.id)) {
          levelNames.set(level.id, level.name);
          levelNamesUpdated = true;
        }
      }

      // Apply known level names to session
      for (const level of session.levels) {
        if (level.name === level.id && levelNames.has(level.id)) {
          level.name = levelNames.get(level.id)!;
        }
      }

      // Generate content-based hash for deduplication
      const hash = generateSessionHash(session);

      // Check if we already have a session with identical content
      if (await sessionHashExists(statsDirPath, hash)) {
        continue;
      }

      // Use save file mtime as timestamp for display
      const timestamp = save.mtime.toISOString();

      // Write new session file using hash as filename
      const fullSession: PlaySession = {
        ...session,
        capturedAt: timestamp,
      };

      const filename = `${hash}.json`;
      const filepath = `${statsDirPath}/${filename}`;

      try {
        await writeTextFile(filepath, JSON.stringify(fullSession, null, 2));
        capturedCount++;
        console.log(`[Stats] Captured session from ${save.name} → ${filename}`);
      } catch (e) {
        console.error(`Error writing stats file ${filepath}:`, e);
      }
    }

    // Save updated level names if changed
    if (levelNamesUpdated) {
      try {
        await saveLevelNames(statsDirPath, levelNames);
        console.log(`[Stats] Updated level names for ${slug}`);
      } catch (e) {
        console.error(`Error saving level names for ${slug}:`, e);
      }
    }

    return capturedCount;
  }

  // Load all play sessions for a WAD
  async function loadAllSessions(slug: string): Promise<PlaySession[]> {
    const statsDirPath = statsDir(slug);

    try {
      if (!(await exists(statsDirPath))) {
        return [];
      }
    } catch {
      return [];
    }

    // Load level names mapping
    const levelNames = await loadLevelNames(statsDirPath);

    let files: string[];
    try {
      const entries = await readDir(statsDirPath);
      files = entries
        .filter((e) => e.name?.endsWith(".json") && e.name !== "level-names.json")
        .map((e) => e.name!)
        .sort(); // Chronological order by filename
    } catch {
      return [];
    }

    const sessions: PlaySession[] = [];

    for (const filename of files) {
      try {
        const content = await readTextFile(`${statsDirPath}/${filename}`);
        const parsed = PlaySessionSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          const session = parsed.data;
          // Apply known level names
          for (const level of session.levels) {
            if (level.name === level.id && levelNames.has(level.id)) {
              level.name = levelNames.get(level.id)!;
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
