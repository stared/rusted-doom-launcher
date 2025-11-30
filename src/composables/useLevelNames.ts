import { ref } from "vue";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { unzipSync, strFromU8 } from "fflate";
import { extractLevelNames, extractLevelNamesFromData } from "../lib/wadParser";
import { useSettings } from "./useSettings";
import { LauncherDownloadsSchema } from "../lib/schema";

// Singleton cache: slug -> (mapId -> levelName)
const levelNamesCache = ref<Map<string, Map<string, string>>>(new Map());

export function useLevelNames() {
  const { getLibraryPath } = useSettings();

  /**
   * Get download info for a slug from launcher-downloads.json
   */
  async function getDownloadInfo(slug: string): Promise<{ filename: string } | null> {
    try {
      const libraryPath = await getLibraryPath();
      const content = await readTextFile(`${libraryPath}/launcher-downloads.json`);
      const parsed = LauncherDownloadsSchema.safeParse(JSON.parse(content));
      if (parsed.success && parsed.data.downloads[slug]) {
        return parsed.data.downloads[slug];
      }
    } catch { /* file doesn't exist */ }
    return null;
  }

  /**
   * Load level names for a WAD from its downloaded files.
   * Handles both ZIP archives and direct WAD files.
   */
  async function loadLevelNames(slug: string): Promise<Map<string, string> | null> {
    // Check cache first
    if (levelNamesCache.value.has(slug)) {
      return levelNamesCache.value.get(slug)!;
    }

    try {
      const downloadInfo = await getDownloadInfo(slug);
      if (!downloadInfo) {
        return null;
      }

      const libraryPath = await getLibraryPath();
      const filePath = `${libraryPath}/${downloadInfo.filename}`;
      const filename = downloadInfo.filename.toLowerCase();

      let allLevels = new Map<string, string>();

      if (filename.endsWith(".zip") || filename.endsWith(".pk3")) {
        // Handle ZIP archives (including .pk3 which are also ZIP format)
        const data = await readFile(filePath);
        const uint8 = new Uint8Array(data);

        try {
          const unzipped = unzipSync(uint8);

          // Find WAD files inside the ZIP
          for (const [entryName, entryData] of Object.entries(unzipped)) {
            if (entryName.toLowerCase().endsWith(".wad")) {
              try {
                const levels = extractLevelNamesFromData(entryData);
                for (const [mapId, levelName] of levels) {
                  if (!allLevels.has(mapId)) {
                    allLevels.set(mapId, levelName);
                  }
                }
              } catch (e) {
                console.warn(`Failed to parse ${entryName}:`, e);
              }
            }
          }

          // Also check for MAPINFO files directly in the ZIP (for .pk3)
          const mapinfoLumps = ["MAPINFO", "ZMAPINFO", "EMAPINFO", "UMAPINFO"];
          for (const [entryName, entryData] of Object.entries(unzipped)) {
            const baseName = entryName.split("/").pop()?.toUpperCase() || "";
            if (mapinfoLumps.includes(baseName)) {
              try {
                const content = strFromU8(entryData);
                const levels = parseMapinfoContent(baseName, content);
                for (const [mapId, levelName] of levels) {
                  if (!allLevels.has(mapId)) {
                    allLevels.set(mapId, levelName);
                  }
                }
              } catch (e) {
                console.warn(`Failed to parse ${entryName}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to unzip ${filename}:`, e);
        }
      } else if (filename.endsWith(".wad")) {
        // Direct WAD file
        allLevels = await extractLevelNames(filePath);
      }

      if (allLevels.size > 0) {
        levelNamesCache.value.set(slug, allLevels);
        return allLevels;
      }

      return null;
    } catch (e) {
      console.error(`Failed to load level names for ${slug}:`, e);
      return null;
    }
  }

  /**
   * Get cached level names for a slug (returns null if not loaded).
   */
  function getCachedLevelNames(slug: string): Map<string, string> | null {
    return levelNamesCache.value.get(slug) ?? null;
  }

  /**
   * Get the display name for a level.
   * Returns the custom name if available, otherwise the map ID.
   */
  function getLevelDisplayName(slug: string, mapId: string): string {
    const names = levelNamesCache.value.get(slug);
    const customName = names?.get(mapId.toUpperCase());
    return customName ? `${mapId}: ${customName}` : mapId;
  }

  /**
   * Clear the cache for a specific slug or all slugs.
   */
  function clearCache(slug?: string): void {
    if (slug) {
      levelNamesCache.value.delete(slug);
    } else {
      levelNamesCache.value.clear();
    }
  }

  return {
    loadLevelNames,
    getCachedLevelNames,
    getLevelDisplayName,
    clearCache,
  };
}

// Helper function to parse MAPINFO content (same logic as wadParser)
function parseMapinfoContent(lumpName: string, content: string): Map<string, string> {
  const levels = new Map<string, string>();

  if (lumpName === "EMAPINFO") {
    // EMAPINFO format: [MAP01] levelname = ...
    let currentMap: string | null = null;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
      if (sectionMatch) {
        currentMap = sectionMatch[1].toUpperCase();
        continue;
      }
      if (currentMap) {
        const nameMatch = trimmed.match(/^levelname\s*=\s*(.+)/i);
        if (nameMatch) {
          let levelName = nameMatch[1].trim();
          const prefixPattern = new RegExp(`^${currentMap}:\\s*`, "i");
          levelName = levelName.replace(prefixPattern, "");
          levels.set(currentMap, levelName);
        }
      }
    }
  } else if (lumpName === "UMAPINFO") {
    // UMAPINFO format: MAP MAP01 { levelname = "..." }
    let currentMap: string | null = null;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      const mapMatch = trimmed.match(/^MAP\s+(\w+)/i);
      if (mapMatch) {
        currentMap = mapMatch[1].toUpperCase();
        continue;
      }
      if (currentMap) {
        const nameMatch = trimmed.match(/^levelname\s*=\s*"?([^"]+)"?/i);
        if (nameMatch) {
          levels.set(currentMap, nameMatch[1].trim());
        }
      }
    }
  } else {
    // MAPINFO/ZMAPINFO format: map MAP01 "Level Name" { ... }
    const pattern = /map\s+(\w+)\s+"([^"]+)"/gi;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      levels.set(match[1].toUpperCase(), match[2]);
    }
  }

  return levels;
}
