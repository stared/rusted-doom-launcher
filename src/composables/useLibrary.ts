/**
 * Central library directory layout.
 * Every path into the data folder goes through here.
 */

import { join } from "@tauri-apps/api/path";
import { useSettings } from "./useSettings";

export function useLibrary() {
  const { settings } = useSettings();

  function base(): string {
    return settings.value.libraryPath;
  }

  return {
    /** Root library path. */
    base,
    /** iwads/ — IWAD files (doom2.wad, etc.) */
    iwadsDir: () => join(base(), "iwads"),
    /** saves/{slug}/ — GZDoom .zds save files */
    savesDir: (slug: string) => join(base(), "saves", slug),
    /** stats/{slug}/ — Captured play session JSONs */
    statsDir: (slug: string) => join(base(), "stats", slug),
    /** sessions/{slug}/ — Gameplay log JSONs */
    sessionsDir: (slug: string) => join(base(), "sessions", slug),
    /** level-names/{slug}.json — Cached level name mappings */
    levelNamesPath: (slug: string) => join(base(), "level-names", `${slug}.json`),
    /** level-names/ directory */
    levelNamesDir: () => join(base(), "level-names"),
    /** Path to a specific IWAD file */
    iwadFile: (filename: string) => join(base(), "iwads", filename),
    /** Path to a downloaded WAD/ZIP file in library root */
    wadFile: (filename: string) => join(base(), filename),
  };
}
