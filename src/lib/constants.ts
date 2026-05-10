/** Shared display-label constants. */

import type { Iwad, WadEntry } from "./schema";

// IWAD thumbnails — sourced from doomwiki.org title screens (doom, doom2,
// plutonia, tnt, heretic, hexen) and freedoom.github.io official screenshots
// (freedoom1, freedoom2). Downscaled to 800px JPEG; freedoom shots pre-cropped
// to 16:9 to drop the HUD strip. See AUTHORS / per-file URLs:
//   doom       https://doomwiki.org/w/images/4/4b/Doom-1-.gif
//   doom2      https://doomwiki.org/w/images/5/51/Doom2_title.png
//   plutonia   https://doomwiki.org/w/images/0/0c/Plutonia_title.gif
//   tnt        https://doomwiki.org/w/images/e/ed/TNT_title.gif
//   heretic    https://doomwiki.org/w/images/b/b3/Heretictitle.png
//   hexen      https://doomwiki.org/w/images/5/5f/Hexen.png
//   freedoom1  https://freedoom.github.io/img/screenshots/p1_1.png
//   freedoom2  https://freedoom.github.io/img/screenshots/p2_1.png
import doomCover from "../assets/iwads/doom.jpg";
import doom2Cover from "../assets/iwads/doom2.jpg";
import plutoniaCover from "../assets/iwads/plutonia.jpg";
import tntCover from "../assets/iwads/tnt.jpg";
import hereticCover from "../assets/iwads/heretic.jpg";
import hexenCover from "../assets/iwads/hexen.jpg";
import freedoom1Cover from "../assets/iwads/freedoom1.jpg";
import freedoom2Cover from "../assets/iwads/freedoom2.jpg";

/** Human-readable labels for WAD types. */
export const TYPE_LABELS: Record<WadEntry["type"], string> = {
  iwad: "Base game",
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

/** Static metadata for synthesising playable entries from detected IWADs. */
export const IWAD_METADATA: Record<Iwad, { authors: string[]; year: number; description: string; thumbnail: string }> = {
  doom: { authors: ["id Software"], year: 1993, description: "The original Doom. Four episodes in the Ultimate Doom release.", thumbnail: doomCover },
  doom2: { authors: ["id Software"], year: 1994, description: "Doom II: Hell on Earth. 32 levels including two secret stages.", thumbnail: doom2Cover },
  plutonia: { authors: ["Dario & Milo Casali"], year: 1996, description: "Final Doom: The Plutonia Experiment. 32 high-difficulty maps.", thumbnail: plutoniaCover },
  tnt: { authors: ["TeamTNT"], year: 1996, description: "Final Doom: TNT Evilution. 32 maps with new music and textures.", thumbnail: tntCover },
  heretic: { authors: ["Raven Software"], year: 1994, description: "Heretic. Fantasy first-person shooter on the Doom engine.", thumbnail: hereticCover },
  hexen: { authors: ["Raven Software"], year: 1995, description: "Hexen: Beyond Heretic. Hub-based fantasy with a class system.", thumbnail: hexenCover },
  freedoom1: { authors: ["Freedoom Project"], year: 2003, description: "Freedoom Phase 1 — a free replacement for the Ultimate Doom IWAD.", thumbnail: freedoom1Cover },
  freedoom2: { authors: ["Freedoom Project"], year: 2003, description: "Freedoom Phase 2 — a free replacement for the Doom II IWAD.", thumbnail: freedoom2Cover },
};
