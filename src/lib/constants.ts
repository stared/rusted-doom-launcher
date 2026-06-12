/** Shared display-label constants. */

import type { Iwad, WadEntry } from "./schema";
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

/** Human-readable labels for IWADs. Keyed by Iwad so adding an id to the
 * schema enum fails compilation here until a label exists. */
export const IWAD_LABELS: Record<Iwad, string> = {
  doom: "Doom",
  doom2: "Doom II",
  plutonia: "Plutonia",
  tnt: "TNT",
  heretic: "Heretic",
  hexen: "Hexen",
  freedoom1: "Freedoom 1",
  freedoom2: "Freedoom 2",
};

/** IWAD select options for the custom-import form: long-form labels, most
 * common base games first. */
export const IWAD_PICKER_OPTIONS: { value: Iwad; label: string }[] = [
  { value: "doom2", label: "Doom II" },
  { value: "doom", label: "Doom" },
  { value: "plutonia", label: "Plutonia" },
  { value: "tnt", label: "TNT: Evilution" },
  { value: "heretic", label: "Heretic" },
  { value: "hexen", label: "Hexen" },
  { value: "freedoom2", label: "Freedoom Phase 2" },
  { value: "freedoom1", label: "Freedoom Phase 1" },
];

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
