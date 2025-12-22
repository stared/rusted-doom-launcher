import { readDir, readFile, readTextFile, writeTextFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { unzipSync, strFromU8 } from "fflate";
import { useSettings } from "./useSettings";
import { isNotFoundError } from "../lib/errors";
import {
  PlaySessionSchema,
  SKILL_FROM_NUMBER,
  type PlaySession,
  type LevelPlayStats,
  type SkillLevel,
} from "../lib/statsSchema";

// Parse level name from GZDoom info.json Comment field
// Format: "MAP13 - Polychromatic Terrace" or "E1M1 - Hangar"
export function parseLevelNameFromComment(comment: string): { id: string; name: string } | null {
  const match = comment.match(/^(MAP\d+|E\d+M\d+)\s*-\s*(.+)$/i);
  if (match) {
    return { id: match[1].toUpperCase(), name: match[2].trim() };
  }
  return null;
}

// Sanitize ISO timestamp for use as filename (replace colons)
function sanitizeTimestamp(isoString: string): string {
  return isoString.replace(/:/g, "-");
}

export function useStats() {
  const { getLibraryPath } = useSettings();

  async function getStatsDir(slug: string): Promise<string> {
    const libraryPath = await getLibraryPath();
    return `${libraryPath}/stats/${slug}`;
  }

  async function getSavesDir(slug: string): Promise<string> {
    const libraryPath = await getLibraryPath();
    return `${libraryPath}/saves/${slug}`;
  }

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
    try {
      const data = await readFile(savePath);
      const uint8 = new Uint8Array(data);
      const unzipped = unzipSync(uint8);

      // Parse globals.json for statistics
      const globalsEntry = unzipped["globals.json"];
      if (!globalsEntry) return null;

      const globals = JSON.parse(strFromU8(globalsEntry));
      const statsLevels = globals?.statistics?.levels;
      if (!Array.isArray(statsLevels) || statsLevels.length === 0) return null;

      // Get skill level
      const skillNum = Number(globals?.servercvars?.skill ?? 2);
      const skill: SkillLevel = SKILL_FROM_NUMBER[skillNum] ?? "HMP";

      // Get start level
      const startLevel = String(globals?.statistics?.startlevel ?? statsLevels[0]?.levelname ?? "MAP01");

      // Parse info.json for level names
      const infoEntry = unzipped["info.json"];
      let levelNameMap: Map<string, string> = new Map();

      if (infoEntry) {
        try {
          const info = JSON.parse(strFromU8(infoEntry));
          // Current map name is in Comment field: "MAP13 - Polychromatic Terrace"
          const parsed = parseLevelNameFromComment(info.Comment ?? "");
          if (parsed) {
            levelNameMap.set(parsed.id, parsed.name);
          }
        } catch {
          // Ignore info.json parse errors
        }
      }

      // Build levels array
      const levels: LevelPlayStats[] = statsLevels.map((level: Record<string, unknown>) => {
        const id = String(level.levelname ?? "").toUpperCase();
        return {
          id,
          name: levelNameMap.get(id) ?? id, // Fallback to ID if name unknown
          kills: Number(level.killcount ?? 0),
          totalKills: Number(level.totalkills ?? 0),
          items: Number(level.itemcount ?? 0),
          totalItems: Number(level.totalitems ?? 0),
          secrets: Number(level.secretcount ?? 0),
          totalSecrets: Number(level.totalsecrets ?? 0),
          timeTics: Number(level.leveltime ?? 0),
        };
      });

      // Extract slug from path (assumes path ends with /saves/{slug}/filename.zds)
      const pathParts = savePath.split("/");
      const slugIndex = pathParts.indexOf("saves") + 1;
      const wadSlug = slugIndex > 0 ? pathParts[slugIndex] : "unknown";

      return {
        schemaVersion: 1,
        wadSlug,
        startLevel: startLevel.toUpperCase(),
        skill,
        sourceFile: saveFileName,
        levels,
      };
    } catch (e) {
      console.error(`Failed to parse save file ${savePath}:`, e);
      return null;
    }
  }

  // Check if a session file with similar content already exists
  async function sessionExists(
    statsDir: string,
    session: Omit<PlaySession, "capturedAt">,
    timestamp: string
  ): Promise<boolean> {
    const filename = `${sanitizeTimestamp(timestamp)}.json`;
    const filepath = `${statsDir}/${filename}`;

    try {
      if (!(await exists(filepath))) return false;

      const content = await readTextFile(filepath);
      const existing = JSON.parse(content);

      // Compare key fields to detect duplicates
      return (
        existing.sourceFile === session.sourceFile &&
        existing.levels?.length === session.levels.length &&
        existing.startLevel === session.startLevel &&
        existing.skill === session.skill
      );
    } catch {
      return false;
    }
  }

  // Capture stats from all save files for a WAD
  async function captureStats(slug: string): Promise<number> {
    const savesDir = await getSavesDir(slug);
    const statsDir = await getStatsDir(slug);

    // Check if saves directory exists
    try {
      if (!(await exists(savesDir))) {
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
      await mkdir(statsDir, { recursive: true });
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`Error creating stats dir for ${slug}:`, e);
        return 0;
      }
    }

    // Load existing level names mapping
    const levelNames = await loadLevelNames(statsDir);
    let levelNamesUpdated = false;

    // Read all save files
    let saveFiles: { name: string; mtime: Date }[];
    try {
      const entries = await readDir(savesDir);
      saveFiles = [];

      for (const entry of entries) {
        if (entry.name?.endsWith(".zds")) {
          try {
            const fileStat = await stat(`${savesDir}/${entry.name}`);
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
      const savePath = `${savesDir}/${save.name}`;
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

      // Use save file mtime as timestamp
      const timestamp = save.mtime.toISOString();

      // Check if we already have this session
      if (await sessionExists(statsDir, session, timestamp)) {
        continue;
      }

      // Write new session file
      const fullSession: PlaySession = {
        ...session,
        capturedAt: timestamp,
      };

      const filename = `${sanitizeTimestamp(timestamp)}.json`;
      const filepath = `${statsDir}/${filename}`;

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
        await saveLevelNames(statsDir, levelNames);
        console.log(`[Stats] Updated level names for ${slug}`);
      } catch (e) {
        console.error(`Error saving level names for ${slug}:`, e);
      }
    }

    return capturedCount;
  }

  // Load all play sessions for a WAD
  async function loadAllSessions(slug: string): Promise<PlaySession[]> {
    const statsDir = await getStatsDir(slug);

    try {
      if (!(await exists(statsDir))) {
        return [];
      }
    } catch {
      return [];
    }

    // Load level names mapping
    const levelNames = await loadLevelNames(statsDir);

    let files: string[];
    try {
      const entries = await readDir(statsDir);
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
        const content = await readTextFile(`${statsDir}/${filename}`);
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

  // Get aggregated stats for display (best run per level+skill combo)
  async function getAggregatedStats(slug: string): Promise<Map<string, LevelPlayStats>> {
    const sessions = await loadAllSessions(slug);
    const bestByLevelSkill = new Map<string, LevelPlayStats & { skill: SkillLevel }>();

    for (const session of sessions) {
      for (const level of session.levels) {
        const key = `${level.id}_${session.skill}`;
        const existing = bestByLevelSkill.get(key);

        // Keep the run with most kills (or fastest time if kills equal)
        if (
          !existing ||
          level.kills > existing.kills ||
          (level.kills === existing.kills && level.timeTics < existing.timeTics)
        ) {
          bestByLevelSkill.set(key, { ...level, skill: session.skill });
        }
      }
    }

    return bestByLevelSkill as Map<string, LevelPlayStats>;
  }

  // Count unique levels played across all sessions
  async function getUniqueLevelsPlayed(slug: string): Promise<number> {
    const sessions = await loadAllSessions(slug);
    const uniqueLevels = new Set<string>();

    for (const session of sessions) {
      for (const level of session.levels) {
        uniqueLevels.add(level.id);
      }
    }

    return uniqueLevels.size;
  }

  return {
    captureStats,
    loadAllSessions,
    getAggregatedStats,
    getUniqueLevelsPlayed,
    getStatsDir,
  };
}
