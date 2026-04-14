/**
 * Central library directory layout.
 * Every path into the data folder goes through here.
 * All functions return synchronous strings — no IPC needed for path joining.
 */

import { useSettings } from "./useSettings";
import { getOs } from "../lib/platform";

const SEP = getOs() === "win" ? "\\" : "/";

export function useLibrary() {
  const { settings } = useSettings();

  function base(): string {
    return settings.value.libraryPath;
  }

  /** Join segments under the library root with OS-appropriate separator. */
  function p(...parts: string[]): string {
    return [base(), ...parts].join(SEP);
  }

  return {
    /** Root library path. */
    base,
    /** iwads/ — IWAD files (doom2.wad, etc.) */
    iwadsDir: () => p("iwads"),
    /** saves/{slug}/ — GZDoom .zds save files */
    savesDir: (slug: string) => p("saves", slug),
    /** stats/{slug}/ — Captured play session JSONs */
    statsDir: (slug: string) => p("stats", slug),
    /** sessions/{slug}/ — Gameplay log JSONs */
    sessionsDir: (slug: string) => p("sessions", slug),
    /** level-names/{slug}.json — Cached level name mappings */
    levelNamesPath: (slug: string) => p("level-names", `${slug}.json`),
    /** level-names/ directory */
    levelNamesDir: () => p("level-names"),
    /** Path to a specific IWAD file */
    iwadFile: (filename: string) => p("iwads", filename),
    /** Path to a downloaded WAD/ZIP file in library root */
    wadFile: (filename: string) => p(filename),
  };
}
