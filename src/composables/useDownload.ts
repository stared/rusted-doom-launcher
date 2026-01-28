import { ref } from "vue";
import { join } from "@tauri-apps/api/path";
import { exists, mkdir, remove, readTextFile, writeTextFile, readFile, rename, stat } from "@tauri-apps/plugin-fs";
import { download as tauriDownload } from "@tauri-apps/plugin-upload";
import type { WadEntry } from "../lib/schema";
import { LauncherDownloadsSchema, type LauncherDownloads } from "../lib/schema";
import { useSettings } from "./useSettings";
import { useLevelNames } from "./useLevelNames";
import { isNotFoundError } from "../lib/errors";

// Progress info for a download
export interface DownloadProgress {
  progress: number;  // bytes downloaded
  total: number;     // total bytes (0 if unknown)
}

// Singleton state
const downloads = ref<LauncherDownloads>({ version: 1, downloads: {} });
const downloading = ref<Set<string>>(new Set());
const downloadProgress = ref<Record<string, DownloadProgress>>({});

/**
 * Validate downloaded file has correct format (ZIP/WAD magic bytes).
 * Throws if file is corrupt or wrong format.
 */
async function validateDownload(path: string, filename: string): Promise<void> {
  const data = await readFile(path);
  const bytes = new Uint8Array(data);
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "zip" || ext === "pk3") {
    // ZIP files start with PK (0x50 0x4B)
    if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error(
        `Invalid ZIP file: ${filename} - file appears corrupted or is not a ZIP archive (got ${bytes.length} bytes, magic: ${bytes[0]?.toString(16)} ${bytes[1]?.toString(16)})`
      );
    }
  } else if (ext === "wad") {
    // WAD files start with IWAD or PWAD
    if (bytes.length < 4) {
      throw new Error(`Invalid WAD file: ${filename} - file too small (${bytes.length} bytes)`);
    }
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "IWAD" && magic !== "PWAD") {
      throw new Error(`Invalid WAD file: ${filename} - expected IWAD/PWAD header, got "${magic}"`);
    }
  }
}

export function useDownload() {
  const { settings } = useSettings();
  const { loadLevelNames } = useLevelNames();

  async function loadState() {
    const dir = settings.value.libraryPath;
    try {
      const downloadsPath = await join(dir, "launcher-downloads.json");
      const content = await readTextFile(downloadsPath);
      const parsed = LauncherDownloadsSchema.safeParse(JSON.parse(content));
      if (parsed.success) {
        downloads.value = parsed.data;
      } else {
        console.error("launcher-downloads.json schema validation failed:", parsed.error);
      }
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
      // File doesn't exist yet - that's expected on first run
    }
  }

  async function saveState() {
    const downloadsPath = await join(settings.value.libraryPath, "launcher-downloads.json");
    await writeTextFile(downloadsPath, JSON.stringify(downloads.value, null, 2));
  }

  function isDownloaded(slug: string): boolean {
    return slug in downloads.value.downloads;
  }

  function isDownloading(slug: string): boolean {
    return downloading.value.has(slug);
  }

  function getDownloadProgress(slug: string): DownloadProgress | undefined {
    return downloadProgress.value[slug];
  }

  async function downloadWad(wad: WadEntry): Promise<string> {
    const dir = settings.value.libraryPath;

    if (!wad.downloads || wad.downloads.length === 0) {
      throw new Error(`No download URL configured for "${wad.title}"`);
    }

    const { url, filename } = wad.downloads[0];

    // Check for placeholder/invalid URLs
    if (url.includes("example.com") || url.includes("placeholder")) {
      throw new Error(`Download not available for "${wad.title}" - URL not configured`);
    }

    const path = await join(dir, filename);
    const partPath = `${path}.part`;  // Atomic download: write to .part file first

    if (await exists(path)) {
      // File exists - validate it before marking as downloaded
      await validateDownload(path, filename);
      if (!isDownloaded(wad.slug)) {
        const fileStat = await stat(path);
        downloads.value.downloads[wad.slug] = { filename, downloadedAt: new Date().toISOString(), size: fileStat.size };
        await saveState();
      }
      return path;
    }

    downloading.value.add(wad.slug);
    downloadProgress.value = { ...downloadProgress.value, [wad.slug]: { progress: 0, total: 0 } };
    try {
      await mkdir(dir, { recursive: true });

      // Use tauri-plugin-upload for streaming download with progress
      // ProgressPayload: { progress, progressTotal, total, transferSpeed }
      let lastUpdate = 0;
      await tauriDownload(
        url,
        partPath,
        (payload) => {
          // Throttle updates to every 100ms to avoid excessive re-renders
          const now = Date.now();
          if (now - lastUpdate > 100 || payload.progressTotal === payload.total) {
            lastUpdate = now;
            // progressTotal = cumulative bytes downloaded, progress = just current chunk
            downloadProgress.value = { ...downloadProgress.value, [wad.slug]: { progress: payload.progressTotal, total: payload.total } };
          }
        }
      );

      // Validate the downloaded file before marking as complete
      try {
        await validateDownload(partPath, filename);
      } catch (validationError) {
        // Delete corrupt file and re-throw
        await remove(partPath);
        throw validationError;
      }

      // Atomic rename: .part -> final filename
      await rename(partPath, path);

      const fileStat = await stat(path);
      downloads.value.downloads[wad.slug] = { filename, downloadedAt: new Date().toISOString(), size: fileStat.size };
      await saveState();

      // Extract and persist level names from the WAD
      await loadLevelNames(wad.slug);

      return path;
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
    const dir = settings.value.libraryPath;
    try {
      const filePath = await join(dir, info.filename);
      await remove(filePath);
    } catch (e) {
      console.error(`Failed to delete ${info.filename}:`, e);
      // Continue anyway - we still want to remove from state
    }
    delete downloads.value.downloads[slug];
    await saveState();
  }

  return { loadState, isDownloaded, isDownloading, getDownloadProgress, downloadProgress, downloadWad, downloadWithDeps, deleteWad };
}
