// Pure helpers for zip entry listings. Listing and extraction happen in
// the Rust commands of src-tauri/src/game_archives.rs.

/** One entry of a zip listing, as returned by the `list_zip_entries` command. */
export interface ZipEntryInfo {
  path: string;
  size: number;
}

/** A .wad/.pk3 found in a listing: entry path + display basename. */
export interface GameFileEntry extends ZipEntryInfo {
  name: string;
}

/** Anything with a name and size — enough to pick the primary file. */
export interface GameFileInfo {
  name: string;
  size: number;
}

/**
 * Find all .wad and .pk3 entries in a zip listing.
 * Strips directory paths and uses basename only.
 * Throws if no game files are found.
 */
export function findGameFileEntries(entries: ZipEntryInfo[]): GameFileEntry[] {
  const gameFiles: GameFileEntry[] = [];

  for (const entry of entries) {
    const lowerPath = entry.path.toLowerCase();
    if (lowerPath.endsWith(".wad") || lowerPath.endsWith(".pk3")) {
      const basename = entry.path.split(/[/\\]/).pop() ?? entry.path;
      if (basename) {
        gameFiles.push({ ...entry, name: basename });
      }
    }
  }

  if (gameFiles.length === 0) {
    throw new Error("No WAD or PK3 files found inside ZIP archive");
  }

  return gameFiles;
}

/**
 * Select which file is primary (for -file) vs additional.
 * If one file: it's the primary.
 * If multiple: largest by size is primary, rest are additional (sorted by name).
 */
export function selectPrimaryGameFile<T extends GameFileInfo>(files: T[]): {
  primary: T;
  additional: T[];
} {
  if (files.length === 1) {
    return { primary: files[0], additional: [] };
  }

  // Sort by size descending to find largest
  const sorted = [...files].sort((a, b) => b.size - a.size);
  const primary = sorted[0];
  const additional = sorted.slice(1).sort((a, b) => a.name.localeCompare(b.name));

  return { primary, additional };
}
