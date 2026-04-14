/** Shared display-label constants. */

import type { WadEntry } from "./schema";

/** Human-readable labels for WAD types. */
export const TYPE_LABELS: Record<WadEntry["type"], string> = {
  "single-level": "Single Level",
  episode: "Episode",
  megawad: "Megawad",
  "gameplay-mod": "Mod",
  "total-conversion": "TC",
  "resource-pack": "Resources",
  deathmatch: "Deathmatch",
};

/** Human-readable labels for IWADs. */
export const IWAD_LABELS: Record<string, string> = {
  doom: "Doom",
  doom2: "Doom II",
  plutonia: "Plutonia",
  tnt: "TNT",
  heretic: "Heretic",
  hexen: "Hexen",
  freedoom1: "Freedoom 1",
  freedoom2: "Freedoom 2",
};
