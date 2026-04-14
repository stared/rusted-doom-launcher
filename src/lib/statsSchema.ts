import { z } from "zod";

// GZDoom skill levels as human-readable acronyms
export const SkillLevelSchema = z.enum(["ITYTD", "HNTR", "HMP", "UV", "NM"]);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

// ITYTD = I'm Too Young To Die (0)
// HNTR  = Hey, Not Too Rough (1)
// HMP   = Hurt Me Plenty (2)
// UV    = Ultra-Violence (3)
// NM    = Nightmare (4)
export const SKILL_FROM_NUMBER: Record<number, SkillLevel> = {
  0: "ITYTD",
  1: "HNTR",
  2: "HMP",
  3: "UV",
  4: "NM",
};

export const SKILL_FULL_NAMES: Record<SkillLevel, string> = {
  ITYTD: "I'm Too Young To Die",
  HNTR: "Hey, Not Too Rough",
  HMP: "Hurt Me Plenty",
  UV: "Ultra-Violence",
  NM: "Nightmare",
};

// Stats for a single level within a play session
export const LevelPlayStatsSchema = z.object({
  id: z.string(),             // "MAP12", "E1M1"
  name: z.string(),           // "Blazing Boulevard" (or same as id if unknown)
  kills: z.number().int().nonnegative(),
  totalKills: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  secrets: z.number().int().nonnegative(),
  totalSecrets: z.number().int().nonnegative(),
  timeTics: z.number().int().nonnegative(),  // 35 tics = 1 second
});
export type LevelPlayStats = z.infer<typeof LevelPlayStatsSchema>;

// A single play session (one continuous playthrough)
export const PlaySessionSchema = z.object({
  schemaVersion: z.literal(1),
  wadSlug: z.string(),
  startLevel: z.string(),     // Episode start point, e.g. "MAP01" or "MAP11"
  skill: SkillLevelSchema,
  capturedAt: z.string(),     // ISO timestamp when this was captured
  sourceFile: z.string(),     // Which .zds file this came from, e.g. "auto00.zds"
  levels: z.array(LevelPlayStatsSchema).min(1),
});
export type PlaySession = z.infer<typeof PlaySessionSchema>;
