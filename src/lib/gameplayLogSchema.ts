import { z } from "zod";
import { SkillLevelSchema } from "./statsSchema";

// Event type discriminator
export const GameEventTypeSchema = z.enum([
  "level_enter",
  "death",
  "pickup",
  "secret",
  "message",
]);
export type GameEventType = z.infer<typeof GameEventTypeSchema>;

// Base fields shared by all events
const BaseGameEventSchema = z.object({
  type: GameEventTypeSchema,
  time_ms: z.number().int().nonnegative(), // ms since session start
  text: z.string(),                         // original console line
});

// Level enter event: "MAP16 - Leave Your Sol Behind"
export const LevelEnterEventSchema = BaseGameEventSchema.extend({
  type: z.literal("level_enter"),
  mapId: z.string(),   // "MAP16", "E1M1"
  mapName: z.string(), // "Leave Your Sol Behind"
});
export type LevelEnterEvent = z.infer<typeof LevelEnterEventSchema>;

// Death event: "Player was splayed by an alien."
export const DeathEventSchema = BaseGameEventSchema.extend({
  type: z.literal("death"),
  cause: z.string(), // "splayed by an alien", "let an alien get him"
});
export type DeathEvent = z.infer<typeof DeathEventSchema>;

// Pickup event: "Picked up a stimpack."
export const PickupEventSchema = BaseGameEventSchema.extend({
  type: z.literal("pickup"),
  item: z.string(), // "stimpack", "rocket"
});
export type PickupEvent = z.infer<typeof PickupEventSchema>;

// Secret event: "A secret is revealed!"
export const SecretEventSchema = BaseGameEventSchema.extend({
  type: z.literal("secret"),
});
export type SecretEvent = z.infer<typeof SecretEventSchema>;

// Message event: catch-all for unrecognized console lines
export const MessageEventSchema = BaseGameEventSchema.extend({
  type: z.literal("message"),
});
export type MessageEvent = z.infer<typeof MessageEventSchema>;

// Union of all event types
export const GameEventSchema = z.discriminatedUnion("type", [
  LevelEnterEventSchema,
  DeathEventSchema,
  PickupEventSchema,
  SecretEventSchema,
  MessageEventSchema,
]);
export type GameEvent = z.infer<typeof GameEventSchema>;

// Top-level gameplay log structure
export const GameplayLogSchema = z.object({
  schemaVersion: z.literal(1),
  wadSlug: z.string(),
  skill: SkillLevelSchema,
  startedAt: z.string(),   // ISO timestamp
  endedAt: z.string(),     // ISO timestamp
  durationMs: z.number().int().nonnegative(),
  events: z.array(GameEventSchema),
  rawLog: z.string(),
});
export type GameplayLog = z.infer<typeof GameplayLogSchema>;

// Regex patterns for parsing GZDoom console output
export const PATTERNS = {
  // "MAP16 - Leave Your Sol Behind" or "E1M1 - Hangar"
  LEVEL_ENTER: /^(MAP\d+|E\dM\d+)\s*-\s*(.+)$/i,

  // "Player was splayed by an imp." / "Player let an alien get him."
  DEATH: /^Player (?:was |let |)(.+)\.$/i,

  // "Picked up a stimpack." / "Picked up the armor."
  PICKUP: /^Picked up (?:a |an |the )?(.+)\.$/i,

  // "A secret is revealed!"
  SECRET: /^A secret is revealed!$/i,
};

// Helper: count deaths in a log (computed on read)
export function getDeathCount(log: GameplayLog): number {
  return log.events.filter((e) => e.type === "death").length;
}

// Helper: get unique levels visited (computed on read)
export function getLevelsVisited(log: GameplayLog): string[] {
  return [
    ...new Set(
      log.events
        .filter((e): e is LevelEnterEvent => e.type === "level_enter")
        .map((e) => e.mapId)
    ),
  ];
}

// Helper: format duration for display
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
