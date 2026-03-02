import { unzipSync } from "fflate";

export interface GameFile {
  name: string;
  data: Uint8Array;
}

/**
 * Find all .wad and .pk3 files inside a ZIP archive.
 * Strips directory paths and uses basename only.
 * Throws if no game files are found.
 */
export function findGameFilesInZip(zipData: Uint8Array): GameFile[] {
  const entries = unzipSync(zipData);

  const gameFiles: GameFile[] = [];

  for (const [path, data] of Object.entries(entries)) {
    const lowerPath = path.toLowerCase();
    if (lowerPath.endsWith(".wad") || lowerPath.endsWith(".pk3")) {
      // Use basename only (strip directory paths)
      const basename = path.split("/").pop() ?? path;
      if (basename) {
        gameFiles.push({ name: basename, data });
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
 * If multiple: largest by data.length is primary, rest are additional (sorted by name).
 */
export function selectPrimaryGameFile(files: GameFile[]): {
  primary: GameFile;
  additional: GameFile[];
} {
  if (files.length === 1) {
    return { primary: files[0], additional: [] };
  }

  // Sort by size descending to find largest
  const sorted = [...files].sort((a, b) => b.data.length - a.data.length);
  const primary = sorted[0];
  const additional = sorted.slice(1).sort((a, b) => a.name.localeCompare(b.name));

  return { primary, additional };
}
