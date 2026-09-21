import { GOG_WANTED_WADS } from "./gogContent";

/** All WAD files sought from DOOM + DOOM II on Steam (App 2280 / Depot 2281). */
export const STEAM_WANTED_WADS = [
  ...GOG_WANTED_WADS,
  "id1-res.wad",
  "id1-weap.wad",
];

export interface SteamWadDetail {
  file: string;
  title: string;
  category: "base" | "expansion" | "resource";
  description: string;
}

export const STEAM_WAD_DETAILS: Record<string, SteamWadDetail> = {
  "doom.wad": {
    file: "doom.wad",
    title: "The Ultimate Doom",
    category: "base",
    description: "Original 1993 game with Episode 4: Thy Flesh Consumed",
  },
  "doom2.wad": {
    file: "doom2.wad",
    title: "DOOM II: Hell on Earth",
    category: "base",
    description: "Sequel with the Super Shotgun and 30 classic levels",
  },
  "plutonia.wad": {
    file: "plutonia.wad",
    title: "Final Doom: The Plutonia Experiment",
    category: "base",
    description: "Challenging 32-level campaign by the Casali brothers",
  },
  "tnt.wad": {
    file: "tnt.wad",
    title: "Final Doom: TNT Evilution",
    category: "base",
    description: "32-level campaign by TeamTNT",
  },
  "id1.wad": {
    file: "id1.wad",
    title: "Legacy of Rust",
    category: "expansion",
    description: "Official 2024 campaign co-developed by id Software, Nightdive, and MachineGames",
  },
  "id24res.wad": {
    file: "id24res.wad",
    title: "ID24 Resources",
    category: "resource",
    description: "Modern graphics, enemies, and sound spec dependencies",
  },
  "id1-res.wad": {
    file: "id1-res.wad",
    title: "Legacy of Rust Resources",
    category: "resource",
    description: "Monster and asset resources for Legacy of Rust",
  },
  "id1-weap.wad": {
    file: "id1-weap.wad",
    title: "Legacy of Rust Weapons",
    category: "resource",
    description: "Calamity Blade and Incinerator weapon definitions",
  },
  "nerve.wad": {
    file: "nerve.wad",
    title: "No Rest for the Living",
    category: "expansion",
    description: "9-level campaign by Nerve Software (Doom II 2010 BFG / XBLA)",
  },
  "masterlevels.wad": {
    file: "masterlevels.wad",
    title: "Master Levels for DOOM II",
    category: "expansion",
    description: "20 authorized community master levels",
  },
  "sigil.wad": {
    file: "sigil.wad",
    title: "SIGIL",
    category: "expansion",
    description: "Episode 5 by John Romero",
  },
  "sigil2.wad": {
    file: "sigil2.wad",
    title: "SIGIL II",
    category: "expansion",
    description: "Episode 6 by John Romero (2023)",
  },
};

export function getWadFriendlyName(file: string): string {
  const lower = file.toLowerCase();
  return STEAM_WAD_DETAILS[lower]?.title || file;
}
