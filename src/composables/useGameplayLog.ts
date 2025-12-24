import { readDir, readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { useSettings } from "./useSettings";
import { isNotFoundError } from "../lib/errors";
import {
  PATTERNS,
  GameplayLogSchema,
  type GameplayLog,
  type GameEvent,
  type LevelEnterEvent,
  type DeathEvent,
  type PickupEvent,
  type SecretEvent,
  type MessageEvent,
} from "../lib/gameplayLogSchema";
import type { SkillLevel } from "../lib/statsSchema";

// Re-export for convenience
export type { GameplayLog, GameEvent } from "../lib/gameplayLogSchema";
export { getDeathCount, getLevelsVisited, formatDuration } from "../lib/gameplayLogSchema";

// Sanitize ISO timestamp for use as filename (replace colons)
function sanitizeTimestamp(isoString: string): string {
  return isoString.replace(/:/g, "-");
}

export function useGameplayLog() {
  const { getLibraryPath } = useSettings();

  async function getSessionsDir(slug: string): Promise<string> {
    const libraryPath = await getLibraryPath();
    return `${libraryPath}/sessions/${slug}`;
  }

  /**
   * Parse a single log line into a GameEvent
   */
  function parseLogLine(text: string, time_ms: number): GameEvent {
    // Try level enter: "MAP16 - Leave Your Sol Behind"
    const levelMatch = text.match(PATTERNS.LEVEL_ENTER);
    if (levelMatch) {
      return {
        type: "level_enter",
        time_ms,
        text,
        mapId: levelMatch[1].toUpperCase(),
        mapName: levelMatch[2].trim(),
      } satisfies LevelEnterEvent;
    }

    // Try death: "Player was splayed by an imp."
    const deathMatch = text.match(PATTERNS.DEATH);
    if (deathMatch) {
      return {
        type: "death",
        time_ms,
        text,
        cause: deathMatch[1],
      } satisfies DeathEvent;
    }

    // Try pickup: "Picked up a stimpack."
    const pickupMatch = text.match(PATTERNS.PICKUP);
    if (pickupMatch) {
      return {
        type: "pickup",
        time_ms,
        text,
        item: pickupMatch[1],
      } satisfies PickupEvent;
    }

    // Try secret: "A secret is revealed!"
    if (PATTERNS.SECRET.test(text)) {
      return {
        type: "secret",
        time_ms,
        text,
      } satisfies SecretEvent;
    }

    // Default: generic message
    return {
      type: "message",
      time_ms,
      text,
    } satisfies MessageEvent;
  }

  /**
   * Parse raw log output from GZDoom into events array
   * Input: array of [time_ms, text] tuples from Rust backend
   */
  function parseRawLog(lines: Array<[number, string]>): GameEvent[] {
    return lines
      .filter(([, text]) => text.trim().length > 0) // Skip empty lines
      .map(([time_ms, text]) => parseLogLine(text, time_ms));
  }

  /**
   * Save a gameplay log to disk
   */
  async function saveGameplayLog(
    slug: string,
    skill: SkillLevel,
    rawLines: Array<[number, string]>,
    startedAt: Date,
    endedAt: Date
  ): Promise<string> {
    const sessionsDir = await getSessionsDir(slug);

    // Ensure directory exists
    try {
      await mkdir(sessionsDir, { recursive: true });
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.error(`Error creating sessions dir for ${slug}:`, e);
        throw e;
      }
    }

    // Parse events
    const events = parseRawLog(rawLines);

    // Build raw log string
    const rawLog = rawLines.map(([, text]) => text).join("\n");

    // Build the log object
    const log: GameplayLog = {
      schemaVersion: 1,
      wadSlug: slug,
      skill,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      events,
      rawLog,
    };

    // Write to file
    const filename = `${sanitizeTimestamp(startedAt.toISOString())}.json`;
    const filepath = `${sessionsDir}/${filename}`;

    await writeTextFile(filepath, JSON.stringify(log, null, 2));
    console.log(`[GameplayLog] Saved session to ${filename} (${events.length} events)`);

    return filepath;
  }

  /**
   * Load all gameplay logs for a WAD
   */
  async function loadAllGameplayLogs(slug: string): Promise<GameplayLog[]> {
    const sessionsDir = await getSessionsDir(slug);

    try {
      if (!(await exists(sessionsDir))) {
        return [];
      }
    } catch {
      return [];
    }

    let files: string[];
    try {
      const entries = await readDir(sessionsDir);
      files = entries
        .filter((e) => e.name?.endsWith(".json"))
        .map((e) => e.name!)
        .sort(); // Chronological order by filename
    } catch {
      return [];
    }

    const logs: GameplayLog[] = [];

    for (const filename of files) {
      try {
        const content = await readTextFile(`${sessionsDir}/${filename}`);
        const parsed = GameplayLogSchema.safeParse(JSON.parse(content));
        if (parsed.success) {
          logs.push(parsed.data);
        } else {
          console.warn(`Invalid gameplay log ${filename}:`, parsed.error.format());
        }
      } catch (e) {
        console.error(`Error reading gameplay log ${filename}:`, e);
      }
    }

    return logs;
  }

  return {
    getSessionsDir,
    parseLogLine,
    parseRawLog,
    saveGameplayLog,
    loadAllGameplayLogs,
  };
}
