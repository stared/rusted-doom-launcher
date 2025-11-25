import { z } from "zod";

// Enums
export const IwadEnum = z.enum([
  "doom",
  "doom2",
  "plutonia",
  "tnt",
  "heretic",
  "hexen",
  "freedoom1",
  "freedoom2",
]);

export const WadTypeEnum = z.enum([
  "single-level",
  "episode",
  "megawad",
  "gameplay-mod",
  "total-conversion",
  "resource-pack",
]);

export const SourcePortEnum = z.enum(["vanilla", "boom", "mbf21", "gzdoom"]);

export const DifficultyEnum = z.enum([
  "easy",
  "medium",
  "hard",
  "slaughter",
  "unknown",
]);

export const DownloadTypeEnum = z.enum([
  "idgames",
  "moddb",
  "github",
  "direct",
]);

export const AwardTypeEnum = z.enum(["cacoward", "runner-up", "mention"]);

export const VideoTypeEnum = z.enum([
  "review",
  "playthrough",
  "trailer",
  "speedrun",
]);

export const SourceEnum = z.enum([
  "manual",
  "idgames-scraper",
  "cacowards-scraper",
]);

// Sub-schemas
export const AuthorSchema = z.object({
  name: z.string().min(1),
});

export const DownloadSourceSchema = z.object({
  type: DownloadTypeEnum,
  url: z.string().url(),
  filename: z.string().min(1),
});

export const ScreenshotSchema = z.object({
  url: z.string().url(),
  caption: z.string(), // "" if no caption
});

export const YouTubeVideoSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/, "Invalid YouTube video ID"),
  title: z.string().min(1),
  type: VideoTypeEnum,
});

export const AwardSchema = z.object({
  type: AwardTypeEnum,
  year: z.number().int().min(1994).max(2030),
});

export const WadDependencySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be kebab-case"),
  name: z.string().min(1),
  required: z.boolean(),
});

// Main WAD Entry Schema
export const WadEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be kebab-case"),
  title: z.string().min(1).max(200),
  authors: z.array(AuthorSchema).min(1),
  year: z.number().int().min(1993).max(2030),
  description: z.string().min(1),

  // Technical requirements
  iwad: IwadEnum,
  type: WadTypeEnum,
  sourcePort: SourcePortEnum,

  // Dependencies
  requires: z.array(WadDependencySchema),

  // Downloads
  downloads: z.array(DownloadSourceSchema).min(1),

  // Media
  thumbnail: z.string(), // URL or "" if none
  screenshots: z.array(ScreenshotSchema),
  youtubeVideos: z.array(YouTubeVideoSchema),

  // Categorization
  awards: z.array(AwardSchema),
  tags: z.array(z.string()),
  difficulty: DifficultyEnum,

  // Metadata
  _schemaVersion: z.literal(1),
  _source: SourceEnum,
});

// Type exports inferred from Zod schemas
export type Iwad = z.infer<typeof IwadEnum>;
export type WadType = z.infer<typeof WadTypeEnum>;
export type SourcePort = z.infer<typeof SourcePortEnum>;
export type Difficulty = z.infer<typeof DifficultyEnum>;
export type DownloadType = z.infer<typeof DownloadTypeEnum>;
export type AwardType = z.infer<typeof AwardTypeEnum>;
export type VideoType = z.infer<typeof VideoTypeEnum>;
export type Source = z.infer<typeof SourceEnum>;

export type Author = z.infer<typeof AuthorSchema>;
export type DownloadSource = z.infer<typeof DownloadSourceSchema>;
export type Screenshot = z.infer<typeof ScreenshotSchema>;
export type YouTubeVideo = z.infer<typeof YouTubeVideoSchema>;
export type Award = z.infer<typeof AwardSchema>;
export type WadDependency = z.infer<typeof WadDependencySchema>;
export type WadEntry = z.infer<typeof WadEntrySchema>;

// Validation helper
export function validateWadEntry(data: unknown): WadEntry {
  return WadEntrySchema.parse(data);
}

export function safeValidateWadEntry(
  data: unknown
): { success: true; data: WadEntry } | { success: false; error: z.ZodError } {
  const result = WadEntrySchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// Launcher Downloads State Schema
export const DownloadedWadSchema = z.object({
  filename: z.string().min(1),
  downloadedAt: z.string().datetime(),
  size: z.number().int().nonnegative(),
});

export const LauncherDownloadsSchema = z.object({
  version: z.literal(1),
  downloads: z.record(z.string(), DownloadedWadSchema),
});

export type DownloadedWad = z.infer<typeof DownloadedWadSchema>;
export type LauncherDownloads = z.infer<typeof LauncherDownloadsSchema>;

export function createEmptyLauncherDownloads(): LauncherDownloads {
  return { version: 1, downloads: {} };
}
