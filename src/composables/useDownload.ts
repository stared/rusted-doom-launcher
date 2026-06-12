import { ref } from "vue";
import { exists, mkdir, remove, rename, stat } from "@tauri-apps/plugin-fs";
import { download as tauriDownload } from "@tauri-apps/plugin-upload";
import { invoke } from "@tauri-apps/api/core";
import type { WadEntry } from "../lib/schema";
import { type LauncherDownloads } from "../lib/schema";
import { downloads } from "./downloadState";
import { useLevelNames } from "./useLevelNames";
import { selectPrimaryGameFile, type GameFileInfo } from "../lib/zipExtract";
import { GOG_EXPANSIONS } from "../lib/gogContent";
import { useLibrary } from "./useLibrary";

// Progress info for a download
export interface DownloadProgress {
  progress: number;  // bytes downloaded
  total: number;     // total bytes (0 if unknown)
}

// Singleton state (downloads itself lives in downloadState.ts)
const downloading = ref<Set<string>>(new Set());
const installing = ref<Set<string>>(new Set());
const downloadProgress = ref<Record<string, DownloadProgress>>({});

/**
 * Validate downloaded file has correct format (ZIP/WAD magic bytes).
 * Throws if file is corrupt or wrong format.
 */
async function validateDownload(path: string, filename: string): Promise<void> {
  await invoke("validate_game_file", { path, filename });
}

