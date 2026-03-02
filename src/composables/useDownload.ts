import { ref } from "vue";
import { exists, mkdir, remove, readFile, rename, stat, writeFile } from "@tauri-apps/plugin-fs";
import { download as tauriDownload } from "@tauri-apps/plugin-upload";
import { invoke } from "@tauri-apps/api/core";
import type { WadEntry } from "../lib/schema";
import { type LauncherDownloads } from "../lib/schema";
import { useSettings } from "./useSettings";
import { useLevelNames } from "./useLevelNames";
import { findGameFilesInZip, selectPrimaryGameFile } from "../lib/zipExtract";

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

/**
 * Extract game files (.wad/.pk3) from a ZIP archive and write them to disk.
 * Returns the primary wadFilename and any additional file paths.
 */
async function extractAndWriteGameFiles(
  zipPath: string,
  libraryDir: string
): Promise<{ wadFilename: string; additionalFiles: string[] }> {
  const zipData = await readFile(zipPath);
  const gameFiles = findGameFilesInZip(new Uint8Array(zipData));
  const { primary, additional } = selectPrimaryGameFile(gameFiles);

  // Write primary file
  await writeFile(`${libraryDir}/${primary.name}`, primary.data);
  console.log(`[extract] Extracted primary: ${primary.name} (${primary.data.length} bytes)`);

  // Write additional files
  const additionalFiles: string[] = [];
  for (const file of additional) {
    await writeFile(`${libraryDir}/${file.name}`, file.data);
    additionalFiles.push(file.name);
    console.log(`[extract] Extracted additional: ${file.name} (${file.data.length} bytes)`);
  }

  return { wadFilename: primary.name, additionalFiles };
}

export function useDownload() {
  const { settings } = useSettings();
  const { loadLevelNames } = useLevelNames();

  async function loadState() {
    const dir = settings.value.libraryPath;
    downloads.value = await invoke<LauncherDownloads>("read_launcher_downloads", { libraryPath: dir });
  }

  async function saveState() {
    await invoke("write_launcher_downloads", { libraryPath: settings.value.libraryPath, state: downloads.value });
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

    const path = `${dir}/${filename}`;
    const partPath = `${path}.part`;  // Atomic download: write to .part file first

    // Check if already downloaded
    const info = downloads.value.downloads[wad.slug];
    if (info) {
      const wadFile = info.wadFilename ?? info.filename;
      const wadPath = `${dir}/${wadFile}`;

      if (await exists(wadPath)) {
        // L1: extracted file exists → return directly
        return wadPath;
      }

      if (info.wadFilename && info.filename.endsWith('.zip') && await exists(`${dir}/${info.filename}`)) {
        // L3: extracted file missing but ZIP exists → re-extract
        const { wadFilename } = await extractAndWriteGameFiles(`${dir}/${info.filename}`, dir);
        info.wadFilename = wadFilename;
        await saveState();
        return `${dir}/${wadFilename}`;
      }

      if (info.filename.endsWith('.zip') && !info.wadFilename && await exists(`${dir}/${info.filename}`)) {
        // L2: legacy download → extract and update state
        const { wadFilename } = await extractAndWriteGameFiles(`${dir}/${info.filename}`, dir);
        info.wadFilename = wadFilename;
        await saveState();
        return `${dir}/${wadFilename}`;
      }

      // L4: nothing on disk → clear stale state, fall through to re-download
      delete downloads.value.downloads[wad.slug];
      await saveState();
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
      const isZip = filename.toLowerCase().endsWith('.zip');

      if (isZip) {
        // Extract game files from ZIP
        const { wadFilename } = await extractAndWriteGameFiles(path, dir);
        downloads.value.downloads[wad.slug] = {
          filename, wadFilename, downloadedAt: new Date().toISOString(), size: fileStat.size,
        };
        await saveState();

        // Extract and persist level names from the extracted WAD
        await loadLevelNames(wad.slug);

        return `${dir}/${wadFilename}`;
      } else {
        // Direct .pk3 or .wad download — wadFilename = filename
        downloads.value.downloads[wad.slug] = {
          filename, wadFilename: filename, downloadedAt: new Date().toISOString(), size: fileStat.size,
        };
        await saveState();

        // Extract and persist level names from the WAD
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
    const dir = settings.value.libraryPath;
    // Delete original download file
    try {
      await remove(`${dir}/${info.filename}`);
    } catch (e) {
      console.error(`Failed to delete ${info.filename}:`, e);
    }
    // Also delete extracted file if different from original
    if (info.wadFilename && info.wadFilename !== info.filename) {
      try {
        await remove(`${dir}/${info.wadFilename}`);
      } catch (e) {
        console.error(`Failed to delete ${info.wadFilename}:`, e);
      }
    }
    delete downloads.value.downloads[slug];
    await saveState();
  }

  return { loadState, isDownloaded, isDownloading, getDownloadProgress, downloadProgress, downloadWad, downloadWithDeps, deleteWad };
}
