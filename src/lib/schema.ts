import { z } from "zod";

// Dynamic max year - allows current year + 1 for upcoming releases
const MAX_YEAR = new Date().getFullYear() + 1;

// IWADs
const IwadEnum = z.enum(["doom", "doom2", "plutonia", "tnt", "heretic", "hexen", "freedoom1", "freedoom2"]);
export type Iwad = z.infer<typeof IwadEnum>;

// YouTube Video (exported for tests)
export const YouTubeVideoSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  title: z.string().min(1),
  type: z.enum(["review", "playthrough", "trailer", "speedrun"]),
});

// Main WAD Entry Schema
export const WadEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(200),
  authors: z.array(z.object({ name: z.string().min(1) })).min(1),
  year: z.number().int().min(1993).max(MAX_YEAR),
  description: z.string().min(1),
  iwad: IwadEnum,
  type: z.enum(["single-level", "episode", "megawad", "gameplay-mod", "total-conversion", "resource-pack"]),
  sourcePort: z.enum(["vanilla", "limit_removing", "boom", "mbf21", "gzdoom"]),
  requires: z.array(z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    required: z.boolean(),
  })),
  downloads: z.array(z.object({
    type: z.enum(["idgames", "moddb", "github", "direct"]),
    url: z.string().url(),
    filename: z.string().min(1),
  })).min(1),
  thumbnail: z.string(),
  screenshots: z.array(z.object({ url: z.string().url(), caption: z.string() })),
  youtubeVideos: z.array(YouTubeVideoSchema),
  awards: z.array(z.object({
    type: z.enum(["cacoward", "runner-up", "mention"]),
    year: z.number().int().min(1994).max(MAX_YEAR),
  })),
  tags: z.array(z.string()),
  difficulty: z.enum(["easy", "medium", "hard", "slaughter", "unknown"]),
  urls: z.array(z.string().url()).min(1),
  notes: z.string(),
  _schemaVersion: z.literal(1),
  _source: z.enum(["manual", "idgames-scraper", "cacowards-scraper"]),
});

export type WadEntry = z.infer<typeof WadEntrySchema>;

export function safeValidateWadEntry(data: unknown): { success: true; data: WadEntry } | { success: false; error: z.ZodError } {
  const result = WadEntrySchema.safeParse(data);
  return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
}

// Launcher Downloads State
export const LauncherDownloadsSchema = z.object({
  version: z.literal(1),
  downloads: z.record(z.string(), z.object({
    filename: z.string().min(1),
    downloadedAt: z.string().datetime(),
    size: z.number().int().nonnegative(),
  })),
});

export type LauncherDownloads = z.infer<typeof LauncherDownloadsSchema>;