export function useDownload() {
  const { loadLevelNames } = useLevelNames();
  const { base, wadFile, iwadFile } = useLibrary();

  /**
   * Extract game files (.wad/.pk3) from a ZIP archive into the library.
   * Returns the primary wadFilename and any additional file names.
   */
  async function extractAndWriteGameFiles(
    slug: string,
    zipPath: string
  ): Promise<{ wadFilename: string; additionalFiles: string[] }> {
    installing.value.add(slug);
    try {
      const extracted = await invoke<GameFileInfo[]>("extract_game_files", {
        zipPath,
        destDir: base(),
      });
      const { primary, additional } = selectPrimaryGameFile(extracted);

      console.log(`[extract] Extracted primary: ${primary.name} (${primary.size} bytes)`);
      for (const file of additional) {
        console.log(`[extract] Extracted additional: ${file.name} (${file.size} bytes)`);
      }

      return { wadFilename: primary.name, additionalFiles: additional.map(f => f.name) };
    } finally {
      installing.value.delete(slug);
    }
  }

  async function loadState() {
    downloads.value = await invoke<LauncherDownloads>("read_launcher_downloads", { libraryPath: base() });
  }

  async function saveState() {
    await invoke("write_launcher_downloads", { libraryPath: base(), state: downloads.value });
  }

  function isDownloaded(slug: string): boolean {
    return slug in downloads.value.downloads;
  }

  function isDownloading(slug: string): boolean {
    return downloading.value.has(slug);
  }

  function isInstalling(slug: string): boolean {
    return installing.value.has(slug);
  }

  function getDownloadProgress(slug: string): DownloadProgress | undefined {
    return downloadProgress.value[slug];
  }

  function getDownloadInfo(slug: string): { filename: string; wadFilename?: string; externalPath: string } | null {
    return downloads.value.downloads[slug] ?? null;
  }

  /**
   * Resolve an existing download record to a launchable path. Re-extracts
   * from a still-present zip when the extracted file went missing. Returns
   * null when there is no record or it's stale (file gone from disk).
   */
  async function resolveExistingDownload(wad: WadEntry): Promise<string | null> {
    const info = downloads.value.downloads[wad.slug];
    if (!info) return null;

    // External reference (user opted out of "Copy to library") — launch
    // straight from the picked path. No library-relative resolution.
    if (info.externalPath && await exists(info.externalPath)) {
      return info.externalPath;
    }

    const wadPath = wadFile(info.wadFilename ?? info.filename);
    if (await exists(wadPath)) {
      return wadPath;
    }

    // Extracted file missing but the original zip is still on disk —
    // re-extract instead of re-downloading.
    if (info.filename.endsWith(".zip") && await exists(wadFile(info.filename))) {
      const { wadFilename } = await extractAndWriteGameFiles(wad.slug, wadFile(info.filename));
      info.wadFilename = wadFilename;
      await saveState();
      return wadFile(wadFilename);
    }

    return null;
  }

  async function downloadWad(wad: WadEntry): Promise<string> {
    // 1. Already on disk? Return the path. This must run BEFORE the URL check
    // because custom-imported WADs (_source === "custom") have empty downloads[]
    // but a valid synthetic download record + file on disk.
    const resolved = await resolveExistingDownload(wad);
    if (resolved) return resolved;

    if (downloads.value.downloads[wad.slug]) {
      // Stale record — file missing on disk. For non-custom entries we'll fall
      // through to re-download; for custom entries that path will fail with a
      // clearer error below.
      delete downloads.value.downloads[wad.slug];
      await saveState();
    }

    // 2. Need to download — but we can only download if a URL is configured.
    if (!wad.downloads || wad.downloads.length === 0) {
      throw new Error(`No download URL configured for "${wad.title}"`);
    }

    const { url, filename } = wad.downloads[0];

    if (url.includes("example.com") || url.includes("placeholder")) {
      throw new Error(`Download not available for "${wad.title}" - URL not configured`);
    }

    const path = wadFile(filename);
    const partPath = `${path}.part`;

    downloading.value.add(wad.slug);
    downloadProgress.value = { ...downloadProgress.value, [wad.slug]: { progress: 0, total: 0 } };
    try {
      await mkdir(base(), { recursive: true });

      // Use tauri-plugin-upload for streaming download with progress
      let lastUpdate = 0;
      await tauriDownload(
        url,
        partPath,
        (payload) => {
          const now = Date.now();
          if (now - lastUpdate > 100 || payload.progressTotal === payload.total) {
            lastUpdate = now;
            downloadProgress.value = { ...downloadProgress.value, [wad.slug]: { progress: payload.progressTotal, total: payload.total } };
          }
        }
      );

      // Validate the downloaded file before marking as complete
      try {
        await validateDownload(partPath, filename);
      } catch (validationError) {
        await remove(partPath);
        throw validationError;
      }

      // Atomic rename: .part -> final filename
      await rename(partPath, path);

      const fileStat = await stat(path);
      const isZip = filename.toLowerCase().endsWith('.zip');

      if (isZip) {
        const { wadFilename } = await extractAndWriteGameFiles(wad.slug, path);
        downloads.value.downloads[wad.slug] = {
          filename, wadFilename, downloadedAt: new Date().toISOString(), size: fileStat.size, externalPath: "",
        };
        await saveState();
        await loadLevelNames(wad.slug);
        return wadFile(wadFilename);
      } else {
        downloads.value.downloads[wad.slug] = {
          filename, wadFilename: filename, downloadedAt: new Date().toISOString(), size: fileStat.size, externalPath: "",
        };
        await saveState();
        await loadLevelNames(wad.slug);
        return path;
      }
    } finally {
      downloading.value.delete(wad.slug);
      const { [wad.slug]: _, ...rest } = downloadProgress.value;
      downloadProgress.value = rest;
    }
  }

  async function downloadWithDeps(wad: WadEntry, allWads: WadEntry[]): Promise<{ wadPath: string; depPaths: string[] }> {
    const depPaths: string[] = [];
    for (const dep of wad.requires) {
      const depWad = allWads.find(w => w.slug === dep.slug);
      if (depWad) depPaths.push(await downloadWad(depWad));
    }
    return { wadPath: await downloadWad(wad), depPaths };
  }

  async function deleteWad(slug: string) {
    const info = downloads.value.downloads[slug];
    if (!info) return;
    // External-reference imports never had a library copy — only drop the
    // bookkeeping record and leave the file the user picked alone.
    if (info.externalPath) {
      delete downloads.value.downloads[slug];
      await saveState();
      return;
    }
    // Delete original download file
    try {
      await remove(wadFile(info.filename));
    } catch (e) {
      console.error(`Failed to delete ${info.filename}:`, e);
    }
    // Also delete extracted file if different from original
    if (info.wadFilename && info.wadFilename !== info.filename) {
      try {
        await remove(wadFile(info.wadFilename));
      } catch (e) {
        console.error(`Failed to delete ${info.wadFilename}:`, e);
      }
    }
    delete downloads.value.downloads[slug];
    await saveState();
  }

  /**
   * Register official expansion WADs found in iwads/ (GOG import puts them
   * there) as playable: each gets a synthetic download record whose
   * externalPath points at the file, lighting up its catalog entry.
   * Idempotent — existing records (including real downloads) are left alone.
   * Returns the newly registered slugs.
   */
  async function registerOwnedExpansions(): Promise<string[]> {
    const registered: string[] = [];
    for (const expansion of GOG_EXPANSIONS) {
      if (expansion.slug in downloads.value.downloads) continue;
      const path = iwadFile(expansion.file);
      if (!(await exists(path))) continue;
      const fileStat = await stat(path);
      downloads.value.downloads[expansion.slug] = {
        filename: expansion.file,
        wadFilename: expansion.file,
        downloadedAt: new Date().toISOString(),
        size: fileStat.size,
        externalPath: path,
      };
      registered.push(expansion.slug);
    }
    if (registered.length > 0) {
      await saveState();
      console.log(`[registerOwnedExpansions] Registered: ${registered.join(", ")}`);
    }
    return registered;
  }

  /**
   * Write a synthetic LauncherDownloads record for a slug whose file is
   * already on disk (e.g. user-imported custom WAD). Mirrors what downloadWad
   * writes after a successful network download, so isDownloaded/getDownloadInfo
   * light up immediately and the rest of the launch path is unchanged.
   */
  async function registerSyntheticDownload(
    slug: string,
    info: { filename: string; wadFilename: string; size: number; externalPath?: string }
  ) {
    downloads.value.downloads[slug] = {
      filename: info.filename,
      wadFilename: info.wadFilename,
      downloadedAt: new Date().toISOString(),
      size: info.size,
      externalPath: info.externalPath ?? "",
    };
    await saveState();
    await loadLevelNames(slug);
  }

  return {
    loadState,
    isDownloaded,
    isDownloading,
    isInstalling,
    getDownloadProgress,
    getDownloadInfo,
    downloadProgress,
    downloadWad,
    downloadWithDeps,
    deleteWad,
    registerSyntheticDownload,
    registerOwnedExpansions,
  };
}
