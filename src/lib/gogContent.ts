// What the GOG Doom installers can provide, and how it maps onto the
// launcher's content model.
//
// Base IWADs land in iwads/ and surface as synthetic base-game cards.
// Expansions (official add-on PWADs) also land in iwads/ — they are owned
// game data, not downloads — and get a synthetic download record with
// externalPath pointing there, which lights up their catalog entry
// (content/wads/<slug>.json) as playable.

/** -iwad targets recognized by the engine. */
export const GOG_BASE_IWADS = [
  "doom.wad",
  "doom2.wad",
  "plutonia.wad",
  "tnt.wad",
  "heretic.wad",
  "hexen.wad",
];

export interface GogExpansion {
  /** Canonical lowercase filename inside iwads/. */
  file: string;
  /** Slug of the catalog entry this file makes playable. */
  slug: string;
}

export const GOG_EXPANSIONS: GogExpansion[] = [
  { file: "nerve.wad", slug: "no-rest-for-the-living" },
  { file: "masterlevels.wad", slug: "master-levels" },
  { file: "sigil.wad", slug: "sigil" },
  { file: "sigil2.wad", slug: "sigil-2" },
  { file: "id1.wad", slug: "legacy-of-rust" },
  { file: "id24res.wad", slug: "id24res" },
  { file: "iddm1.wad", slug: "iddm1" },
];

/** Everything worth pulling out of a GOG installer. */
export const GOG_WANTED_WADS = [...GOG_BASE_IWADS, ...GOG_EXPANSIONS.map(e => e.file)];
