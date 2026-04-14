import { readDir, readTextFile, writeTextFile, mkdir, exists, stat } from "@tauri-apps/plugin-fs";
import { useSettings } from "./useSettings";
import { isNotFoundError } from "../lib/errors";
import {
  PlaySessionSchema,
  SKILL_FROM_NUMBER,
  type PlaySession,
  type LevelPlayStats,
  type SkillLevel,
} from "../lib/statsSchema";
import { parseSaveFile } from "../lib/saveParser";

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
  const { settings } = useSettings();

  function getStatsDir(slug: string): string {
    return `${settings.value.libraryPath}/stats/${slug}`;
  }

  function getSavesDir(slug: string): string {
    return `${settings.value.libraryPath}/saves/${slug}`;
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
    const savesDir = getSavesDir(slug);
    const statsDir = getStatsDir(slug);

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

      // Generate content-based hash for deduplication
      const hash = generateSessionHash(session);

      // Check if we already have a session with identical content
      if (await sessionHashExists(statsDir, hash)) {
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
    const statsDir = getStatsDir(slug);

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
