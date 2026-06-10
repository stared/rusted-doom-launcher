import { ref } from "vue";
import { readTextFile, writeTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { extractLevelNames, extractLevelNamesFromData, parseLevelNamesFromContent } from "../lib/wadParser";
import { invoke } from "@tauri-apps/api/core";
import { isNotFoundError } from "../lib/errors";
import { useLibrary } from "./useLibrary";
import type { LauncherDownloads } from "../lib/schema";
import type { ZipEntryInfo } from "../lib/zipExtract";

// Singleton cache: slug -> (mapId -> levelName)
const levelNamesCache = ref<Map<string, Map<string, string>>>(new Map());

export function useLevelNames() {
  const { base, levelNamesPath, levelNamesDir, wadFile } = useLibrary();

  /**
   * Load level names from persistent storage.
   */
  async function loadFromStorage(slug: string): Promise<Map<string, string> | null> {
    try {
      const path = levelNamesPath(slug);
      if (await exists(path)) {
        const content = await readTextFile(path);
        const data = JSON.parse(content) as Record<string, string>;
        return new Map(Object.entries(data));
      }
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.warn(`Failed to load stored level names for ${slug}:`, e);
      }
    }
    return null;
  }

  /**
   * Save level names to persistent storage.
   */
  async function saveToStorage(slug: string, levels: Map<string, string>): Promise<void> {
    try {
      const dir = levelNamesDir();
      await mkdir(dir, { recursive: true });

      const path = levelNamesPath(slug);
      const data = Object.fromEntries(levels);
      await writeTextFile(path, JSON.stringify(data, null, 2));
      console.log(`[LevelNames] Saved ${levels.size} level names for ${slug}`);
    } catch (e) {
      console.error(`Failed to save level names for ${slug}:`, e);
    }
  }

  /**
   * Get download info for a slug.
   * Reads launcher-downloads.json via IPC rather than importing useDownload
   * to avoid circular dependency (useDownload → useLevelNames → useDownload).
   */
  async function getDownloadInfo(slug: string): Promise<{ filename: string } | null> {
    try {
      const state = await invoke<LauncherDownloads>("read_launcher_downloads", { libraryPath: base() });
      return state.downloads[slug] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Load level names for a WAD.
   * 1. Check memory cache
   * 2. Check persistent storage
   * 3. Parse WAD file and persist
   */
  async function loadLevelNames(slug: string): Promise<Map<string, string> | null> {
    // 1. Check memory cache
    if (levelNamesCache.value.has(slug)) {
      return levelNamesCache.value.get(slug)!;
    }

    // 2. Check persistent storage
    const stored = await loadFromStorage(slug);
    if (stored && stored.size > 0) {
      levelNamesCache.value.set(slug, stored);
      return stored;
    }

    // 3. Parse WAD file
    try {
      const downloadInfo = await getDownloadInfo(slug);
      if (!downloadInfo) {
        return null;
      }

      const filePath = wadFile(downloadInfo.filename);
      const filename = downloadInfo.filename.toLowerCase();

      let allLevels = new Map<string, string>();

      if (filename.endsWith(".zip") || filename.endsWith(".pk3")) {
        // Handle ZIP archives (including .pk3 which are also ZIP format).
        // Work from the entry listing and fetch only the entries we parse.
        try {
          const entries = await invoke<ZipEntryInfo[]>("list_zip_entries", { zipPath: filePath });

          const readEntry = async (entryPath: string): Promise<Uint8Array> => {
            const buf = await invoke<ArrayBuffer>("read_zip_entry", {
              zipPath: filePath,
              entryPath,
            });
            return new Uint8Array(buf);
          };

          // Find WAD files inside the ZIP
          for (const entry of entries) {
            if (!entry.path.toLowerCase().endsWith(".wad")) continue;
            try {
              const levels = extractLevelNamesFromData(await readEntry(entry.path));
              for (const [mapId, levelName] of levels) {
                if (!allLevels.has(mapId)) {
                  allLevels.set(mapId, levelName);
                }
              }
            } catch (e) {
              console.warn(`Failed to parse ${entry.path}:`, e);
            }
          }

          // Also check for MAPINFO files directly in the ZIP (for .pk3)
          const mapinfoLumps = ["MAPINFO", "ZMAPINFO", "EMAPINFO", "UMAPINFO"];
          for (const entry of entries) {
            const baseName = entry.path.split("/").pop()?.toUpperCase() || "";
            if (!mapinfoLumps.includes(baseName)) continue;
            try {
              const content = new TextDecoder().decode(await readEntry(entry.path));
              const levels = parseLevelNamesFromContent(baseName, content);
              for (const [mapId, levelName] of levels) {
                if (!allLevels.has(mapId)) {
                  allLevels.set(mapId, levelName);
                }
              }
            } catch (e) {
              console.warn(`Failed to parse ${entry.path}:`, e);
            }
          }
        } catch (e) {
          console.warn(`Failed to scan ${filename}:`, e);
        }
      } else if (filename.endsWith(".wad")) {
        // Direct WAD file
        allLevels = await extractLevelNames(filePath);
      }

      if (allLevels.size > 0) {
        levelNamesCache.value.set(slug, allLevels);
        // Persist to storage
        await saveToStorage(slug, allLevels);
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
   * Merge externally discovered level names (e.g. from save file Comments)
   * into the cache and persistent storage.
   * Existing names (from WAD MAPINFO) take priority.
   */
  async function mergeLevelNames(slug: string, discovered: Map<string, string>): Promise<void> {
    let existing = levelNamesCache.value.get(slug);
    if (!existing) {
      existing = await loadFromStorage(slug) ?? new Map();
    }

    let changed = false;
    for (const [id, name] of discovered) {
      if (!existing.has(id)) {
        existing.set(id, name);
        changed = true;
      }
    }

    if (changed) {
      levelNamesCache.value.set(slug, existing);
      await saveToStorage(slug, existing);
    }
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

  /**
   * Load level names for multiple WADs in parallel.
   */
  async function loadAllLevelNames(slugs: string[]): Promise<void> {
    await Promise.all(slugs.map(slug => loadLevelNames(slug)));
  }

  return {
    loadLevelNames,
    loadAllLevelNames,
    getCachedLevelNames,
    getLevelDisplayName,
    mergeLevelNames,
    clearCache,
  };
}
